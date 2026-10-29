import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { utils } from 'ssh2';
import { authorityForAlias, emptyCatalog, hideServer, makeFolder, normalizeRemotePath, restoreServer, validateCatalog, visibleServers } from '../src/model';
import { addSshHost, hostBlock } from '../src/sshConfigWriter';
import { CatalogStore } from '../src/store';
import { configWords, parseResolvedConfig, readHostAliases } from '../src/sshConfig';
import { checkKnownHosts, fingerprint } from '../src/trust';

test('Linux paths preserve Unicode, spaces, # and percent; reject relative/control inputs', () => {
  const folder = makeFolder('dev', '/home/user/中文 code/#100%/../project');
  assert.equal(folder.path, '/home/user/中文 code/project');
  assert.equal(folder.lastOpenedAt, null);
  assert.equal(normalizeRemotePath('/x/#100%'), '/x/#100%');
  assert.notEqual(makeFolder('dev', '/x/Project').id, makeFolder('dev', '/x/project').id);
  assert.notEqual(makeFolder('dev', '/x').id, makeFolder('prod', '/x').id);
  assert.equal(makeFolder('dev', '/x/').id, makeFolder('dev', '/x//').id);
  assert.equal(makeFolder('dev', '/x/').id, makeFolder('dev', '/x').id);
  for (const value of ['relative', '~', '/abc\0def', '/a\nb']) assert.throws(() => normalizeRemotePath(value));
  assert.throws(() => authorityForAlias('-oProxyCommand=cmd'));
  assert.throws(() => makeFolder('dev', '/x', 'ssh-remote+prod'));
});

test('SSH config enumerates concrete aliases, quoted values, absolute Include and cycles', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const main = path.join(directory, 'config');
  await writeFile(main, `Host dev build # comment\n  HostName localhost\nHost *.example !excluded\nInclude "${directory}/part*.conf"\n`);
  await writeFile(path.join(directory, 'part1.conf'), `Host test\nInclude "${main}"\n`);
  assert.deepEqual(await readHostAliases(main), ['build', 'dev', 'test']);
  assert.deepEqual(configWords('IdentityFile = "~/my keys/id" # comment'), ['IdentityFile', '~/my keys/id']);
  const resolved = parseResolvedConfig('dev', 'hostname 127.0.0.1\nuser coder\nport 2222\nidentityfile /keys/id\npasswordauthentication yes\nidentitiesonly yes\nuserknownhostsfile /tmp/known_hosts\n');
  assert.equal(resolved.port, 2222); assert.equal(resolved.identitiesOnly, true);
  assert.deepEqual(resolved.identityFiles, ['/keys/id']);
  assert.throws(() => parseResolvedConfig('dev', 'proxyjump bastion\n'), /proxyjump/);
  assert.throws(() => parseResolvedConfig('dev', 'proxycommand nc host 22\n'), /proxycommand/);
});

test('known_hosts recognizes plain/hashed hosts, nondefault ports, changed and revoked keys', () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('key generation failed');
  const key = parsed.getPublicSSH();
  const line = `dev ssh-rsa ${key.toString('base64')}\n`;
  assert.equal(checkKnownHosts(line, 'dev', key), 'known');
  assert.equal(checkKnownHosts(line, 'other', key), 'unknown');
  const salt = Buffer.from('fixture-salt');
  const host = '[dev]:2222';
  const hash = createHmac('sha1', salt).update(host).digest('base64');
  assert.equal(checkKnownHosts(`|1|${salt.toString('base64')}|${hash} ssh-rsa ${key.toString('base64')}`, host, key), 'known');
  const modified = Buffer.from(key); modified[modified.length - 1] ^= 1;
  assert.equal(checkKnownHosts(line, 'dev', modified), 'changed');
  assert.equal(checkKnownHosts(`@revoked ${line}`, 'dev', key), 'revoked');
  assert.match(fingerprint(key), /^SHA256:[A-Za-z0-9+/]+$/);
});

test('parallel windows merge catalog updates without losing metadata; corrupt data stays intact', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stores = [new CatalogStore(directory), new CatalogStore(directory)];
  await Promise.all(Array.from({ length: 12 }, (_, i) => stores[i % 2].update(data => {
    data.folders.push(makeFolder('dev', `/projects/${i}`));
  })));
  assert.equal((await stores[0].read()).folders.length, 12);
  await Promise.all([
    stores[0].update(data => { data.folders[0].name = 'Renamed'; }),
    stores[1].update(data => { data.folders[0].favorite = true; })
  ]);
  const data = await stores[0].read();
  assert.equal(data.folders[0].name, 'Renamed'); assert.equal(data.folders[0].favorite, true);
  const raw = await readFile(stores[0].file, 'utf8');
  assert.ok(!raw.includes('password'));
  await writeFile(stores[0].file, '{corrupt');
  await assert.rejects(() => stores[0].update(() => {}), /无法读取/);
  assert.equal(await readFile(stores[0].file, 'utf8'), '{corrupt');
});

test('deleting a configured server survives rediscovery and preserves folders for restoration', () => {
  const data = emptyCatalog();
  data.folders.push({ ...makeFolder('dev', '/projects/code'), favorite: true });
  hideServer(data, 'dev'); hideServer(data, 'dev');
  assert.deepEqual(visibleServers(data, ['dev', 'prod']).map(item => item.alias), ['prod']);
  assert.deepEqual(data.hiddenServers, ['dev']);
  assert.equal(data.folders[0].favorite, true);
  const persisted = validateCatalog(JSON.parse(JSON.stringify(data)));
  assert.equal(visibleServers(persisted, ['dev']).length, 0);
  restoreServer(persisted, 'dev');
  assert.equal(visibleServers(persisted, ['dev'])[0].configured, true);
  assert.equal(persisted.folders[0].path, '/projects/code');
  const legacy = JSON.parse(JSON.stringify(data)); delete legacy.hiddenServers;
  assert.deepEqual(validateCatalog(legacy).hiddenServers, []);
});

test('adding SSH hosts preserves existing bytes, rejects injection and serializes competing writes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ssh-manager-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'config');
  const original = '# user settings\r\nHost existing\r\n  HostName 192.0.2.1';
  await writeFile(config, original, { mode: 0o600 });
  const host = { alias: 'dev', host: '2001:db8::1', user: 'coder', port: 2222, identityFile: 'C:\\my keys\\id_ed25519' };
  await Promise.all([addSshHost(config, host), addSshHost(config, { ...host, alias: 'build' })]);
  const content = await readFile(config, 'utf8');
  assert.ok(content.startsWith(original + '\r\n\r\n'));
  assert.ok(content.includes('  IdentityFile "C:/my keys/id_ed25519"\r\n'));
  assert.deepEqual(await readHostAliases(config), ['build', 'dev', 'existing']);
  await assert.rejects(() => addSshHost(config, host), /已存在/);
  for (const change of [{ alias: '-oProxyCommand=x' }, { host: 'x\nProxyCommand cmd' }, { identityFile: 'id"\nHost evil' }]) {
    assert.throws(() => hostBlock({ ...host, ...change }));
  }
  assert.equal(await readFile(config, 'utf8'), content);
  if (process.platform !== 'win32') {
    assert.equal((await stat(config)).mode & 0o777, 0o600);
    const link = path.join(directory, 'linked-config'); await symlink(config, link);
    await addSshHost(link, { ...host, alias: 'through-link' });
    assert.ok((await readFile(config, 'utf8')).includes('Host through-link'));
  }
});
