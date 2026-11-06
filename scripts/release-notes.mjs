import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const tag = process.argv[2] || `v${version}`;
if (tag !== `v${version}`) throw new Error(`Expected tag v${version}, got ${tag}`);

const lines = (await readFile(new URL('CHANGELOG.md', root), 'utf8')).split(/\r?\n/);
const heading = lines.findIndex(line => line.startsWith(`## ${version} `));
if (heading < 0 || /未发布/.test(lines[heading])) {
  throw new Error(`CHANGELOG must contain published notes for ${version}`);
}
let end = lines.findIndex((line, index) => index > heading && /^## /.test(line));
if (end < 0) end = lines.length;
const notes = lines.slice(heading + 1, end).join('\n').trim();
if (!notes) throw new Error(`Release notes for ${version} are empty`);
process.stdout.write(`${notes}\n`);
