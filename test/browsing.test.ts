import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSync } from 'esbuild';
import { CatalogStore } from '../src/store';
import { makeFolder, makeLocalFolder } from '../src/model';

// Exercise the actual activation, Webview messages and Store with an isolated VS Code API double.
// The filesystem double models Remote SSH; the real SFTP transport is covered in sftp.test.ts.
const extensionCode = buildSync({ entryPoints: ['src/extension.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external' }).outputFiles[0].text;
const nodeRequire = createRequire(path.resolve('package.json'));
const noOp = () => {};
const disposable = () => ({ dispose: noOp });
const fsError = (code: string) => Object.assign(new Error(code), { code });
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await delay(5);
  assert.ok(predicate(), description);
}

async function browser(t: TestContext, initialPath = '/srv/projects/deleted', options: {
  localProject?: boolean; warningAnswers?: (string | undefined)[]; failLocalDelete?: boolean;
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-browser-'));
  const store = new CatalogStore(path.join(directory, 'storage'));
  const localPath = path.join(directory, 'local-project');
  const localFolder = options.localProject ? makeLocalFolder(localPath) : undefined;
  if (localFolder) {
    await mkdir(path.join(localPath, 'src'), { recursive: true });
    await writeFile(path.join(localPath, 'src', 'main.ts'), 'export {};');
  }
  await store.update(data => {
    data.browsePaths.dev = initialPath;
    data.folders.push({ ...makeFolder('dev', initialPath), favorite: true, lastOpenedAt: 123 });
    if (localFolder) data.folders.push(localFolder);
  });
  const originalFolders = (await store.read()).folders;
  const configFile = path.join(directory, 'config');
  await writeFile(configFile, 'Host dev\n  HostName example.test\n');
  const directories = new Set(['/', '/srv', '/srv/projects', initialPath, '/home/test']);
  const failures = new Map<string, string>();
  const reads: string[] = [];
  const messages: Record<string, any>[] = [];
  const commands = new Map<string, (...args: any[]) => unknown>();
  const warningCalls: unknown[][] = [];
  const deleteCalls: { path: string; recursive?: boolean }[] = [];
  const progressCalls: unknown[] = [];
  const warningAnswers = [...(options.warningAnswers || [])];
  let receive: (message: unknown) => void;
  let close: () => void = noOp;
  const remoteFs = {
    stat: async (uri: { path: string; scheme?: string; fsPath?: string }) => {
      if (uri.scheme === 'file' && uri.fsPath) {
        try { return { type: (await stat(uri.fsPath)).isDirectory() ? 2 : 1 }; }
        catch { throw fsError('FileNotFound'); }
      }
      reads.push(uri.path);
      const failure = failures.get(uri.path);
      if (failure) throw fsError(failure);
      if (!directories.has(uri.path)) throw fsError('FileNotFound');
      return { type: 2 };
    },
    readDirectory: async () => [['next', 2]],
    delete: async (uri: { path: string; fsPath?: string }, deleteOptions?: { recursive?: boolean }) => {
      deleteCalls.push({ path: uri.fsPath || uri.path, recursive: deleteOptions?.recursive });
      if (options.failLocalDelete) throw fsError('NoPermissions');
      await rm(uri.fsPath || uri.path, { recursive: deleteOptions?.recursive, force: false });
    }
  };
  const fileUri = (value: string) => ({ scheme: 'file', fsPath: value, path: value, toString: () => value });
  const vscode = {
    Uri: { file: fileUri, joinPath: (base: { fsPath: string }, ...parts: string[]) => fileUri(path.join(base.fsPath, ...parts)),
      from: (value: unknown) => value },
    EventEmitter: class { event = () => disposable(); fire = noOp; dispose = noOp; },
    TreeItem: class { constructor(public label: string) {} }, ThemeIcon: class {},
    TreeItemCollapsibleState: { None: 0 }, StatusBarAlignment: { Left: 1 }, ViewColumn: { Active: -1 },
    ProgressLocation: { Notification: 15 },
    FileType: { Directory: 2, SymbolicLink: 64 },
    FileSystemError: { FileNotADirectory: () => fsError('FileNotADirectory') },
    commands: { registerCommand: (name: string, handler: (...args: any[]) => unknown) => { commands.set(name, handler); return disposable(); } },
    workspace: {
      workspaceFolders: [{ name: 'fixture', uri: { scheme: 'vscode-remote', authority: 'ssh-remote+dev', path: initialPath } }],
      fs: remoteFs,
      getConfiguration: (section: string) => ({ get: (name: string, fallback: unknown) =>
        section === 'remote.SSH' && name === 'configFile' ? configFile : name === 'recordFolders' ? false : fallback }),
      onDidChangeWorkspaceFolders: disposable, onDidChangeConfiguration: disposable
    },
    window: {
      createOutputChannel: () => ({ ...disposable(), appendLine: noOp }),
      createTreeView: () => ({ ...disposable(), visible: false, onDidChangeVisibility: disposable }),
      createStatusBarItem: () => ({ ...disposable(), show: noOp }), onDidChangeWindowState: disposable,
      showWarningMessage: async (...args: unknown[]) => { warningCalls.push(args); return warningAnswers.shift(); },
      withProgress: async (_options: unknown, task: (progress: { report(value: unknown): void }, token: unknown) => Promise<unknown>) =>
        task({ report: value => progressCalls.push(value) }, {}),
      createWebviewPanel: () => ({ reveal: noOp, dispose: () => close(), onDidDispose: (handler: () => void) => { close = handler; },
        webview: { cspSource: 'fixture', asWebviewUri: (uri: unknown) => uri,
          postMessage: (message: unknown) => { messages.push(message as Record<string, any>); },
          onDidReceiveMessage: (handler: typeof receive) => { receive = handler; } } }),
      showErrorMessage: (message: string) => assert.fail(message)
    }
  };
  const module = { exports: {} as { activate(context: unknown): Promise<void>; deactivate(): void } };
  runInNewContext(extensionCode, { module, exports: module.exports,
    require: (name: string) => name === 'vscode' ? vscode : nodeRequire(name),
    process, console, Buffer, AbortController, setTimeout, clearTimeout });
  const subscriptions: { dispose(): void }[] = [];
  t.after(async () => {
    module.exports.deactivate();
    for (const subscription of subscriptions.slice(1)) subscription.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await module.exports.activate({ subscriptions, globalStorageUri: fileUri(path.join(directory, 'storage')),
    extensionUri: fileUri(path.resolve('.')), extension: { id: 'katcuu.ssh-workspace-manager' } });
  await commands.get('sshWorkspaceManager.openDashboard')!();
  const send = async (message: unknown) => {
    const start = messages.length;
    receive(message);
    for (let attempt = 0; attempt < 200; attempt++) {
      const reply = messages.slice(start);
      if (reply.some(value => value.type === 'browseResult' || value.type === 'notice' || (value.type === 'status' && value.busy === false))) return reply;
      await delay(5);
    }
    assert.fail(`Browser request did not settle: ${JSON.stringify(messages.slice(start))}`);
  };
  return { directories, failures, reads, messages, send, receive: (message: unknown) => receive(message), remoteFs,
    store, originalFolders, localPath, localFolder, warningCalls, deleteCalls, progressCalls };
}

test('reconnecting after the saved directory is deleted uses the closest existing parent and persists it', async t => {
  const ui = await browser(t);
  await ui.send({ type: 'connect', alias: 'dev' });
  await ui.send({ type: 'cancel' });
  ui.directories.delete('/srv/projects/deleted');
  ui.directories.delete('/srv/projects');
  ui.reads.length = 0;
  const reply = await ui.send({ type: 'connect', alias: 'dev', path: '/srv/projects/deleted' });
  assert.deepEqual(ui.reads, ['/srv/projects/deleted', '/srv/projects', '/srv']);
  assert.equal(reply.find(value => value.type === 'browseResult')?.path, '/srv');
  assert.match(reply.find(value => value.type === 'notice')?.message, /已切换到 \/srv/);
  assert.equal((await ui.store.read()).browsePaths.dev, '/srv');
  assert.deepEqual((await ui.store.read()).folders, ui.originalFolders, 'directory recovery never deletes favorites or history');
  await ui.send({ type: 'cancel' });
  ui.reads.length = 0;
  await ui.send({ type: 'connect', alias: 'dev' });
  assert.deepEqual(ui.reads, ['/srv'], 'the next reconnect must not retry the deleted path');
});

test('custom connect paths and manual navigation remain usable after missing or malformed paths', async t => {
  const ui = await browser(t);
  const reply = await ui.send({ type: 'connect', alias: 'dev', path: '/home/test' });
  assert.equal(reply.find(value => value.type === 'browseResult')?.path, '/home/test');
  for (const invalid of ['/missing/path', 'relative/path']) {
    ui.reads.length = 0;
    const failed = await ui.send({ type: 'browse', alias: 'dev', path: invalid });
    assert.ok(failed.some(value => value.type === 'error'));
    assert.ok(failed.some(value => value.type === 'status' && !value.busy && value.connected));
    assert.deepEqual(ui.reads, invalid.startsWith('/') ? [invalid] : [], 'manual errors do not silently navigate to a different directory');
    assert.equal((await ui.store.read()).browsePaths.dev, '/home/test');
    const recovered = await ui.send({ type: 'browse', alias: 'dev', path: '/srv' });
    assert.equal(recovered.find(value => value.type === 'browseResult')?.path, '/srv');
    await ui.send({ type: 'browse', alias: 'dev', path: '/home/test' });
  }
  await ui.send({ type: 'cancel' });
  const invalidConnect = await ui.send({ type: 'connect', alias: 'dev', path: 'relative/path' });
  assert.ok(invalidConnect.some(value => value.type === 'status' && !value.busy && !value.connected));
  assert.equal((await ui.send({ type: 'connect', alias: 'dev', path: '/' })).find(value => value.type === 'browseResult')?.path, '/');
});

test('permission errors do not trigger directory fallback and a missing root terminates recovery', async t => {
  const ui = await browser(t);
  ui.failures.set('/srv/projects/deleted', 'NoPermissions');
  const denied = await ui.send({ type: 'connect', alias: 'dev' });
  assert.deepEqual(ui.reads, ['/srv/projects/deleted']);
  assert.ok(denied.some(value => value.type === 'status' && !value.busy && value.connected));
  assert.equal((await ui.store.read()).browsePaths.dev, '/srv/projects/deleted');
  assert.equal((await ui.send({ type: 'browse', alias: 'dev', path: '/home/test' })).find(value => value.type === 'browseResult')?.path, '/home/test');
  await ui.send({ type: 'cancel' });
  ui.directories.clear(); ui.reads.length = 0;
  const missing = await ui.send({ type: 'connect', alias: 'dev' });
  assert.deepEqual(ui.reads, ['/home/test', '/home', '/']);
  assert.ok(missing.some(value => value.type === 'status' && !value.busy));
  assert.equal((await ui.store.read()).browsePaths.dev, '/home/test');
});

test('a saved directory replaced by a file recovers to its parent', async t => {
  const ui = await browser(t);
  ui.failures.set('/srv/projects/deleted', 'FileNotADirectory');
  const reply = await ui.send({ type: 'connect', alias: 'dev' });
  assert.equal(reply.find(value => value.type === 'browseResult')?.path, '/srv/projects');
  assert.equal((await ui.store.read()).browsePaths.dev, '/srv/projects');
});

test('canceling during parent recovery prevents stale results and saved path updates', async t => {
  const ui = await browser(t);
  ui.directories.delete('/srv/projects/deleted');
  let release: () => void = noOp;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const stat = ui.remoteFs.stat;
  ui.remoteFs.stat = async uri => {
    if (uri.path === '/srv/projects') await waiting;
    return stat(uri);
  };
  ui.receive({ type: 'connect', alias: 'dev' });
  for (let attempt = 0; attempt < 100 && !ui.messages.some(value => value.type === 'status' && value.message.includes('上级目录')); attempt++) await delay(5);
  assert.ok(ui.messages.some(value => value.type === 'status' && value.message.includes('上级目录')));
  await ui.send({ type: 'cancel' });
  const offset = ui.messages.length;
  release();
  await delay(40);
  assert.ok(!ui.messages.slice(offset).some(value => ['browseResult', 'error', 'notice'].includes(value.type)));
  assert.equal((await ui.store.read()).browsePaths.dev, '/srv/projects/deleted');
});

test('record removal offers metadata-only deletion without touching the local folder', async t => {
  const ui = await browser(t, undefined, { localProject: true, warningAnswers: ['仅删除记录'] });
  const folder = ui.localFolder!;
  const reply = await ui.send({ type: 'remove', id: folder.id });
  assert.equal(reply.find(value => value.type === 'notice')?.message, '已删除项目记录，实际文件保留。');
  const [message, options, ...choices] = ui.warningCalls[0] as [string, { modal: boolean; detail: string }, ...string[]];
  assert.match(message, /如何处理/);
  assert.equal(options.modal, true);
  assert.ok(options.detail.includes(folder.path));
  assert.deepEqual(choices, ['仅删除记录', '删除文件夹并删除记录']);
  assert.deepEqual(ui.deleteCalls, []);
  await access(ui.localPath);
  assert.ok(!(await ui.store.read()).folders.some(value => value.id === folder.id));
});

test('confirmed local folder deletion shows its full path twice and removes files before history', async t => {
  const ui = await browser(t, undefined, { localProject: true, warningAnswers: ['删除文件夹并删除记录', '确认删除文件夹'] });
  const folder = ui.localFolder!;
  const result = await ui.send({ type: 'remove', id: folder.id });
  assert.equal(ui.warningCalls.length, 2);
  const secondDialog = ui.warningCalls[1] as [string, { modal: boolean; detail: string }, ...string[]];
  assert.ok(secondDialog[1].detail.includes(folder.path));
  assert.match(secondDialog[1].detail, /此操作无法撤销/);
  assert.deepEqual(ui.deleteCalls, [{ path: folder.path, recursive: true }]);
  assert.ok(ui.progressCalls.length > 0);
  await assert.rejects(() => access(ui.localPath), { code: 'ENOENT' });
  assert.ok(!(await ui.store.read()).folders.some(value => value.id === folder.id));
  assert.ok(result.some(value => value.type === 'notice' && value.message.includes(folder.path)));
});

test('canceling the second confirmation preserves both the folder and its record', async t => {
  const ui = await browser(t, undefined, { localProject: true, warningAnswers: ['删除文件夹并删除记录', undefined] });
  const folder = ui.localFolder!;
  const messageCount = ui.messages.length;
  ui.receive({ type: 'remove', id: folder.id });
  await waitFor(() => ui.warningCalls.length === 2, 'the second confirmation should be shown');
  await delay(5);
  assert.equal(ui.warningCalls.length, 2);
  assert.deepEqual(ui.deleteCalls, []);
  assert.ok((await ui.store.read()).folders.some(value => value.id === folder.id));
  await access(ui.localPath);
  assert.ok(!ui.messages.slice(messageCount).some(value => value.type === 'error' || value.type === 'notice'));
});

test('if a confirmed folder was already deleted elsewhere, removes only its stale record and reports that state', async t => {
  const ui = await browser(t, undefined, { localProject: true, warningAnswers: ['删除文件夹并删除记录', '确认删除文件夹'] });
  const folder = ui.localFolder!;
  await rm(ui.localPath, { recursive: true });
  const result = await ui.send({ type: 'remove', id: folder.id });
  assert.deepEqual(ui.deleteCalls, []);
  assert.ok(result.some(value => value.type === 'notice' && value.message.includes('文件夹已不存在')));
  assert.ok(!(await ui.store.read()).folders.some(value => value.id === folder.id));
});

test('a path replaced by a regular file is preserved and the project record remains', async t => {
  const ui = await browser(t, undefined, { localProject: true, warningAnswers: ['删除文件夹并删除记录', '确认删除文件夹'] });
  const folder = ui.localFolder!;
  await rm(ui.localPath, { recursive: true });
  await writeFile(ui.localPath, 'keep this file');
  ui.receive({ type: 'remove', id: folder.id });
  await waitFor(() => ui.messages.some(value => value.type === 'error'), 'the changed path should be reported');
  assert.deepEqual(ui.deleteCalls, []);
  assert.equal((await stat(ui.localPath)).isFile(), true);
  assert.ok((await ui.store.read()).folders.some(value => value.id === folder.id));
});

test('a failed physical deletion keeps the catalog record', async t => {
  const ui = await browser(t, undefined, { localProject: true, failLocalDelete: true,
    warningAnswers: ['删除文件夹并删除记录', '确认删除文件夹'] });
  const folder = ui.localFolder!;
  ui.receive({ type: 'remove', id: folder.id });
  await waitFor(() => ui.messages.some(value => value.type === 'error'), 'the filesystem failure should be reported');
  assert.ok((await ui.store.read()).folders.some(value => value.id === folder.id));
  await access(ui.localPath);
});

test('root directories are blocked before the second destructive confirmation', async t => {
  const ui = await browser(t, undefined, { warningAnswers: ['删除文件夹并删除记录'] });
  const root = makeFolder('dev', '/');
  await ui.store.update(data => { data.folders.push(root); });
  ui.receive({ type: 'remove', id: root.id });
  await waitFor(() => ui.messages.some(value => value.type === 'error'), 'root deletion should be rejected');
  assert.equal(ui.warningCalls.length, 1);
  assert.ok((await ui.store.read()).folders.some(value => value.id === root.id));
  assert.equal(ui.progressCalls.length, 0);
});
