import { readFile, mkdir } from 'node:fs/promises';
import { createVSIX } from '@vscode/vsce';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir('artifacts', { recursive: true });
await createVSIX({ packagePath: `artifacts/${manifest.name}-${manifest.version}.vsix`, dependencies: false });
