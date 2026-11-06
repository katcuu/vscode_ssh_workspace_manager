import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Server, utils } from 'ssh2';
import { ASKPASS_PIPE_ENV, LocalGitAskPassBridge } from '../src/localGitClone';

const helperPath = path.resolve('media/git-askpass.cjs');

function runAskPass(endpoint: string, prompt: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, prompt], {
      env: { ...process.env, [ASKPASS_PIPE_ENV]: endpoint },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr?.setEncoding('utf8').on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('local askpass bridge returns credential input to Git without adding a newline', async () => {
  const prompts: string[] = [];
  const bridge = new LocalGitAskPassBridge(async prompt => { prompts.push(prompt); return 'fixture-local-token'; });
  await bridge.listen();
  try {
    const result = await runAskPass(bridge.endpoint, "Password for 'https://git.example.test': ");
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'fixture-local-token');
    assert.equal(result.stderr, '');
    assert.deepEqual(prompts, ["Password for 'https://git.example.test': "]);
  } finally {
    await bridge.close();
  }
  if (process.platform !== 'win32') await assert.rejects(() => stat(bridge.endpoint));
});

test('local askpass bridge treats cancelled input as a failed prompt without exposing a value', async () => {
  const bridge = new LocalGitAskPassBridge(async () => undefined);
  await bridge.listen();
  try {
    const result = await runAskPass(bridge.endpoint, "Username for 'https://git.example.test': ");
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
  } finally {
    await bridge.close();
  }
});

test('real OpenSSH invokes the local askpass launcher from a path with spaces', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-askpass spaces-'));
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const parsed = utils.parseKey(key);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('fixture key');
  const clients = new Set<import('ssh2').Connection>();
  const prompts: string[] = [];
  const bridge = new LocalGitAskPassBridge(async prompt => { prompts.push(prompt); return 'fixture-password'; });
  const server = new Server({ hostKeys: [key] }, connection => {
    clients.add(connection); connection.on('close', () => clients.delete(connection)); connection.on('error', () => {});
    connection.on('authentication', context => context.method === 'password' && context.password === 'fixture-password'
      ? context.accept() : context.reject(['password']));
    connection.on('ready', () => connection.on('session', accept => accept().on('exec', acceptExec => {
      const channel = acceptExec(); channel.exit(0); channel.end();
    })));
  });
  t.after(async () => {
    for (const client of clients) client.end();
    await bridge.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await bridge.listen();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  const config = path.join(directory, 'config');
  const known = path.join(directory, 'known_hosts');
  await writeFile(config, 'Host *\n  PubkeyAuthentication no\n  PreferredAuthentications password\n  NumberOfPasswordPrompts 1\n');
  await writeFile(known, `[127.0.0.1]:${port} ssh-rsa ${parsed.getPublicSSH().toString('base64')}\n`);
  const launcherName = process.platform === 'win32' ? 'git-askpass.cmd' : 'git-askpass.sh';
  const launcher = path.join(directory, launcherName);
  await copyFile(path.resolve('media', launcherName), launcher);
  if (process.platform !== 'win32') await chmod(launcher, 0o700);
  const helper = path.join(directory, 'helper with spaces.cjs');
  await writeFile(helper, await readFile(helperPath));
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn('ssh', ['-F', config, '-p', String(port), '-o', `UserKnownHostsFile="${known.replace(/\\/g, '/')}"`,
      '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'fixture@127.0.0.1', 'true'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C', SSH_ASKPASS_REQUIRE: 'force', SSH_ASKPASS: launcher, ELECTRON_RUN_AS_NODE: '1',
        SSH_WORKSPACE_MANAGER_ASKPASS_NODE: process.execPath, SSH_WORKSPACE_MANAGER_ASKPASS_HELPER: helper,
        [ASKPASS_PIPE_ENV]: bridge.endpoint }
    });
    t.after(() => { child.kill(); });
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /password/i);
  assert.doesNotMatch(result.stderr, /fixture-password/);
});
