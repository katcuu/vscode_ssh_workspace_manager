import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { createServer as createNetServer, Server as NetServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { Server, utils } from 'ssh2';
import { connectSftp, ConnectionPrompts } from '../src/sftp';
import { parseResolvedConfig, ResolvedSshConfig } from '../src/sshConfig';
import { SshDiagnostics } from '../src/sshDiagnostics';

const hostPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const userPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const parsedHost = utils.parseKey(hostPrivateKey), parsedUser = utils.parseKey(userPrivateKey);
if (parsedHost instanceof Error || parsedUser instanceof Error || Array.isArray(parsedHost) || Array.isArray(parsedUser)) throw new Error('fixture keys');
const hostPublicKey = parsedHost.getPublicSSH(), userPublicKey = parsedUser.getPublicSSH();

test('real SSH/SFTP protocol: key first, password fallback, host trust, directories, cancellation', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-sftp-'));
  const clients = new Set<import('ssh2').Connection>();
  const attempts: string[] = [];
  const { STATUS_CODE } = utils.sftp;
  const server = new Server({ hostKeys: [hostPrivateKey] }, connection => {
    clients.add(connection); connection.on('close', () => clients.delete(connection)); connection.on('error', () => {});
    connection.on('authentication', context => {
      attempts.push(context.method);
      if (context.method === 'publickey' && context.key.data.equals(userPublicKey)) context.accept();
      else if (context.method === 'password' && context.password === 'fixture-password') context.accept();
      else context.reject(['publickey', 'password']);
    });
    connection.on('ready', () => connection.on('session', accept => {
      accept().on('sftp', acceptSftp => {
        const sftp = acceptSftp();
        const readHandles = new Set<number>(); let nextHandle = 1;
        const directories = new Set(['/home/test', '/home/test/中文 code#%', '/home/test/link', '/home/test/.hidden']);
        const attrs = (mode = 0o40755) => ({ mode, uid: 1000, gid: 1000, size: 0, atime: 1, mtime: 1 });
        sftp.on('REALPATH', (id, value) => sftp.name(id, [{ filename: value === '.' ? '/home/test' : value, longname: '', attrs: attrs() }]));
        sftp.on('STAT', (id, value) => {
          if (directories.has(value)) sftp.attrs(id, attrs());
          else sftp.status(id, value.includes('denied') ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.NO_SUCH_FILE);
        });
        sftp.on('OPENDIR', (id, value) => {
          if (!directories.has(value)) { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); return; }
          const handle = Buffer.alloc(4); handle.writeUInt32BE(nextHandle++); sftp.handle(id, handle);
        });
        sftp.on('READDIR', (id, handle) => {
          const value = handle.readUInt32BE();
          if (readHandles.has(value)) { sftp.status(id, STATUS_CODE.EOF); return; }
          readHandles.add(value);
          sftp.name(id, [
            { filename: '中文 code#%', longname: '', attrs: attrs() },
            { filename: '.hidden', longname: '', attrs: attrs() },
            { filename: 'source.ts', longname: '', attrs: attrs(0o100644) },
            { filename: 'link', longname: '', attrs: attrs(0o120777) }
          ]);
        });
        sftp.on('CLOSE', id => sftp.status(id, STATUS_CODE.OK));
      });
    }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  const keyFile = path.join(directory, 'id_rsa'); await writeFile(keyFile, userPrivateKey, { mode: 0o600 });
  const knownHostsFile = path.join(directory, 'known_hosts');
  await writeFile(knownHostsFile, `[127.0.0.1]:${port} ssh-rsa ${hostPublicKey.toString('base64')}\n`);
  t.after(async () => {
    for (const client of clients) client.end();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const config: ResolvedSshConfig = {
    alias: 'fixture', host: '127.0.0.1', port, username: 'test', identityFiles: [keyFile],
    knownHostsFiles: [knownHostsFile], identitiesOnly: false, publicKeyAuthentication: true, passwordAuthentication: true
  };
  let passwords = 0, trustPrompts = 0;
  const prompts: ConnectionPrompts = {
    password: async () => { passwords++; return 'fixture-password'; }, passphrase: async () => undefined,
    trustHost: async () => { trustPrompts++; return false; }
  };
  const session = await connectSftp(config, prompts, new AbortController().signal);
  assert.equal(await session.homeDirectory(), '/home/test');
  const entries = await session.listDirectories('/home/test');
  assert.equal(passwords, 0); assert.equal(trustPrompts, 0);
  assert.equal(entries.length, 3); assert.equal(entries.find(entry => entry.name === 'link')?.symlink, true);
  assert.ok(!entries.some(entry => entry.name === 'source.ts'));
  await assert.rejects(() => session.listDirectories('/missing'), /不存在/);
  await assert.rejects(() => session.listDirectories('/denied'), /权限/);
  session.close();
  const passwordSession = await connectSftp({ ...config, identityFiles: [] }, prompts, new AbortController().signal);
  assert.equal(passwords, 1); passwordSession.close();
  assert.ok(attempts.includes('publickey') && attempts.includes('password'));
  await assert.rejects(() => connectSftp({ ...config, identityFiles: [] }, { ...prompts, password: async () => 'wrong-password' }, new AbortController().signal), /认证失败/);
  await assert.rejects(() => connectSftp({ ...config, knownHostsFiles: [] }, prompts, new AbortController().signal), /未信任/);
  const controller = new AbortController();
  const pending = connectSftp({ ...config, identityFiles: [] }, {
    ...prompts, password: async () => { controller.abort(); return undefined; }
  }, controller.signal);
  await assert.rejects(() => pending, /取消/);

  let acceptedTrust = 0;
  const unknownHost = { ...config, knownHostsFiles: [] };
  const trustedSession = await connectSftp(unknownHost, {
    ...prompts, trustHost: async () => { acceptedTrust += 1; return true; }
  }, new AbortController().signal);
  assert.equal(acceptedTrust, 1, 'An unknown host is offered for one-time trust before authentication');
  trustedSession.close();

  let changedTrust = 0;
  const changedHostFile = path.join(directory, 'changed-known-hosts');
  const otherHostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const parsedOtherHost = utils.parseKey(otherHostKey);
  if (parsedOtherHost instanceof Error || Array.isArray(parsedOtherHost)) throw new Error('fixture key');
  await writeFile(changedHostFile, `[127.0.0.1]:${port} ssh-rsa ${parsedOtherHost.getPublicSSH().toString('base64')}\n`);
  await assert.rejects(() => connectSftp({ ...config, knownHostsFiles: [changedHostFile] }, {
    ...prompts, trustHost: async () => { changedTrust += 1; return true; }
  }, new AbortController().signal), /密钥与 known_hosts 不一致/);
  assert.equal(changedTrust, 0, 'A changed host key is rejected without an override prompt');
});

test('Windows OpenSSH agent failures and empty agents continue to key/password fallback', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-agent-'));
  const clients = new Set<import('ssh2').Connection>();
  const methods: string[] = [];
  const server = new Server({ hostKeys: [hostPrivateKey] }, connection => {
    clients.add(connection); connection.on('close', () => clients.delete(connection)); connection.on('error', () => {});
    connection.on('authentication', context => {
      methods.push(context.method);
      if (context.method === 'publickey' && context.key.data.equals(userPublicKey)) context.accept();
      else if (context.method === 'password' && context.password === 'fixture-password') context.accept();
      else context.reject(['publickey', 'password']);
    });
    connection.on('ready', () => connection.on('session', accept => accept().on('sftp', acceptSftp => {
      const sftp = acceptSftp();
      sftp.on('REALPATH', (id, value) => sftp.name(id, [{ filename: value === '.' ? '/home/test' : value, longname: '', attrs: { mode: 0o40755, uid: 1, gid: 1, size: 0, atime: 1, mtime: 1 } }]));
      sftp.on('STAT', (id, value) => value === '/home/test'
        ? sftp.attrs(id, { mode: 0o40755, uid: 1, gid: 1, size: 0, atime: 1, mtime: 1 })
        : sftp.status(id, utils.sftp.STATUS_CODE.NO_SUCH_FILE));
      sftp.on('OPENDIR', id => sftp.status(id, utils.sftp.STATUS_CODE.NO_SUCH_FILE));
    })));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  const keyFile = path.join(directory, '私钥 with spaces');
  await writeFile(keyFile, userPrivateKey);
  const agentPath = process.platform === 'win32' ? `\\\\.\\pipe\\ssh-manager-empty-agent-${process.pid}-${randomUUID()}` : path.join(directory, 'empty-agent.sock');
  const agent: NetServer = createNetServer(socket => {
    let input = Buffer.alloc(0);
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 4) {
        const length = input.readUInt32BE(0);
        if (input.length < length + 4) break;
        const type = input[4]; input = input.subarray(length + 4);
        if (type === 11) socket.write(Buffer.from([0, 0, 0, 5, 12, 0, 0, 0, 0]));
      }
    });
  });
  await new Promise<void>((resolve, reject) => { agent.once('error', reject); agent.listen(agentPath, resolve); });
  t.after(async () => {
    for (const client of clients) client.end();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => agent.close(() => resolve()))]);
    await rm(directory, { recursive: true, force: true });
  });
  const config: ResolvedSshConfig = { alias: 'agent-fixture', host: '127.0.0.1', port, username: 'test', identityFiles: [keyFile],
    identityAgent: agentPath, knownHostsFiles: [], identitiesOnly: false, publicKeyAuthentication: true, passwordAuthentication: true };
  let passwordPrompts = 0, trustPrompts = 0;
  const prompts: ConnectionPrompts = { password: async () => { passwordPrompts += 1; return 'fixture-password'; },
    passphrase: async () => undefined, trustHost: async () => { trustPrompts += 1; return true; } };
  const diagnostics: string[] = [];
  const log = new SshDiagnostics(line => diagnostics.push(line));
  const withKey = await connectSftp(config, prompts, new AbortController().signal, log);
  assert.equal(await withKey.homeDirectory(), '/home/test');
  withKey.close();
  assert.ok(methods.includes('publickey'), 'A failed/empty agent proceeds to the configured key');
  assert.equal(passwordPrompts, 0);
  assert.equal(trustPrompts, 1);
  assert.ok(diagnostics.some(line => line.includes('"stage":"agent"') && line.includes('"event":"attempt"')),
    'A reachable agent with no identities is attempted before the configured key');
  assert.ok(diagnostics.some(line => line.includes('no-usable-key-continuing-authentication')),
    'An agent with no usable identities is recorded before fallback');

  const missingAgentPath = process.platform === 'win32' ? `\\\\.\\pipe\\ssh-manager-missing-agent-${process.pid}-${randomUUID()}` : path.join(directory, 'missing-agent.sock');
  const withMissingAgent = await connectSftp({ ...config, identityAgent: missingAgentPath }, prompts, new AbortController().signal, log);
  assert.equal(await withMissingAgent.homeDirectory(), '/home/test');
  withMissingAgent.close();
  assert.ok(diagnostics.some(line => line.includes('unavailable-continuing-authentication') && line.includes('"level":"agent"')
    && line.includes('Failed to connect to agent')), 'The raw agent error level and message are preserved');

  const encryptedPassword = 'fixture-key-passphrase';
  const encryptedKeyFile = path.join(directory, 'encrypted key with spaces');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', encryptedPassword, '-f', encryptedKeyFile], { windowsHide: true });
  const encryptedKeyText = await readFile(encryptedKeyFile, 'utf8');
  const parsedEncrypted = utils.parseKey(encryptedKeyText, encryptedPassword);
  if (parsedEncrypted instanceof Error || Array.isArray(parsedEncrypted)) throw new Error('encrypted fixture key');
  const encryptedUserPublicKey = parsedEncrypted.getPublicSSH();
  const encryptedAttempts: string[] = [];
  // This fixture connection accepts the encrypted fixture key alongside the original key.
  const encryptedServer = new Server({ hostKeys: [hostPrivateKey] }, connection => {
    connection.on('error', () => {});
    connection.on('authentication', context => {
      encryptedAttempts.push(context.method);
      if (context.method === 'publickey' && context.key.data.equals(encryptedUserPublicKey)) context.accept();
      else context.reject(['publickey']);
    });
    connection.on('ready', () => connection.on('session', accept => accept().on('sftp', acceptSftp => {
      const sftp = acceptSftp();
      sftp.on('REALPATH', (id, value) => sftp.name(id, [{ filename: value === '.' ? '/home/test' : value, longname: '', attrs: { mode: 0o40755, uid: 1, gid: 1, size: 0, atime: 1, mtime: 1 } }]));
    })));
  });
  await new Promise<void>((resolve, reject) => { encryptedServer.once('error', reject); encryptedServer.listen(0, '127.0.0.1', resolve); });
  const encryptedPort = (encryptedServer.address() as AddressInfo).port;
  t.after(() => new Promise<void>(resolve => encryptedServer.close(() => resolve())));
  const passphrases: string[] = [];
  const encryptedSession = await connectSftp({ ...config, host: '127.0.0.1', port: encryptedPort,
    identityAgent: undefined, identityFiles: [encryptedKeyFile] }, {
    ...prompts, passphrase: async () => { passphrases.push(encryptedPassword); return encryptedPassword; }
  }, new AbortController().signal, log);
  assert.equal(await encryptedSession.homeDirectory(), '/home/test');
  encryptedSession.close();
  assert.deepEqual(passphrases, [encryptedPassword]);
  assert.ok(encryptedAttempts.includes('publickey'));
  assert.ok(!diagnostics.join('\n').includes(encryptedPassword), 'Private-key passphrases never appear in diagnostics');

  const missingKey = { ...config, identityAgent: missingAgentPath,
    identityFiles: [path.join(directory, 'missing key')] };
  const withPassword = await connectSftp(missingKey, prompts, new AbortController().signal);
  assert.equal(await withPassword.homeDirectory(), '/home/test');
  withPassword.close();
  assert.equal(passwordPrompts, 1, 'Unavailable agent and unreadable key reach password fallback');
  assert.ok(methods.includes('password'));

  const cancelled = await assert.rejects(() => connectSftp({ ...missingKey, identityAgent: undefined }, {
    ...prompts, password: async () => undefined
  }, new AbortController().signal), /取消/);
  assert.equal(cancelled, undefined);
});

