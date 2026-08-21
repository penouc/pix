import type { IpcMethod } from '@pi-desktop/protocol';

/**
 * Whether `handleInvoke` must construct AgentRuntime and apply saved provider
 * keys before dispatching this command.
 *
 * First-paint / DB-only / settings-only methods return false so
 * `project.listRecent` is not stuck behind Pi SDK / ModelRuntime catalog work.
 * Exhaustive: adding an IPC method fails typecheck until it is classified.
 */
export function ipcMethodNeedsRuntime(method: IpcMethod): boolean {
  switch (method) {
    case 'app.getInfo':
    case 'provider.listAvailable':
    case 'provider.login':
    case 'provider.logout':
    case 'provider.saveApiKey':
    case 'provider.remove':
    case 'session.create':
    case 'session.messages':
    case 'agent.sendMessage':
    case 'agent.steer':
    case 'agent.followUp':
    case 'agent.abort':
    case 'agent.setModel':
    case 'agent.resolveApproval':
    case 'agent.listModels':
    case 'agent.authStatus':
    case 'agent.setApprovalMode':
    case 'agent.getApprovalMode':
    case 'agent.setSessionMode':
    case 'agent.getSessionMode':
    case 'agent.setThinkingLevel':
    case 'agent.getThinkingLevel':
    case 'agent.getContextUsage':
    case 'agent.compact':
    case 'agent.forkPoints':
    case 'agent.forkSession':
    case 'agent.setAutoCompaction':
    case 'agent.getAutoCompaction':
    case 'agent.abortCompaction':
    case 'agent.listTodos':
    case 'agent.answerAsk':
    case 'automation.list':
    case 'automation.save':
    case 'automation.delete':
    case 'automation.setEnabled':
    case 'automation.runNow':
    case 'permissions.listRemembered':
    case 'permissions.clearRemembered':
      return true;

    case 'update.getStatus':
    case 'update.check':
    case 'update.download':
    case 'update.install':
    case 'project.open':
    case 'project.pickFolder':
    case 'project.listRecent':
    case 'project.openPlayground':
    case 'project.setTrust':
    case 'git.getWorkingTreeDiff':
    case 'provider.list':
    case 'provider.loginStatus':
    case 'provider.loginSubmit':
    case 'provider.loginCancel':
    case 'settings.get':
    case 'settings.setDefaultModel':
    case 'settings.getAutoModel':
    case 'settings.setAutoModel':
    case 'session.list':
    case 'session.rename':
    case 'session.archive':
    case 'session.delete':
    case 'settings.getFavoriteModels':
    case 'settings.setFavoriteModels':
    case 'checkpoint.listRecoverable':
    case 'checkpoint.review':
    case 'checkpoint.keep':
    case 'checkpoint.continue':
    case 'checkpoint.revertFile':
    case 'checkpoint.revertAll':
    case 'diagnostics.export':
    case 'project.searchFiles':
    case 'git.getBranch':
    case 'index.search':
    case 'index.status':
    case 'index.tree':
    case 'system.openExternal':
    case 'browser.attach':
    case 'browser.detach':
    case 'browser.navigate':
    case 'browser.setBounds':
    case 'browser.setVisible':
    case 'browser.reload':
    case 'browser.goBack':
    case 'browser.goForward':
    case 'browser.getState':
    case 'browser.startPicker':
    case 'browser.cancelPicker':
    case 'index.rebuild':
    case 'index.forget':
    case 'skills.list':
    case 'skills.setEnabled':
    case 'skills.installExample':
    case 'skills.reveal':
    case 'terminal.exec':
    case 'terminal.changeDirectory':
    case 'terminal.open':
    case 'terminal.write':
    case 'terminal.resize':
    case 'terminal.close':
    case 'settings.setUiFlag':
    case 'settings.setDefaultProjectsFolder':
    case 'settings.pickProjectsFolder':
    case 'settings.getOnboarding':
    case 'settings.patchOnboarding':
    case 'audit.summary':
    case 'usage.summary':
    case 'usage.projects':
    case 'memory.list':
    case 'memory.add':
    case 'memory.update':
    case 'memory.delete':
    case 'memory.clear':
    case 'system.revealPath':
    case 'history.nav':
    case 'history.list':
    case 'history.transcript':
    case 'history.refresh':
    case 'history.star':
    case 'history.resume':
    case 'history.listTerminals':
    case 'history.delete':
    case 'history.archiveProject':
    case 'history.archiveSession':
    case 'history.listArchived':
    case 'acp.listAgents':
    case 'acp.start':
    case 'acp.prompt':
    case 'acp.abort':
    case 'acp.resolvePermission':
      return false;
  }
}
