import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { Server, utils } from 'ssh2';
import { connectSftp, ConnectionPrompts } from '../src/sftp';
import { ResolvedSshConfig } from '../src/sshConfig';

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
});
