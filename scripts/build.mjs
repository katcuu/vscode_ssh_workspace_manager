import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['vscode', 'cpu-features', '*.node'], sourcemap: true,
  logLevel: 'info'
});
const names = ['ssh2', 'proper-lockfile', 'retry', 'signal-exit', 'graceful-fs', 'asn1', 'bcrypt-pbkdf', 'tweetnacl', 'safer-buffer'];
const notices = [];
for (const name of names) {
  const p = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  let license = '';
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE-MIT', 'COPYING']) {
    try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch {}
  }
  notices.push(`${name}@${p.version} (${p.license || 'see source'})\n${license}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n---\n\n'));
await mkdir('artifacts', { recursive: true });
