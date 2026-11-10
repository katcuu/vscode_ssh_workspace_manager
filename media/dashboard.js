(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const persistedUiState = vscode.getState() || {};
  const persistedPaneRatios = persistedUiState.paneRatios || {};
  const state = { servers: [], folders: [], browsePaths: {}, view: 'all', alias: undefined, path: '', entries: [], selected: undefined, connected: false, busy: false, directoryBusy: false, cloneBusy: false, cloneCanceling: false, cloneScope: undefined, cloneMessage: '', clonePercent: undefined, cloneResult: undefined, localCloneParent: '', paneRatios: {
    server: Number.isFinite(persistedPaneRatios.server) ? persistedPaneRatios.server : 56,
    local: Number.isFinite(persistedPaneRatios.local) ? persistedPaneRatios.local : 62.5
  }, initialized: false };
  const send = (type, args = {}) => vscode.postMessage({ type, ...args });
  const button = (text, action, className = '') => {
    const element = document.createElement('button'); element.textContent = text; element.className = className;
    element.addEventListener('click', action); return element;
  };
  const paragraph = (text, className = '') => { const element = document.createElement('p'); element.className = className; element.textContent = text; return element; };
  const target = () => state.selected || state.path;
  const splitterWidth = 14;

  function paneBounds(view = state.view) {
    const width = $('main').getBoundingClientRect().width - splitterWidth;
    if (width <= 0) return { min: 30, max: 70 };
    const rightMin = view === 'server' ? 400 : 360;
    const min = Math.max(30, Math.ceil(300 / width * 100));
    const max = Math.min(70, Math.floor((width - rightMin) / width * 100));
    return max >= min ? { min, max } : { min: 30, max: 70 };
  }

  function currentPaneRatio() {
    const main = $('main').getBoundingClientRect();
    const saved = $('saved').getBoundingClientRect();
    const width = main.width - splitterWidth;
    const measured = width > 0 && saved.width > 0 ? saved.width / width * 100 : state.paneRatios[state.view];
    const { min, max } = paneBounds();
    return Math.min(max, Math.max(min, measured));
  }

  function updateSplitterValue() {
    if (state.view !== 'server' && state.view !== 'local') return;
    const splitter = $('paneSplitter');
    const { min, max } = paneBounds();
    const percent = Math.round(currentPaneRatio());
    const rightLabel = state.view === 'server' ? '目录浏览' : '本机克隆';
    splitter.setAttribute('aria-valuemin', String(min));
    splitter.setAttribute('aria-valuemax', String(max));
    splitter.setAttribute('aria-valuenow', String(percent));
    splitter.setAttribute('aria-valuetext', `${percent}% 项目列表，${100 - percent}% ${rightLabel}`);
  }

  function applyPaneRatio(value) {
    const ratio = Math.min(70, Math.max(30, value));
    $('main').style.setProperty('--saved-pane-track', `${ratio}fr`);
    $('main').style.setProperty('--right-pane-track', `${100 - ratio}fr`);
    updateSplitterValue();
  }

  function setPaneRatio(value, persist = false) {
    if (state.view !== 'server' && state.view !== 'local') return;
    const { min, max } = paneBounds();
    const ratio = Math.min(max, Math.max(min, value));
    state.paneRatios[state.view] = ratio;
    applyPaneRatio(ratio);
    if (persist) {
      const current = vscode.getState() || {};
      vscode.setState({ ...current, paneRatios: { ...(current.paneRatios || {}), [state.view]: ratio } });
    }
  }

  function showNotice(message, error = false) {
    $('noticeMessage').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false;
  }

  function chooseView(view, alias, initialPath) {
    state.view = view || 'all';
    $('favoritesOnly').checked = false; $('search').value = '';
    state.alias = alias; state.path = ''; state.entries = []; state.selected = undefined; state.connected = false; state.busy = false;
    $('path').value = initialPath || '';
    $('connectionStatus').textContent = alias ? '未连接；点击「连接并浏览」开始' : '从左侧选择具体服务器后可连接并浏览。';
    $('notice').hidden = true;
    renderFolders(); renderBrowser(); renderCloneResult();
  }

  function renderServerLabel() {
    const server = state.servers.find(server => server.alias === state.alias);
    $('main').dataset.view = state.view;
    const titles = { all: '全部服务器项目', local: '本地文件夹', history: '最近打开的项目', favorites: '所有收藏项目' };
    $('serverLabel').textContent = state.view === 'server' ? `${server?.label || state.alias} · ${state.alias}` : titles[state.view] || titles.all;
    $('browseServer').textContent = state.alias || '从左侧选择一台服务器';
    $('folderTitle').textContent = state.view === 'server' ? `${server?.label || state.alias} 的文件夹`
      : state.view === 'local' ? '本地项目文件夹'
        : state.view === 'history' ? '历史记录' : state.view === 'favorites' ? '收藏记录' : '全部服务器项目';
    $('addFolder').hidden = state.view !== 'server' && state.view !== 'local';
    $('addFolder').textContent = state.view === 'local' ? '添加本地文件夹' : '手动添加路径';
    $('browser').hidden = state.view !== 'server';
    $('localClone').hidden = state.view !== 'local';
    $('favoriteFilter').hidden = state.view === 'favorites';
    $('paneSplitter').hidden = state.view !== 'server' && state.view !== 'local';
    $('paneSplitter').setAttribute('aria-label', state.view === 'server'
      ? '调整项目列表和远程目录浏览宽度' : '调整本地项目列表和克隆面板宽度');
    if (state.view === 'server' || state.view === 'local') applyPaneRatio(state.paneRatios[state.view]);
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
      remove.title = state.view === 'favorites' ? '取消收藏，保留历史记录' : '选择仅删除记录，或二次确认后删除实际文件夹';
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
    if (!state.alias || state.busy || state.directoryBusy || state.cloneBusy) return;
    if (!state.connected) { connect(path); return; }
    state.path = ''; state.entries = []; state.selected = undefined; state.busy = true; renderBrowser();
    send('browse', { alias: state.alias, path });
  }

  function connect(path) {
    if (!state.alias || state.busy || state.directoryBusy || state.cloneBusy) return;
    state.busy = true; state.connected = false; state.path = ''; state.entries = []; state.selected = undefined;
    renderBrowser(); send('connect', { alias: state.alias, path });
  }

  function renderCloneControls() {
    const active = state.cloneBusy && state.cloneScope === 'remote';
    $('repositoryUrl').disabled = !state.connected || state.busy || state.directoryBusy || state.cloneBusy;
    $('cloneRepository').disabled = !state.connected || state.busy || state.directoryBusy || state.cloneBusy || !target() || !$('repositoryUrl').value.trim();
    $('cloneDestinationHint').textContent = state.connected && target()
      ? `${state.alias} : ${target()} · 将按仓库名创建子目录`
      : '连接并选择一个父目录后，将按仓库名创建子目录。';
    $('cloneProgress').hidden = !active;
    $('cloneMessage').textContent = state.cloneMessage;
    $('cancelClone').disabled = state.cloneCanceling;
    $('cancelClone').textContent = state.cloneCanceling ? '正在取消…' : '取消';
    $('clonePercent').hidden = !active;
    if (active && Number.isFinite(state.clonePercent)) $('clonePercent').value = state.clonePercent;
    else $('clonePercent').removeAttribute('value');
  }

  function renderLocalCloneControls() {
    const active = state.cloneBusy && state.cloneScope === 'local';
    $('selectLocalCloneParent').disabled = state.cloneBusy || state.directoryBusy;
    $('localRepositoryUrl').disabled = state.cloneBusy || state.directoryBusy;
    $('cloneLocalRepository').disabled = state.cloneBusy || state.directoryBusy || !state.localCloneParent || !$('localRepositoryUrl').value.trim();
    $('localCloneParent').textContent = state.localCloneParent || '尚未选择父文件夹';
    $('localCloneDestinationHint').textContent = state.localCloneParent
      ? `${state.localCloneParent} · 将按仓库名创建子目录` : '选择父文件夹后，将按仓库名在本机创建子目录。';
    $('localCloneProgress').hidden = !active;
    $('localCloneMessage').textContent = state.cloneMessage;
    $('cancelLocalClone').disabled = state.cloneCanceling;
    $('cancelLocalClone').textContent = state.cloneCanceling ? '正在取消…' : '取消';
    $('localClonePercent').hidden = !active;
    if (active && Number.isFinite(state.clonePercent)) $('localClonePercent').value = state.clonePercent;
    else $('localClonePercent').removeAttribute('value');
  }

  function renderCloneResult() {
    const operation = state.cloneBusy && state.cloneScope ? state : undefined;
    const result = state.cloneResult;
    const panel = $('cloneResult');
    panel.hidden = !operation && !result;
    if (panel.hidden) return;
    panel.className = `clone-result ${operation ? 'running' : result.state}`;
    $('cloneResultTitle').textContent = operation
      ? `… ${operation.cloneScope === 'local' ? '正在克隆到本机' : '正在克隆到服务器'}${operation.clonePercent === undefined ? '' : ` · ${operation.clonePercent}%`}`
      : result.state === 'success' ? `✓ ${result.scope === 'local' ? '本机' : '远程'}克隆完成`
        : result.state === 'cancelled' ? '− 克隆已取消' : `! ${result.scope === 'local' ? '本机' : '远程'}克隆失败`;
    $('cloneResultMessage').textContent = operation ? operation.cloneMessage : result.message;
    const resultPath = $('cloneResultPath');
    resultPath.textContent = result?.path || '';
    resultPath.hidden = !result?.path;
    $('cloneResultPercent').hidden = !operation;
    if (operation && Number.isFinite(operation.clonePercent)) $('cloneResultPercent').value = operation.clonePercent;
    else $('cloneResultPercent').removeAttribute('value');
    const canOpen = !operation && result.state === 'success' && !!result.path;
    $('openCloneCurrent').hidden = !canOpen;
    $('openCloneNew').hidden = !canOpen;
    $('cancelCloneGlobal').hidden = !operation;
    $('cancelCloneGlobal').disabled = !!operation?.cloneCanceling;
    $('cancelCloneGlobal').textContent = operation?.cloneCanceling ? '正在取消…' : '取消克隆';
    $('dismissCloneResult').hidden = !!operation;
  }

  function renderDirectoryControls() {
    const unavailable = !state.connected || !state.path || state.busy || state.directoryBusy || state.cloneBusy;
    $('createDirectory').disabled = unavailable;
    $('deleteDirectory').disabled = unavailable || !state.selected;
    $('createDirectory').title = state.path ? `在 ${state.path} 下新建子文件夹` : '请先连接并浏览目录';
    $('deleteDirectory').title = state.selected ? `删除 ${state.selected}，需两次确认` : '请先单击选中一个子文件夹';
  }

  function renderBrowser() {
    renderDirectoryControls();
    $('connect').disabled = !state.alias || state.busy || state.directoryBusy || state.cloneBusy;
    $('connect').textContent = state.connected ? '重新连接' : '连接并浏览';
    $('disconnect').disabled = !state.alias || (!state.connected && !state.busy && !state.cloneBusy);
    $('go').disabled = !state.alias || state.busy || state.directoryBusy || state.cloneBusy;
    $('refresh').disabled = !state.connected || state.busy || state.directoryBusy || state.cloneBusy || !state.path;
    $('path').disabled = !state.alias || state.busy || state.directoryBusy || state.cloneBusy;
    $('showHidden').disabled = !state.connected || state.busy || state.directoryBusy || state.cloneBusy;
    $('up').disabled = !state.connected || state.busy || state.directoryBusy || state.cloneBusy || !state.path || state.path === '/';
    for (const id of ['saveTarget', 'openCurrent', 'openNew']) $(id).disabled = !state.connected || state.busy || state.directoryBusy || state.cloneBusy || !target();
    renderCloneControls();
    renderLocalCloneControls();
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
        renderCloneControls(); renderDirectoryControls();
      }, 'select-directory');
      select.setAttribute('aria-pressed', String(state.selected === entry.path)); select.disabled = state.busy || state.directoryBusy || state.cloneBusy || !state.connected;
      select.addEventListener('dblclick', () => navigate(entry.path));
      const enter = button('进入 →', () => navigate(entry.path), 'enter-directory'); enter.disabled = state.busy || state.directoryBusy || state.cloneBusy || !state.connected;
      row.append(select, enter); $('directories').append(row);
    }
    if (!entries.length) $('directories').append(paragraph(state.connected
      ? !state.path ? '未能读取目录，请输入其他绝对路径后点击「前往」。'
        : state.entries.length ? '仅有隐藏目录；可勾选「隐藏目录」。' : '此目录下没有子文件夹，可以直接打开当前目录。'
      : '连接后在这里浏览服务端文件夹。单击选中，双击进入。', 'empty'));
    $('breadcrumbs').replaceChildren();
    if (state.path) {
      const root = button('/', () => navigate('/')); root.disabled = state.busy || state.directoryBusy || state.cloneBusy || !state.connected; $('breadcrumbs').append(root);
      let path = '';
      for (const part of state.path.split('/').filter(Boolean)) {
        path += `/${part}`;
        const destination = path;
        const crumb = button(part, () => navigate(destination)); crumb.disabled = state.busy || state.directoryBusy || state.cloneBusy || !state.connected;
        const separator = document.createElement('span'); separator.textContent = ' / '; $('breadcrumbs').append(separator, crumb);
      }
    }
    renderCloneResult();
  }

  const paneSplitter = $('paneSplitter');
  let activePointer;
  let activeResizeView;
  function resizePaneAt(clientX) {
    const main = $('main').getBoundingClientRect();
    const divider = paneSplitter.getBoundingClientRect();
    const width = main.width - divider.width;
    if (width <= 0) return;
    setPaneRatio((clientX - main.left - divider.width / 2) / width * 100);
  }
  function finishPaneResize(event) {
    if (activePointer === undefined || event.pointerId !== activePointer) return;
    const view = activeResizeView;
    activePointer = undefined; activeResizeView = undefined;
    paneSplitter.classList.remove('dragging');
    if (view === state.view) setPaneRatio(state.paneRatios[view], true);
  }
  paneSplitter.addEventListener('pointerdown', event => {
    if ((state.view !== 'server' && state.view !== 'local') || (event.button !== undefined && event.button !== 0)) return;
    const divider = paneSplitter.getBoundingClientRect();
    if (!divider.width || !Number.isFinite(event.clientX)) return;
    event.preventDefault(); paneSplitter.focus?.();
    activePointer = event.pointerId; activeResizeView = state.view;
    if (Number.isFinite(activePointer)) paneSplitter.setPointerCapture?.(activePointer);
    paneSplitter.classList.add('dragging'); resizePaneAt(event.clientX);
  });
  paneSplitter.addEventListener('pointermove', event => {
    if (activePointer !== undefined && activePointer === event.pointerId && activeResizeView === state.view)
      resizePaneAt(event.clientX);
  });
  paneSplitter.addEventListener('pointerup', finishPaneResize);
  paneSplitter.addEventListener('pointercancel', finishPaneResize);
  paneSplitter.addEventListener('keydown', event => {
    if (state.view !== 'server' && state.view !== 'local') return;
    const { min, max } = paneBounds();
    const width = Math.max(1, $('main').getBoundingClientRect().width - splitterWidth);
    const step = (event.shiftKey ? 48 : 16) / width * 100;
    const current = currentPaneRatio();
    const next = event.key === 'ArrowLeft' ? current - step
      : event.key === 'ArrowRight' ? current + step
        : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
    if (next === undefined) return;
    event.preventDefault(); setPaneRatio(next, true);
  });
  if (typeof ResizeObserver !== 'undefined') {
    const paneResizeObserver = new ResizeObserver(updateSplitterValue);
    paneResizeObserver.observe($('main'));
  }

  $('dismissNotice').addEventListener('click', () => { $('notice').hidden = true; });
  $('record').addEventListener('click', () => send('recordCurrent'));
  $('addFolder').addEventListener('click', () => send(state.view === 'local' ? 'addLocalFolder' : 'addFolder', { alias: state.alias }));
  $('search').addEventListener('input', renderFolders);
  $('favoritesOnly').addEventListener('change', renderFolders);
  $('showHidden').addEventListener('change', () => { state.selected = undefined; renderBrowser(); });
  $('connect').addEventListener('click', () => connect($('path').value));
  $('disconnect').addEventListener('click', () => { state.busy = false; state.connected = false; state.path = ''; state.cloneBusy = false; state.cloneCanceling = false; state.cloneScope = undefined; state.cloneMessage = ''; state.clonePercent = undefined; state.entries = []; state.selected = undefined; renderBrowser(); send('cancel'); });
  $('go').addEventListener('click', () => navigate($('path').value));
  $('path').addEventListener('keydown', event => { if (event.key === 'Enter') navigate($('path').value); });
  $('up').addEventListener('click', () => navigate(state.path.slice(0, state.path.lastIndexOf('/')) || '/'));
  $('refresh').addEventListener('click', () => navigate(state.path));
  for (const type of ['createDirectory', 'deleteDirectory']) $(type).addEventListener('click', () => {
    if (!state.alias || !state.connected || !state.path || state.busy || state.directoryBusy || state.cloneBusy) return;
    if (type === 'deleteDirectory' && !state.selected) return;
    state.directoryBusy = true;
    $('directoryOperationStatus').textContent = type === 'createDirectory' ? '等待输入文件夹名称…' : '等待确认删除…';
    $('directoryOperationStatus').hidden = false;
    renderBrowser();
    send(type, { alias: state.alias, parentPath: state.path, ...(type === 'deleteDirectory' ? { path: state.selected } : {}) });
  });
  $('saveTarget').addEventListener('click', () => send('saveFolder', { alias: state.alias, path: target() }));
  $('repositoryUrl').addEventListener('input', renderCloneControls);
  $('cloneRepository').addEventListener('click', () => {
    if (!state.alias || !state.connected || !target() || state.directoryBusy || state.busy || state.cloneBusy || !$('repositoryUrl').value.trim()) return;
    const selectedPath = target();
    state.cloneBusy = true; state.cloneCanceling = false; state.cloneScope = 'remote'; state.clonePercent = undefined; state.cloneMessage = '正在准备 Git 克隆…';
    state.cloneResult = undefined;
    renderBrowser(); send('clone', { alias: state.alias, path: selectedPath, url: $('repositoryUrl').value.trim() });
  });
  $('selectLocalCloneParent').addEventListener('click', () => send('selectLocalCloneParent'));
  $('localRepositoryUrl').addEventListener('input', renderLocalCloneControls);
  $('cloneLocalRepository').addEventListener('click', () => {
    if (!state.localCloneParent || !$('localRepositoryUrl').value.trim() || state.cloneBusy || state.directoryBusy) return;
    state.cloneBusy = true; state.cloneCanceling = false; state.cloneScope = 'local'; state.clonePercent = undefined; state.cloneMessage = '正在准备本机 Git 克隆…';
    state.cloneResult = undefined;
    renderLocalCloneControls();
    renderCloneResult();
    send('cloneLocal', { parentPath: state.localCloneParent, url: $('localRepositoryUrl').value.trim() });
  });
  $('cancelLocalClone').addEventListener('click', () => {
    if (!state.cloneBusy || state.cloneScope !== 'local' || state.cloneCanceling) return;
    state.cloneCanceling = true; state.cloneMessage = '正在取消克隆…'; renderLocalCloneControls(); renderCloneResult(); send('cancelClone');
  });
  $('cancelClone').addEventListener('click', () => {
    if (!state.cloneBusy || state.cloneCanceling) return;
    state.cloneCanceling = true; state.cloneMessage = '正在取消克隆…'; renderCloneControls(); renderCloneResult(); send('cancelClone');
  });
  $('cancelCloneGlobal').addEventListener('click', () => {
    if (!state.cloneBusy || state.cloneCanceling) return;
    state.cloneCanceling = true; state.cloneMessage = '正在取消克隆…'; renderBrowser(); send('cancelClone');
  });
  $('dismissCloneResult').addEventListener('click', () => { state.cloneResult = undefined; renderCloneResult(); send('dismissCloneResult'); });
  $('openCloneCurrent').addEventListener('click', () => send('openCloneResult', { mode: 'current' }));
  $('openCloneNew').addEventListener('click', () => send('openCloneResult', { mode: 'new' }));
  for (const [id, mode] of [['openCurrent', 'current'], ['openNew', 'new']]) $(id).addEventListener('click', () => send('open', { alias: state.alias, path: target(), mode, fromBrowser: true }));

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'snapshot':
        state.servers = message.servers; state.folders = message.folders; state.browsePaths = message.browsePaths;
        if (Object.hasOwn(message, 'directoryBusy')) state.directoryBusy = message.directoryBusy === true;
        state.localCloneParent = message.localCloneParent || state.localCloneParent;
        if (Object.hasOwn(message, 'cloneResult')) state.cloneResult = message.cloneResult || undefined;
        if (!state.initialized || state.alias !== message.selectedAlias || state.view !== message.selectedView)
          chooseView(message.selectedView, message.selectedAlias, message.initialPath);
        if (Object.hasOwn(message, 'cloneOperation')) {
          const operation = message.cloneOperation;
          state.cloneBusy = !!operation;
          state.cloneScope = operation?.scope;
          state.cloneCanceling = operation?.canceling === true;
          state.cloneMessage = operation?.message || '';
          state.clonePercent = Number.isFinite(operation?.percent) ? operation.percent : undefined;
        }
        state.initialized = true;
        renderServerLabel(); renderFolders(); renderBrowser(); renderCloneResult();
        break;
      case 'browseReset':
        if (message.alias !== state.alias) return;
        state.path = ''; state.entries = []; state.selected = undefined; state.connected = false; state.busy = false;
        $('path').value = message.path; renderBrowser(); break;
      case 'browseResult':
        if (message.alias !== state.alias) return;
        state.path = message.path; state.entries = message.entries; state.selected = message.entries.some(entry => entry.path === message.selectedPath) ? message.selectedPath : undefined; state.connected = true; state.busy = false;
        if (state.selected && state.entries.some(entry => entry.path === state.selected && entry.name.startsWith('.'))) $('showHidden').checked = true;
        $('path').value = message.path; $('connectionStatus').textContent = `${message.backend} · ${message.entries.length} 个子文件夹`;
        $('notice').hidden = true; renderBrowser(); break;
      case 'directoryOperation':
        state.directoryBusy = message.busy === true;
        $('directoryOperationStatus').textContent = message.message || '';
        $('directoryOperationStatus').hidden = !state.directoryBusy;
        renderBrowser(); break;
      case 'status':
        state.busy = message.busy; state.connected = message.connected; state.selected = undefined;
        $('connectionStatus').textContent = message.message; renderBrowser(); break;
      case 'cloneProgress':
        if (message.scope && state.cloneScope && message.scope !== state.cloneScope) return;
        state.cloneScope = message.scope || state.cloneScope || 'remote';
        state.cloneBusy = true; state.cloneCanceling = state.cloneCanceling || message.canceling === true; state.cloneMessage = message.message;
        state.clonePercent = Number.isFinite(message.percent) ? message.percent : undefined; renderBrowser(); renderLocalCloneControls(); renderCloneResult(); break;
      case 'cloneComplete':
        if (message.scope && state.cloneScope && message.scope !== state.cloneScope) return;
        state.cloneBusy = false; state.cloneCanceling = false; state.cloneScope = undefined; state.clonePercent = undefined; state.cloneMessage = '';
        state.cloneResult = message.result || { scope: message.scope || 'remote', state: 'success', message: message.message };
        renderBrowser(); renderLocalCloneControls(); renderCloneResult(); break;
      case 'cloneFailed':
        if (message.scope && state.cloneScope && message.scope !== state.cloneScope) return;
        state.cloneBusy = false; state.cloneCanceling = false; state.cloneScope = undefined; state.clonePercent = undefined; state.cloneMessage = '';
        state.cloneResult = message.result || { scope: message.scope || 'remote', state: 'failed', message: message.message };
        renderBrowser(); renderLocalCloneControls(); renderCloneResult(); break;
      case 'cloneResult':
        state.cloneResult = message.result || undefined; renderCloneResult(); break;
      case 'cloneOperation':
        if (!message.operation) {
          state.cloneBusy = false; state.cloneCanceling = false; state.cloneScope = undefined; state.clonePercent = undefined; state.cloneMessage = '';
          renderBrowser(); renderCloneResult();
        }
        break;
      case 'localCloneParent':
        state.localCloneParent = message.path; renderLocalCloneControls(); break;
      case 'error': showNotice(message.message, true); break;
      case 'notice': showNotice(message.message); break;
    }
  });
  renderBrowser(); send('ready');
}());
