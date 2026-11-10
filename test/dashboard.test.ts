import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// A small DOM double runs the shipped controller without browser dependencies.
// Layout and native VS Code integration are checked separately in the extension host.
class Element {
  textContent = '';
  value = '';
  hidden = false;
  checked = false;
  disabled = false;
  className = '';
  title = '';
  dataset: Record<string, string> = {};
  rect = { left: 0, width: 0 };
  style = {
    values: new Map<string, string>(),
    setProperty: (name: string, value: string) => { this.style.values.set(name, value); },
    getPropertyValue: (name: string) => this.style.values.get(name) || ''
  };
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event?: unknown) => void>();
  classList = {
    add: (name: string) => { if (!this.className.split(/\s+/).includes(name)) this.className = `${this.className} ${name}`.trim(); },
    remove: (name: string) => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); }
  };
  append(...children: Element[]): void { this.children.push(...children); }
  replaceChildren(...children: Element[]): void { this.children = children; }
  addEventListener(name: string, callback: (event?: unknown) => void): void { this.listeners.set(name, callback); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  emit(name: string, event: unknown = {}): void { this.listeners.get(name)?.(event); }
  querySelector(selector: string): Element | undefined { return this.children.find(child => child.className.split(/\s+/).includes(selector.replace(/^\./, ''))); }
  getBoundingClientRect(): { left: number; width: number } { return this.rect; }
  focus(): void {}
  setPointerCapture(_pointerId: number): void {}
  text(): string { return this.textContent + this.children.map(child => child.text()).join(' '); }
}

function dashboard(initialState: Record<string, unknown> = {}) {
  const html = readFileSync('media/dashboard.html', 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  elements.get('clonePercent')?.attributes.set('value', '0');
  elements.get('main')!.rect.width = 1200;
  elements.get('saved')!.rect.width = 711;
  elements.get('paneSplitter')!.rect.width = 14;
  const sent: Record<string, unknown>[] = [];
  let apiState = initialState;
  let receive: (event: { data: unknown }) => void;
  runInNewContext(readFileSync('media/dashboard.js', 'utf8'), {
    acquireVsCodeApi: () => ({
      getState: () => apiState,
      setState: (value: Record<string, unknown>) => { apiState = value; },
      postMessage: (value: unknown) => sent.push(JSON.parse(JSON.stringify(value)))
    }),
    document: { getElementById: (id: string) => {
      assert.ok(elements.has(id), `Missing HTML element: ${id}`);
      return elements.get(id);
    }, createElement: () => new Element() },
    window: { addEventListener: (_name: string, listener: typeof receive) => { receive = listener; } }
  });
  const element = (id: string) => elements.get(id)!;
  const folders = [
    { id: 'local', kind: 'local', name: '本地 <project>', path: '/Users/test/中文 code#%', favorite: true, lastOpenedAt: 100 },
    { id: 'remote', kind: 'remote', alias: 'dev', name: '远程项目', path: '/home/code', favorite: false, lastOpenedAt: 300 },
    { id: 'saved', kind: 'remote', alias: 'dev', name: '尚未打开', path: '/home/new', favorite: true, lastOpenedAt: null },
    { id: 'hidden', kind: 'remote', alias: 'old-server', name: '旧服务器项目', path: '/work/old', favorite: false, lastOpenedAt: 200 }
  ];
  const show = (view: string, alias?: string, extra: Record<string, unknown> = {}) => receive({ data: { type: 'snapshot', selectedView: view, selectedAlias: alias,
    folders, servers: [{ alias: 'dev', label: '开发服务器', configured: true }], browsePaths: {}, ...extra } });
  const rows = () => element('folders').children.filter(child => child.className === 'folder');
  const action = (row: Element, name: string) => row.children[1].children.find(child => child.textContent === name)!;
  const message = (data: unknown) => receive({ data });
  const getApiState = () => apiState;
  return { element, show, rows, action, sent, message, getApiState };
}

test('dashboard separates local, server, global history and favorites and searches their sources', () => {
  const ui = dashboard();
  ui.show('local');
  assert.equal(ui.element('main').dataset.view, 'local');
  assert.equal(ui.rows().length, 1);
  assert.match(ui.rows()[0].text(), /本地 <project>.*本地文件/);
  assert.equal(ui.element('browser').hidden, true);
  ui.element('addFolder').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'addLocalFolder' });

  ui.show('history');
  assert.deepEqual(ui.rows().map(row => row.children[0].children[0].textContent), ['远程项目', '旧服务器项目', '本地 <project>']);
  ui.element('search').value = '开发服务器'; ui.element('search').emit('input');
  assert.equal(ui.rows().length, 1);
  ui.element('search').value = '本地'; ui.element('search').emit('input');
  assert.equal(ui.rows().length, 1);
  ui.element('search').value = 'old-server'; ui.element('search').emit('input');
  assert.equal(ui.rows().length, 1);

  ui.show('favorites');
  assert.equal(ui.rows().length, 2);
  assert.equal(ui.element('search').value, '', 'A new sidebar view clears the previous search');
  assert.equal(ui.element('favoriteFilter').hidden, true);
  ui.show('server', 'dev');
  assert.equal(ui.element('main').dataset.view, 'server');
  assert.equal(ui.rows().length, 2);
  assert.equal(ui.element('browser').hidden, false);
  ui.show('all');
  assert.equal(ui.rows().length, 2, 'Hidden servers stay out of the server overview');
});

