(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const state = { servers: [], folders: [], browsePaths: {}, view: 'all', alias: undefined, path: '', entries: [], selected: undefined, connected: false, busy: false, initialized: false };
  const send = (type, args = {}) => vscode.postMessage({ type, ...args });
  const button = (text, action, className = '') => {
    const element = document.createElement('button'); element.textContent = text; element.className = className;
    element.addEventListener('click', action); return element;
  };
  const paragraph = (text, className = '') => { const element = document.createElement('p'); element.className = className; element.textContent = text; return element; };
  const target = () => state.selected || state.path;

  function showNotice(message, error = false) {
    $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false;
  }

  function chooseView(view, alias, initialPath) {
    state.view = view || 'all';
    $('favoritesOnly').checked = false; $('search').value = '';
    state.alias = alias; state.path = ''; state.entries = []; state.selected = undefined; state.connected = false; state.busy = false;
    $('path').value = initialPath || '';
    $('connectionStatus').textContent = alias ? '未连接；点击「连接并浏览」开始' : '从左侧选择具体服务器后可连接并浏览。';
    $('notice').hidden = true;
    renderFolders(); renderBrowser();
  }

  function renderServerLabel() {
    const server = state.servers.find(server => server.alias === state.alias);
    const titles = { all: '全部服务器项目', local: '本地文件夹', history: '最近打开的项目', favorites: '所有收藏项目' };
    $('serverLabel').textContent = state.view === 'server' ? `${server?.label || state.alias} · ${state.alias}` : titles[state.view] || titles.all;
    $('browseServer').textContent = state.alias || '从左侧选择一台服务器';
    $('folderTitle').textContent = state.view === 'server' ? `${server?.label || state.alias} 的文件夹`
      : state.view === 'local' ? '本地项目文件夹'
        : state.view === 'history' ? '历史记录' : state.view === 'favorites' ? '收藏记录' : '全部服务器项目';
    $('addFolder').hidden = state.view !== 'server' && state.view !== 'local';
    $('addFolder').textContent = state.view === 'local' ? '添加本地文件夹' : '手动添加路径';
    $('browser').hidden = state.view !== 'server';
    $('favoriteFilter').hidden = state.view === 'favorites';
  }

  function renderFolders() {
    const query = $('search').value.toLocaleLowerCase().trim();
    const serverLabels = new Map(state.servers.map(server => [server.alias, server.label]));
    const folders = state.folders.filter(folder => {
      if (state.view === 'server' && (folder.kind !== 'remote' || folder.alias !== state.alias)) return false;
      if (state.view === 'all' && (folder.kind !== 'remote' || !serverLabels.has(folder.alias))) return false;
      if (state.view === 'local' && folder.kind !== 'local') return false;
      if (state.view === 'history' && !folder.lastOpenedAt) return false;
      if (state.view === 'favorites' && !folder.favorite) return false;
      return (!$('favoritesOnly').checked || folder.favorite)
        && `${folder.name} ${folder.path} ${folder.kind === 'remote' ? `${folder.alias} ${serverLabels.get(folder.alias) || ''}` : '本地文件'}`.toLocaleLowerCase().includes(query);
    }).sort((a, b) => (state.view === 'history' ? 0 : Number(b.favorite) - Number(a.favorite))
      || (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || a.name.localeCompare(b.name));
    $('folderCount').textContent = `${folders.length} 个文件夹`;
    $('folders').replaceChildren();
    for (const folder of folders) {
      const row = document.createElement('div'); row.className = 'folder';
      const details = document.createElement('div');
      const title = document.createElement('span'); title.className = 'folder-name'; title.textContent = folder.name;
      const label = serverLabels.get(folder.alias);
      const source = folder.kind === 'local' ? '本地文件'
        : `SSH · ${label && label !== folder.alias ? `${label} (${folder.alias})` : folder.alias}`;
      const date = document.createElement('span'); date.className = 'muted';
      date.textContent = `${source} · ${folder.lastOpenedAt ? new Date(folder.lastOpenedAt).toLocaleString() : '尚未打开'}`;
      const code = document.createElement('code'); code.className = 'folder-path'; code.textContent = folder.path;
      details.append(title, date, code);
      const actions = document.createElement('div'); actions.className = 'actions';
      if (state.view !== 'favorites') {
        const favorite = button(folder.favorite ? '★' : '☆', () => send('favorite', { id: folder.id }));
        favorite.title = folder.favorite ? '取消收藏，保留历史记录' : '收藏此文件夹';
        favorite.setAttribute('aria-pressed', String(folder.favorite));
        favorite.setAttribute('aria-label', favorite.title); actions.append(favorite);
      }
      const remove = button(state.view === 'favorites' ? '取消收藏' : '删除记录',
        () => send(state.view === 'favorites' ? 'unfavorite' : 'remove', { id: folder.id }));
      remove.title = state.view === 'favorites' ? '取消收藏，保留历史记录' : '删除此项目的收藏和历史记录，实际文件保留';
      remove.setAttribute('aria-label', `${state.view === 'favorites' ? '取消收藏' : '删除记录'}：${folder.name}`);
      actions.append(
        button('重命名', () => send('rename', { id: folder.id })),
        button('当前窗口', () => send('open', { id: folder.id, mode: 'current' })),
        button('新窗口', () => send('open', { id: folder.id, mode: 'new' })),
        remove);
      row.append(details, actions); $('folders').append(row);
    }
    if (!folders.length) $('folders').append(paragraph(query ? '没有匹配的文件夹。'
      : state.view === 'history' ? '还没有打开过的文件夹。'
        : state.view === 'favorites' ? '还没有收藏的文件夹。'
          : state.view === 'local' ? '暂无本地记录。打开本地项目后会自动记录，也可以手动添加。'
            : '暂无记录。打开服务器项目后会自动记录，也可以浏览远程目录。', 'empty'));
  }

  function navigate(path) {
    if (state.busy || !state.connected) return;
    state.selected = undefined; state.busy = true; renderBrowser();
    send('browse', { alias: state.alias, path });
  }

  function renderBrowser() {
    $('connect').disabled = !state.alias || state.busy;
    $('connect').textContent = state.connected ? '重新连接' : '连接并浏览';
    $('disconnect').disabled = !state.alias || (!state.connected && !state.busy);
    for (const id of ['go', 'refresh']) $(id).disabled = !state.connected || state.busy;
    $('up').disabled = !state.connected || state.busy || !state.path || state.path === '/';
    for (const id of ['saveTarget', 'openCurrent', 'openNew']) $(id).disabled = !state.connected || state.busy || !target();
    $('target').textContent = state.alias && target() ? `${state.alias} : ${target()}` : '—';
    $('directories').replaceChildren();
    const entries = state.entries.filter(entry => $('showHidden').checked || !entry.name.startsWith('.'));
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = `directory${state.selected === entry.path ? ' selected' : ''}`;
      const select = button(`▱  ${entry.name}${entry.symlink ? ' ↗' : ''}`, () => {
        state.selected = entry.path;
        for (const element of $('directories').children) {
          element.classList.remove('selected');
          element.querySelector('.select-directory')?.setAttribute('aria-pressed', 'false');
        }
        row.classList.add('selected'); select.setAttribute('aria-pressed', 'true');
        $('target').textContent = `${state.alias} : ${entry.path}`;
      }, 'select-directory');
      select.setAttribute('aria-pressed', String(state.selected === entry.path)); select.disabled = state.busy || !state.connected;
      select.addEventListener('dblclick', () => navigate(entry.path));
      const enter = button('进入 →', () => navigate(entry.path), 'enter-directory'); enter.disabled = state.busy || !state.connected;
      row.append(select, enter); $('directories').append(row);
    }
    if (!entries.length) $('directories').append(paragraph(state.connected ? (state.entries.length ? '仅有隐藏目录；可勾选「隐藏目录」。' : '此目录下没有子文件夹，可以直接打开当前目录。') : '连接后在这里浏览服务端文件夹。单击选中，双击进入。', 'empty'));
    $('breadcrumbs').replaceChildren();
    if (state.path) {
      const root = button('/', () => navigate('/')); root.disabled = state.busy || !state.connected; $('breadcrumbs').append(root);
      let path = '';
      for (const part of state.path.split('/').filter(Boolean)) {
        path += `/${part}`;
        const destination = path;
        const crumb = button(part, () => navigate(destination)); crumb.disabled = state.busy || !state.connected;
        const separator = document.createElement('span'); separator.textContent = ' / '; $('breadcrumbs').append(separator, crumb);
      }
    }
  }

  $('record').addEventListener('click', () => send('recordCurrent'));
  $('addFolder').addEventListener('click', () => send(state.view === 'local' ? 'addLocalFolder' : 'addFolder', { alias: state.alias }));
  $('search').addEventListener('input', renderFolders);
  $('favoritesOnly').addEventListener('change', renderFolders);
  $('showHidden').addEventListener('change', () => { state.selected = undefined; renderBrowser(); });
  $('connect').addEventListener('click', () => { state.busy = true; state.connected = false; state.entries = []; state.selected = undefined; renderBrowser(); send('connect', { alias: state.alias }); });
  $('disconnect').addEventListener('click', () => { state.busy = false; state.connected = false; state.entries = []; state.selected = undefined; renderBrowser(); send('cancel'); });
  $('go').addEventListener('click', () => navigate($('path').value));
  $('path').addEventListener('keydown', event => { if (event.key === 'Enter') navigate($('path').value); });
  $('up').addEventListener('click', () => navigate(state.path.slice(0, state.path.lastIndexOf('/')) || '/'));
  $('refresh').addEventListener('click', () => navigate(state.path));
  $('saveTarget').addEventListener('click', () => send('saveFolder', { alias: state.alias, path: target() }));
  for (const [id, mode] of [['openCurrent', 'current'], ['openNew', 'new']]) $(id).addEventListener('click', () => send('open', { alias: state.alias, path: target(), mode, fromBrowser: true }));

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'snapshot':
        state.servers = message.servers; state.folders = message.folders; state.browsePaths = message.browsePaths;
        if (!state.initialized || state.alias !== message.selectedAlias || state.view !== message.selectedView)
          chooseView(message.selectedView, message.selectedAlias, message.initialPath);
        state.initialized = true;
        renderServerLabel(); renderFolders(); renderBrowser();
        break;
      case 'browseReset':
        if (message.alias !== state.alias) return;
        state.path = ''; state.entries = []; state.selected = undefined; state.connected = false; state.busy = false;
        $('path').value = message.path; renderBrowser(); break;
      case 'browseResult':
        if (message.alias !== state.alias) return;
        state.path = message.path; state.entries = message.entries; state.selected = undefined; state.connected = true; state.busy = false;
        $('path').value = message.path; $('connectionStatus').textContent = `${message.backend} · ${message.entries.length} 个子文件夹`;
        $('notice').hidden = true; renderBrowser(); break;
      case 'status':
        state.busy = message.busy; state.connected = message.connected; state.selected = undefined;
        $('connectionStatus').textContent = message.message; renderBrowser(); break;
      case 'error': showNotice(message.message, true); break;
      case 'notice': showNotice(message.message); break;
    }
  });
  renderBrowser(); send('ready');
}());
