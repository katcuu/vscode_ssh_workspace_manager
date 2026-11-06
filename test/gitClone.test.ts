import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitCloneCommand, gitCloneDestination, parseGitProgress, parseGitPrompt, parseGitRepositoryUrl } from '../src/gitClone';

test('Git repository URLs produce safe remote destination names and shell arguments', () => {
  const ssh = parseGitRepositoryUrl('git@github.com:team/repo.git');
  assert.deepEqual(ssh, { url: 'git@github.com:team/repo.git', host: 'github.com', name: 'repo', protocol: 'ssh' });
  const https = parseGitRepositoryUrl('https://git.example.test/team/My%20Repo.git');
  assert.equal(https.name, 'My Repo');
  assert.equal(gitCloneDestination('/srv/work spaces', https), '/srv/work spaces/My Repo');

  const command = gitCloneCommand("https://example.test/team/a'b.git", "/srv/work/a'b");
  assert.match(command, /^stty -echo 2>\/dev\/null \|\| :; LC_ALL=C GIT_TERMINAL_PROMPT=1 GIT_ASKPASS= git -c credential\.helper= clone --progress --/);
  assert.match(command, /'https:\/\/example\.test\/team\/a'\\''b\.git'/);
  assert.match(command, /'\/srv\/work\/a'\\''b'/);
  assert.doesNotMatch(command, /token|password/i);
});

test('Git repository URLs reject embedded credentials, insecure transports and unsafe names', () => {
  for (const url of [
    'https://user:secret@example.test/team/repo.git',
    'http://example.test/team/repo.git',
    'file://example.test/team/repo.git',
    'https://example.test/team/repo.git?token=secret',
    'https://example.test/team/.git',
    'git@host:group/../outside.git',
    'git@host:repo\n.git'
  ]) assert.throws(() => parseGitRepositoryUrl(url), url);
});

test('Git prompts distinguish HTTPS credentials, SSH passphrases and unknown host trust', () => {
  assert.deepEqual(parseGitPrompt("Username for 'https://github.com': ", 'https'),
    { type: 'username', target: 'https://github.com' });
  assert.deepEqual(parseGitPrompt("Password for 'https://dev@github.com': ", 'https'),
    { type: 'password', target: 'https://dev@github.com' });
  assert.deepEqual(parseGitPrompt("git@git.example.test's password: ", 'ssh'),
    { type: 'ssh-password', username: 'git', target: 'git.example.test' });
  assert.equal(parseGitPrompt("git@git.example.test's password: ", 'https'), undefined);
  assert.equal(parseGitPrompt("Username for 'https://github.com': ", 'ssh'), undefined);
  assert.deepEqual(parseGitPrompt("Enter passphrase for key '/home/dev/.ssh/id_ed25519': ", 'ssh'),
    { type: 'passphrase', keyPath: '/home/dev/.ssh/id_ed25519' });
  assert.deepEqual(parseGitPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ', 'ssh'),
    { type: 'unknown-host' });
});

test('Git progress parses object counts and percentages', () => {
  assert.deepEqual(parseGitProgress('Receiving objects:  72% (18/25), 1.30 MiB | 2.0 MiB/s'), {
    phase: 'receiving', message: '接收对象 72%（18/25）', percent: 72, current: 18, total: 25
  });
  assert.equal(parseGitProgress('remote: Enumerating objects: 25, done.'), undefined);
});