test('dashboard uses record IDs for both open modes and distinguishes deletion from removing a favorite', () => {
  const ui = dashboard();
  ui.show('local');
  ui.action(ui.rows()[0], '当前窗口').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'open', id: 'local', mode: 'current' });
  ui.action(ui.rows()[0], '新窗口').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'open', id: 'local', mode: 'new' });
  ui.show('history');
  ui.action(ui.rows()[0], '删除记录').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'remove', id: 'remote' });
  ui.show('favorites');
  ui.action(ui.rows()[0], '取消收藏').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'unfavorite', id: 'local' });
  assert.equal(ui.rows()[0].children[0].children[0].textContent, '本地 <project>');
});

test('server browser can replace a stale path before connecting and recover after a directory error', () => {
  const ui = dashboard();
  ui.show('server', 'dev', { initialPath: '/srv/deleted/project' });
  assert.equal(ui.element('path').disabled, false, 'the saved path remains editable while disconnected');
  assert.equal(ui.element('go').disabled, false);
  ui.element('path').value = '/srv/available';
  ui.element('connect').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'connect', alias: 'dev', path: '/srv/available' });
  ui.message({ type: 'error', message: '远程路径不存在。' });
  ui.message({ type: 'status', message: '目录读取失败；请输入其他路径。', busy: false, connected: true });
  assert.equal(ui.element('path').disabled, false);
  assert.equal(ui.element('go').disabled, false);
  assert.equal(ui.element('openCurrent').disabled, true, 'a failed initial read must not expose a stale open target');
  assert.equal(ui.element('cloneRepository').disabled, true);
  assert.match(ui.element('directories').text(), /输入.*路径/);
  ui.element('path').value = '/srv/valid';
  ui.element('path').emit('keydown', { key: 'Enter' });
  assert.deepEqual(ui.sent.at(-1), { type: 'browse', alias: 'dev', path: '/srv/valid' });
  assert.equal(ui.element('openCurrent').disabled, true, 'the previous directory is not left as an actionable target during navigation');
  ui.message({ type: 'status', message: '目录读取失败；可修改路径后点击「前往」，或重新连接。', busy: false, connected: true });
  assert.equal(ui.element('openCurrent').disabled, true, 'a failed navigation must not expose the previous directory as the new path');
  assert.equal(ui.element('cloneRepository').disabled, true);
  assert.equal(ui.element('target').textContent, '—');
  ui.element('path').emit('keydown', { key: 'Enter' });
  assert.deepEqual(ui.sent.at(-1), { type: 'browse', alias: 'dev', path: '/srv/valid' });
  ui.message({ type: 'browseResult', alias: 'dev', path: '/srv/valid', entries: [], backend: 'SFTP 后台浏览' });
  assert.equal(ui.element('openCurrent').disabled, false);

  ui.element('disconnect').emit('click');
  assert.equal(ui.element('path').disabled, false);
  ui.element('path').value = '/home/test';
  ui.element('go').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'connect', alias: 'dev', path: '/home/test' });
  ui.message({ type: 'status', message: '后台连接未就绪。', busy: false, connected: false });
  assert.equal(ui.element('path').disabled, false, 'connection failures must not lock out path edits either');
  assert.equal(ui.element('go').disabled, false);
});

