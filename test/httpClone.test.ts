import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { cloneLocalRepository } from '../src/localGitClone';

const run = promisify(execFile);

test('real Git clones public and authenticated HTTP repositories, and cancelled HTTP credentials settle', { timeout: 30000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ssh-manager-http-'));
  const source = path.join(root, 'source');
  const helpers = path.join(root, 'helper with spaces'); await mkdir(helpers);
  const helper = path.join(helpers, 'git-askpass.cjs');
  const launcher = path.join(helpers, process.platform === 'win32' ? 'git-askpass.cmd' : 'git-askpass.sh');
  await copyFile(path.resolve('media/git-askpass.cjs'), helper);
  await copyFile(path.resolve('media', path.basename(launcher)), launcher);
  if (process.platform !== 'win32') await chmod(launcher, 0o700);
  await mkdir(source);
  await run('git', ['init', source]);
  // Keep the fixture independent of the runner's core.autocrlf setting.
  await writeFile(path.join(source, '.gitattributes'), 'hello.txt -text\n');
  await writeFile(path.join(source, 'hello.txt'), 'HTTP clone fixture\n');
  await run('git', ['-C', source, 'add', '.gitattributes', 'hello.txt']);
  await run('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const bare = path.join(root, 'repo.git');
  await run('git', ['clone', '--bare', source, bare]);
  await run('git', ['--git-dir', bare, 'update-server-info']);
  let requireAuth = false;
  const requests: { path?: string; authenticated: boolean }[] = [];
  const authorization = 'Basic ' + Buffer.from('fixture-user:fixture-token').toString('base64');
  const server = createServer(async (request, response) => {
    requests.push({ path: request.url, authenticated: request.headers.authorization === authorization });
    if (requireAuth && request.headers.authorization !== authorization) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' }); response.end(); return;
    }
    try {
      const requested = new URL(request.url || '/', 'http://fixture').pathname;
      const file = path.resolve(bare, '.' + requested.replace(/^\/repo\.git/, ''));
      if (!file.startsWith(bare + path.sep)) { response.writeHead(404); response.end(); return; }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/repo.git`;
  const prompts: string[] = [];
  for (const authenticated of [false, true]) {
    requireAuth = authenticated;
    const parent = path.join(root, authenticated ? 'authenticated' : 'public'); await mkdir(parent);
    const destination = await cloneLocalRepository(parent, url, helper, {
      username: async target => { prompts.push('username'); assert.match(target, /^http:\/\//); return 'fixture-user'; },
      password: async (_target, user) => { prompts.push('password'); assert.equal(user, 'fixture-user'); return 'fixture-token'; },
      sshPassword: async () => assert.fail('HTTP does not use SSH authentication'), passphrase: async () => undefined
    }, new AbortController().signal, () => {}).catch(error => {
      t.diagnostic(JSON.stringify({ authenticated, prompts, requests })); throw error;
    });
    assert.equal(await readFile(path.join(destination, 'hello.txt'), 'utf8'), 'HTTP clone fixture\n');
    assert.doesNotMatch(await readFile(path.join(destination, '.git', 'config'), 'utf8'), /fixture-user|fixture-token/);
    if (!authenticated) assert.deepEqual(prompts, []);
  }
  assert.deepEqual(prompts, ['username', 'password']);
  const cancelled = path.join(root, 'cancelled'); await mkdir(cancelled);
  await assert.rejects(() => cloneLocalRepository(cancelled, url, helper, {
    username: async () => undefined, password: async () => assert.fail('Cancelled username must stop'),
    sshPassword: async () => undefined, passphrase: async () => undefined
  }, new AbortController().signal, () => {}), /取消/);
});
