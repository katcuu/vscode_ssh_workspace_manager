import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as lockfile from 'proper-lockfile';
import { CatalogData, emptyCatalog, validateCatalog } from './model';

export class CatalogStore {
  readonly file: string;

  constructor(directory: string) {
    this.file = path.join(directory, 'catalog.json');
  }

  async read(): Promise<CatalogData> {
    let content: string;
    try { content = await readFile(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCatalog();
      throw error;
    }
    try { return validateCatalog(JSON.parse(content)); }
    catch { throw new Error(`目录记录无法读取，已保留原文件：${this.file}`); }
  }

  async update(change: (data: CatalogData) => void): Promise<CatalogData> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const release = await lockfile.lock(this.file, {
      realpath: false, stale: 10000, update: 2000,
      retries: { retries: 15, factor: 1.3, minTimeout: 40, maxTimeout: 500 }
    });
    const tempFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const data = await this.read();
      change(data);
      data.revision += 1;
      validateCatalog(data);
      await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(tempFile, this.file);
      return data;
    } finally {
      await unlink(tempFile).catch(() => {});
      await release();
    }
  }
}
