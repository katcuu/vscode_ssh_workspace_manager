const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');

exports.run = async function () {
  const manifest = require('../package.json');
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension, 'Extension not discovered');
  await extension.activate();
  let localHistory = 'not tested';
  if (process.env.SSH_MANAGER_SMOKE_CATALOG) {
    const readCatalog = async () => JSON.parse(await fs.readFile(process.env.SSH_MANAGER_SMOKE_CATALOG, 'utf8'));
    const initial = await readCatalog();
    assert.equal(initial.schemaVersion, 2);
    const roots = vscode.workspace.workspaceFolders || [];
    assert.ok(roots.length >= 2, 'History smoke test requires a multi-root local workspace');
    for (const root of roots) {
      assert.equal(root.uri.scheme, 'file');
      const entries = initial.folders.filter(folder => folder.kind === 'local' && folder.path === root.uri.fsPath);
      assert.equal(entries.length, 1, 'Each actual local workspace root is automatically recorded once');
      assert.equal(entries[0].name, root.name);
      assert.ok(entries[0].lastOpenedAt > 0);
    }
    const remote = initial.folders.find(folder => folder.kind === 'remote');
    assert.equal(remote.favorite, true, 'Legacy remote favorites survive migration');
    await vscode.commands.executeCommand('sshWorkspaceManager.saveCurrentFolders');
    const recorded = await readCatalog();
    assert.equal(recorded.folders.length, initial.folders.length, 'Recording twice must not duplicate projects');
    assert.ok(recorded.folders.filter(folder => folder.kind === 'local').every(folder => folder.lastOpenedAt > 0));
    const unchangedTime = recorded.folders.find(folder => folder.kind === 'local' && folder.path === roots[0].uri.fsPath).lastOpenedAt;
    const changed = new Promise(resolve => {
      const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => { subscription.dispose(); resolve(); });
    });
    assert.equal(vscode.workspace.updateWorkspaceFolders(1, 1), true);
    await changed;
    assert.equal((await readCatalog()).folders.find(folder => folder.kind === 'local' && folder.path === roots[0].uri.fsPath).lastOpenedAt,
      unchangedTime, 'Removing a root must not refresh other projects in history');
    localHistory = 'passed';
  }
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('sshWorkspaceManager.openDashboard'));
  assert.ok(commands.includes('sshWorkspaceManager.launcher.focus'));
  for (const command of ['addServer', 'removeServer', 'refreshServers', 'editConfig', 'selectServer']) {
    assert.ok(commands.includes(`sshWorkspaceManager.${command}`));
  }
  await vscode.commands.executeCommand('workbench.view.explorer');
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.label === 'SSH Workspace Manager');
  for (const tab of tabs()) await vscode.window.tabGroups.close(tab);
  const path = '/home/test/中文 path/#100%';
  const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: 'ssh-remote+dev', path });
  assert.equal(vscode.Uri.parse(uri.toString()).path, path);
  // The activity-bar container must create the editor page without running openDashboard.
  await vscode.commands.executeCommand('workbench.view.extension.sshWorkspaceManager');
  await new Promise((resolve, reject) => {
    const ready = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === 'SSH Workspace Manager');
    if (ready()) { resolve(); return; }
    const timer = setTimeout(() => { subscription.dispose(); reject(new Error('Dashboard tab did not appear')); }, 5000);
    const subscription = vscode.window.tabGroups.onDidChangeTabs(() => {
      if (ready()) { clearTimeout(timer); subscription.dispose(); resolve(); }
    });
  });
  assert.equal(tabs().length, 1);
  await vscode.commands.executeCommand('sshWorkspaceManager.openDashboard');
  await vscode.commands.executeCommand('sshWorkspaceManager.openDashboard');
  assert.equal(tabs().length, 1, 'Repeated opening must reuse the dashboard');
  for (const view of ['local', 'history', 'favorites', 'all']) {
    await vscode.commands.executeCommand('sshWorkspaceManager.selectServer', { view });
    assert.equal(tabs().length, 1, `Selecting ${view} must reuse the dashboard`);
  }
  const result = { vscode: vscode.version, version: extension.packageJSON.version,
    activation: 'passed', activityBarDirectOpen: 'passed', serverCommands: 'passed', singleDashboard: 'passed',
    sidebarViews: 'passed', localHistory, remoteConnection: 'not tested' };
  if (process.env.SSH_MANAGER_SMOKE_RESULT) await fs.writeFile(process.env.SSH_MANAGER_SMOKE_RESULT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
};