test('SSH diagnostics keep raw error codes and redact credentials and private keys', () => {
  const lines: string[] = [];
  const diagnostics = new SshDiagnostics(line => lines.push(line));
  const config = parseResolvedConfig('private-alias', 'hostname private.example\nuser private-user\nport 2222\n');
  diagnostics.configure(config);
  diagnostics.secret('private-user:private-password');
  diagnostics.event('key', 'invalid', { detail: String(userPrivateKey) });
  diagnostics.event('tcp', 'client-error', {}, Object.assign(new Error('authentication rejected for private-user with private-user:private-password'), {
    code: 'ECONNRESET', level: 'client-timeout', cause: Object.assign(new Error('private-user:private-password'), { code: 'EPIPE', level: 'agent' })
  }));
  const output = lines.join('\n');
  assert.ok(output.includes('ECONNRESET') && output.includes('client-timeout') && output.includes('EPIPE') && output.includes('agent'));
  assert.ok(!output.includes('private-password') && !output.includes('private-user') && !output.includes('private.example') && !output.includes('private-alias'));
  assert.ok(output.includes('<private-key>') && !output.includes(String(userPrivateKey).split('\n')[1]));
});

test('TCP connection errors retain their code and report a retryable endpoint error', async () => {
  const closed = createNetServer();
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>(resolve => closed.close(() => resolve()));
  const lines: string[] = [];
  const diagnostics = new SshDiagnostics(line => lines.push(line));
  await assert.rejects(() => connectSftp({ alias: 'refused-fixture', host: '127.0.0.1', port, username: 'test',
    identityFiles: [], knownHostsFiles: [], identitiesOnly: false, publicKeyAuthentication: true, passwordAuthentication: true }, {
    password: async () => undefined, passphrase: async () => undefined, trustHost: async () => false
  }, new AbortController().signal, diagnostics), error => {
    assert.match((error as Error).message, /连接被拒绝/);
    assert.match((error as Error & { cause: Error }).cause.message, /ECONNREFUSED/);
    return true;
  });
  assert.ok(lines.some(line => line.includes('"stage":"tcp"') && line.includes('ECONNREFUSED')));
});