test('dashboard resizer adjusts and remembers separate server and local pane widths', () => {
  const ui = dashboard({ paneRatios: { server: 60, local: 64 } });
  const splitter = ui.element('paneSplitter');
  ui.element('saved').rect.width = (1200 - 14) * 0.6;
  ui.show('server', 'dev');
  assert.equal(splitter.hidden, false);
  assert.equal(splitter.attributes.get('aria-label'), '调整项目列表和远程目录浏览宽度');
  assert.equal(ui.element('main').style.getPropertyValue('--saved-pane-track'), '60fr');

  let prevented = false;
  splitter.emit('keydown', { key: 'ArrowRight', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  const serverRatio = (ui.getApiState().paneRatios as Record<string, number>).server;
  assert.ok(serverRatio > 60 && serverRatio <= Number(splitter.attributes.get('aria-valuemax')));
  ui.element('saved').rect.width = (1200 - 14) * serverRatio / 100;
  splitter.emit('keydown', { key: 'Home', preventDefault: () => {} });
  assert.equal((ui.getApiState().paneRatios as Record<string, number>).server, Number(splitter.attributes.get('aria-valuemin')));
  splitter.emit('keydown', { key: 'End', preventDefault: () => {} });
  const serverMax = (ui.getApiState().paneRatios as Record<string, number>).server;

  ui.element('saved').rect.width = (1200 - 14) * 0.64;
  ui.show('local');
  assert.equal(splitter.hidden, false);
  assert.equal(splitter.attributes.get('aria-label'), '调整本地项目列表和克隆面板宽度');
  assert.equal(ui.element('main').style.getPropertyValue('--saved-pane-track'), '64fr');
  splitter.emit('keydown', { key: 'ArrowLeft', shiftKey: true, preventDefault: () => {} });
  const localRatio = (ui.getApiState().paneRatios as Record<string, number>).local;
  assert.ok(localRatio < 64);
  assert.equal((ui.getApiState().paneRatios as Record<string, number>).server, serverMax, 'the remote and local layouts remember their ratios independently');

  splitter.emit('pointerdown', { button: 0, pointerId: 7, clientX: 700, preventDefault: () => {} });
  splitter.emit('pointermove', { pointerId: 7, clientX: 760 });
  splitter.emit('pointerup', { pointerId: 7 });
  assert.ok((ui.getApiState().paneRatios as Record<string, number>).local > localRatio);
  assert.equal(splitter.className.includes('dragging'), false);

  ui.show('history');
  assert.equal(splitter.hidden, true, 'the splitter is not exposed when the page uses a single column');

  const rememberedLocalRatio = (ui.getApiState().paneRatios as Record<string, number>).local;
  ui.element('main').rect.width = 788;
  splitter.rect.width = 0;
  ui.show('server', 'dev');
  ui.show('local');
  ui.element('main').rect.width = 1200;
  splitter.rect.width = 14;
  ui.show('server', 'dev');
  assert.equal(ui.element('main').style.getPropertyValue('--saved-pane-track'), `${serverMax}fr`, 'switching views in a stacked layout must not overwrite the wider layout');
  ui.show('local');
  assert.equal(ui.element('main').style.getPropertyValue('--saved-pane-track'), `${rememberedLocalRatio}fr`);
});

test('server browser submits a clone target and displays progress and completion feedback', () => {
  const ui = dashboard();
  ui.show('server', 'dev');
  ui.element('connect').emit('click');
  ui.message({ type: 'browseResult', alias: 'dev', path: '/srv/work', entries: [
    { name: 'projects', path: '/srv/work/projects', symlink: false }
  ], backend: 'SFTP 后台浏览' });
  const directory = ui.element('directories').children[0].children[0];
  directory.emit('click');
  ui.element('repositoryUrl').value = 'git@github.com:team/repo.git';
  ui.element('repositoryUrl').emit('input');
  assert.equal(ui.element('cloneRepository').disabled, false);
  ui.element('cloneRepository').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'clone', alias: 'dev', path: '/srv/work/projects', url: 'git@github.com:team/repo.git' });
  assert.equal(ui.element('clonePercent').hidden, false, 'an indeterminate progress bar is visible before Git reports a percentage');
  assert.equal(ui.element('clonePercent').attributes.has('value'), false);
  ui.message({ type: 'cloneProgress', phase: 'receiving', message: '接收对象 63%', percent: 63 });
  assert.equal(ui.element('cloneProgress').hidden, false);
  assert.equal(ui.element('cloneMessage').textContent, '接收对象 63%');
  assert.equal(ui.element('clonePercent').value, 63);
  ui.show('history', undefined, { cloneOperation: { scope: 'remote', phase: 'receiving', message: '接收对象 63%', percent: 63 }, cloneResult: null });
  assert.equal(ui.element('cloneResult').hidden, false, 'active clone status remains visible after changing the sidebar view');
  assert.equal(ui.element('cloneResultMessage').textContent, '接收对象 63%');
  ui.element('cancelClone').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'cancelClone' });
  ui.message({ type: 'cloneProgress', message: '正在取消克隆…', canceling: true });
  assert.equal(ui.element('cancelClone').disabled, true, 'the cancel button stays disabled while the remote command stops');
  ui.message({ type: 'cloneFailed', scope: 'remote', message: '连接已取消。',
    result: { scope: 'remote', state: 'cancelled', message: '连接已取消。' } });
  assert.equal(ui.element('cloneProgress').hidden, true);
  assert.equal(ui.element('cloneResultTitle').textContent, '− 克隆已取消');

  ui.show('server', 'dev');
  ui.element('connect').emit('click');
  ui.message({ type: 'browseResult', alias: 'dev', path: '/srv/work/projects', entries: [], backend: 'SFTP 后台浏览' });
  ui.element('cloneRepository').emit('click');
  assert.equal(ui.sent.at(-1)?.type, 'clone');
  const remoteResult = { scope: 'remote', state: 'success', message: '已克隆到 /srv/work/projects/repo。', path: '/srv/work/projects/repo', alias: 'dev' };
  ui.message({ type: 'cloneComplete', scope: 'remote', result: remoteResult, message: remoteResult.message });
  assert.equal(ui.element('cloneProgress').hidden, true);
  assert.equal(ui.element('cloneResultTitle').textContent, '✓ 远程克隆完成');
  assert.equal(ui.element('cloneResultPath').textContent, remoteResult.path);
  assert.equal(ui.element('openCloneCurrent').hidden, false);
  ui.element('openCloneCurrent').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'openCloneResult', mode: 'current' });
  ui.element('openCloneNew').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'openCloneResult', mode: 'new' });
  ui.show('history', undefined, { cloneResult: remoteResult, cloneOperation: null });
  assert.equal(ui.element('cloneResultPath').textContent, remoteResult.path, 'completed result is restored from the extension snapshot');
  ui.show('server', 'dev', { cloneResult: remoteResult, cloneOperation: null, initialPath: remoteResult.path,
    browsePaths: { dev: remoteResult.path } });
  assert.equal(ui.element('path').value, remoteResult.path, 'the server browser returns to the cloned repository directory');
});

