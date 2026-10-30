import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// A small DOM double runs the shipped controller without browser dependencies.
// Layout and native VS Code integration are checked separately in the extension host.
class Element {
  textContent = '';
  value = '';
  hidden = false;
  checked = false;
  disabled = false;
  className = '';
  title = '';
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event?: unknown) => void>();
  append(...children: Element[]): void { this.children.push(...children); }
  replaceChildren(...children: Element[]): void { this.children = children; }
  addEventListener(name: string, callback: (event?: unknown) => void): void { this.listeners.set(name, callback); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  emit(name: string): void { this.listeners.get(name)?.(); }
  text(): string { return this.textContent + this.children.map(child => child.text()).join(' '); }
}

function dashboard() {
  const html = readFileSync('media/dashboard.html', 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const sent: Record<string, unknown>[] = [];
  let receive: (event: { data: unknown }) => void;
  runInNewContext(readFileSync('media/dashboard.js', 'utf8'), {
    acquireVsCodeApi: () => ({ postMessage: (value: unknown) => sent.push(JSON.parse(JSON.stringify(value))) }),
    document: { getElementById: (id: string) => {
      assert.ok(elements.has(id), `Missing HTML element: ${id}`);
      return elements.get(id);
    }, createElement: () => new Element() },
    window: { addEventListener: (_name: string, listener: typeof receive) => { receive = listener; } }
  });
  const element = (id: string) => elements.get(id)!;
  const folders = [
    { id: 'local', kind: 'local', name: '本地 <project>', path: '/Users/test/中文 code#%', favorite: true, lastOpenedAt: 100 },
    { id: 'remote', kind: 'remote', alias: 'dev', name: '远程项目', path: '/home/code', favorite: false, lastOpenedAt: 300 },
    { id: 'saved', kind: 'remote', alias: 'dev', name: '尚未打开', path: '/home/new', favorite: true, lastOpenedAt: null },
    { id: 'hidden', kind: 'remote', alias: 'old-server', name: '旧服务器项目', path: '/work/old', favorite: false, lastOpenedAt: 200 }
  ];
  const show = (view: string, alias?: string) => receive({ data: { type: 'snapshot', selectedView: view, selectedAlias: alias,
    folders, servers: [{ alias: 'dev', label: '开发服务器', configured: true }], browsePaths: {} } });
  const rows = () => element('folders').children.filter(child => child.className === 'folder');
  const action = (row: Element, name: string) => row.children[1].children.find(child => child.textContent === name)!;
  return { element, show, rows, action, sent };
}

test('dashboard separates local, server, global history and favorites and searches their sources', () => {
  const ui = dashboard();
  ui.show('local');
  assert.equal(ui.rows().length, 1);
  assert.match(ui.rows()[0].text(), /本地 <project>.*本地文件/);
  assert.equal(ui.element('browser').hidden, true);
  ui.element('addFolder').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'addLocalFolder' });

  ui.show('history');
  assert.deepEqual(ui.rows().map(row => row.children[0].children[0].textContent), ['远程项目', '旧服务器项目', '本地 <project>']);
  ui.element('search').value = '开发服务器'; ui.element('search').emit('input');
  assert.equal(ui.rows().length, 1);
  ui.element('search').value = '本地'; ui.element('search').emit('input');
  assert.equal(ui.rows().length, 1);
  ui.element('search').value = 'old-server'; ui.element('search').emit('input');
  assert.equal(ui.rows().length, 1);

  ui.show('favorites');
  assert.equal(ui.rows().length, 2);
  assert.equal(ui.element('search').value, '', 'A new sidebar view clears the previous search');
  assert.equal(ui.element('favoriteFilter').hidden, true);
  ui.show('server', 'dev');
  assert.equal(ui.rows().length, 2);
  assert.equal(ui.element('browser').hidden, false);
  ui.show('all');
  assert.equal(ui.rows().length, 2, 'Hidden servers stay out of the server overview');
});

test('dashboard uses record IDs for both open modes and distinguishes deletion from removing a favorite', () => {
  const ui = dashboard();
  ui.show('local');
  ui.action(ui.rows()[0], '当前窗口').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'open', id: 'local', mode: 'current' });
  ui.action(ui.rows()[0], '新窗口').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'open', id: 'local', mode: 'new' });
  ui.show('history');
  ui.action(ui.rows()[0], '删除记录').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'remove', id: 'remote' });
  ui.show('favorites');
  ui.action(ui.rows()[0], '取消收藏').emit('click');
  assert.deepEqual(ui.sent.at(-1), { type: 'unfavorite', id: 'local' });
  assert.equal(ui.rows()[0].children[0].children[0].textContent, '本地 <project>');
});