test('local view clones through the local Git flow and keeps unopened projects out of history', () => {
  const ui = dashboard();
  ui.show('local');
  assert.equal(ui.element('localClone').hidden, false);
  assert.equal(ui.element('localCloneProgress').hidden, true);
  assert.equal(ui.element('cloneLocalRepository').disabled, true);

  ui.element('selectLocalCloneParent').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'selectLocalCloneParent' });
  ui.message({ type: 'localCloneParent', path: '/Users/test/Projects' });
  ui.element('localRepositoryUrl').value = 'git@github.com:team/repo.git';
  ui.element('localRepositoryUrl').emit('input');
  assert.equal(ui.element('cloneLocalRepository').disabled, false);

  ui.element('cloneLocalRepository').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'cloneLocal', parentPath: '/Users/test/Projects', url: 'git@github.com:team/repo.git' });
  ui.message({ type: 'cloneProgress', scope: 'local', phase: 'receiving', message: '接收对象 41%', percent: 41 });
  assert.equal(ui.element('localCloneProgress').hidden, false);
  assert.equal(ui.element('localCloneMessage').textContent, '接收对象 41%');
  assert.equal(ui.element('localClonePercent').value, 41);
  ui.element('cancelLocalClone').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'cancelClone' });

  ui.message({ type: 'cloneFailed', scope: 'local', message: '克隆已取消。',
    result: { scope: 'local', state: 'cancelled', message: '克隆已取消。' } });
  assert.equal(ui.element('localCloneProgress').hidden, true);
  ui.element('cloneLocalRepository').emit('click');
  const localResult = { scope: 'local', state: 'success', message: '已克隆到 /Users/test/Projects/repo，已加入本地项目列表。', path: '/Users/test/Projects/repo' };
  ui.message({ type: 'cloneComplete', scope: 'local', message: localResult.message, result: localResult });
  assert.equal(ui.element('cloneResultTitle').textContent, '✓ 本机克隆完成');
  assert.equal(ui.element('cloneResultPath').textContent, localResult.path);
  ui.element('openCloneCurrent').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'openCloneResult', mode: 'current' });
  ui.element('openCloneNew').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'openCloneResult', mode: 'new' });
  ui.show('history', undefined, { cloneResult: localResult, cloneOperation: null });
  assert.equal(ui.element('cloneResultPath').textContent, localResult.path);
});

test('browser folder controls distinguish current parent from selection and recover after completion or cancellation', () => {
  const ui = dashboard();
  ui.show('server', 'dev');
  assert.equal(ui.element('createDirectory').disabled, true);
  assert.equal(ui.element('deleteDirectory').disabled, true);
  ui.message({ type: 'browseResult', alias: 'dev', path: '/srv', entries: [
    { name: 'code', path: '/srv/code', symlink: false }
  ], backend: 'fixture' });
  assert.equal(ui.element('createDirectory').disabled, false);
  assert.equal(ui.element('deleteDirectory').disabled, true, 'deleting the current directory is never offered');
  ui.element('directories').children[0].children[0].emit('click');
  assert.equal(ui.element('deleteDirectory').disabled, false);
  ui.element('createDirectory').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'createDirectory', alias: 'dev', parentPath: '/srv' });
  assert.equal(ui.element('go').disabled, true);
  assert.equal(ui.element('deleteDirectory').disabled, true);
  assert.equal(ui.element('directoryOperationStatus').hidden, false);
  ui.message({ type: 'directoryOperation', alias: 'dev', busy: false });
  assert.equal(ui.element('createDirectory').disabled, false, 'cancelling the native prompt restores controls');
  ui.element('deleteDirectory').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'deleteDirectory', alias: 'dev', parentPath: '/srv', path: '/srv/code' });
  ui.message({ type: 'browseResult', alias: 'dev', path: '/srv', selectedPath: '/srv/new folder', entries: [
    { name: 'new folder', path: '/srv/new folder', symlink: false }
  ], backend: 'fixture' });
  ui.message({ type: 'directoryOperation', alias: 'dev', busy: false });
  assert.equal(ui.element('target').textContent, 'dev : /srv/new folder');
  assert.equal(ui.element('deleteDirectory').disabled, false);
  ui.element('repositoryUrl').value = 'http://git.example.test/team/repo.git';
  ui.element('cloneRepository').emit('click');
  assert.equal(ui.sent.at(-1)?.url, 'http://git.example.test/team/repo.git');
  assert.equal(ui.element('createDirectory').disabled, true, 'directory writes cannot race with Git clone');
});
