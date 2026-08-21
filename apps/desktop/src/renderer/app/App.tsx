import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ApprovalDecision,
  HistorySessionMeta,
  IndexHit,
  InputImage,
  ProjectSummary,
  SessionSummary,
  StoredMessage,
  SkillInfo,
  TodoItem,
} from '@pi-desktop/protocol';

import { AppShell } from '@/components/layout/AppShell';
import { ApprovalDialog } from '@/features/approvals/ApprovalDialog';
import { AskDialog } from '@/features/ask/AskDialog';
import { AutomationsView } from '@/features/automations/AutomationsView';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { DiffPanel } from '@/features/diff/DiffPanel';
import { HistoryBrowser, type HistoryBootLive, type HistoryScope } from '@/features/history/HistoryBrowser';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { PreflightBanner } from '@/features/preflight/PreflightBanner';
import { SearchPalette, type PaletteCommand } from '@/features/search/SearchPalette';
import { SettingsView, type SettingsTabId } from '@/features/settings/SettingsView';
import { SkillsView } from '@/features/skills/SkillsView';
import { TerminalView } from '@/features/terminal/TerminalView';
import { RightDock } from '@/features/workbench/RightDock';
import { invoke, IpcError } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * Design v3 removed the task list. The run screen is the landing surface: it
 * shows an unstarted task (`blankRun`) until something is running, and the
 * sidebar's Tasks list is the switcher.
 */
type View = 'run' | 'diff' | 'settings' | 'terminal' | 'automations' | 'skills' | 'history';

export function App() {
  const [view, setView] = useState<View>('run');
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('providers');
  const [blankRun, setBlankRun] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [diffFocusPath, setDiffFocusPath] = useState<string | undefined>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [dismissedApproval, setDismissedApproval] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyScope, setHistoryScope] = useState<HistoryScope>({ kind: 'none' });
  const [historySessionKey, setHistorySessionKey] = useState<string | null>(null);
  const [historyBootLive, setHistoryBootLive] = useState<HistoryBootLive | null>(null);
  const [composerInsert, setComposerInsert] = useState<{
    text?: string;
    images?: InputImage[];
    token: number;
  } | null>(null);
  /** Session to restore when leaving an unstarted new task — back is not "new task again". */
  const [priorSession, setPriorSession] = useState<SessionSummary | null>(null);

  const queryClient = useQueryClient();
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);
  const approval = useAgentStreamStore((s) => s.approval);
  const pendingAsk = useAgentStreamStore((s) => s.pendingAsk);
  const activeSessionId = useAgentStreamStore((s) => s.activeSessionId);
  const setTodos = useAgentStreamStore((s) => s.setTodos);
  const applyEvent = useAgentStreamStore((s) => s.applyEvent);
  const loadHistory = useAgentStreamStore((s) => s.loadHistory);

  /**
   * Subscribed at the shell, not in the thread: a run keeps streaming while the
   * user is on the task list or in settings, and an approval that arrives then
   * still has to reach the store (and the modal below).
   */
  useEffect(() => {
    if (!window.piDesktop) return;
    return window.piDesktop.onAgentEvent((event) => {
      // session.updated is metadata, not a run stream event — keep it out of the
      // sequence/run-scoped store and refresh the surfaces that show the title.
      if (event.type === 'session.updated') {
        void queryClient.invalidateQueries({ queryKey: ['session.list', event.projectId] });
        const current = useWorkspaceStore.getState().session;
        if (current?.id === event.sessionId && current.title !== event.title) {
          useWorkspaceStore.getState().setSession({
            ...current,
            title: event.title,
            updatedAt: event.timestamp,
          });
        }
        return;
      }
      if (event.type === 'update.status') {
        queryClient.setQueryData(['update.status'], {
          status: event.status,
          currentVersion: event.currentVersion,
          ...(event.version != null ? { version: event.version } : {}),
          ...(event.progress != null ? { progress: event.progress } : {}),
          ...(event.releaseDate != null ? { releaseDate: event.releaseDate } : {}),
          ...(event.releaseNotes != null ? { releaseNotes: event.releaseNotes } : {}),
          ...(event.error != null ? { error: event.error } : {}),
        });
        return;
      }
      if (event.type === 'history.updated') {
        void queryClient.invalidateQueries({ queryKey: ['history.nav'] });
        void queryClient.invalidateQueries({ queryKey: ['history.list'] });
        return;
      }
      // Interactive Terminal PTY stream — TerminalView subscribes separately.
      if (event.type === 'terminal.data' || event.type === 'terminal.exit') {
        return;
      }
      applyEvent(event);
      // Terminal run events also refresh the task list (status badges, order).
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['session.list', event.projectId] });
      }
    });
  }, [applyEvent, queryClient]);

  const newTask = useCallback(
    (previous?: SessionSummary | null) => {
      const workspace = useWorkspaceStore.getState();
      const current = previous === undefined ? workspace.session : previous;
      if (current) setPriorSession(current);
      // #12: leaving a task with a pending ask would otherwise leave the run
      // blocked forever with no dialog — cancel it by answering.
      const orphan = useAgentStreamStore.getState().pendingAsk;
      if (orphan) {
        void invoke({
          method: 'agent.answerAsk',
          params: {
            askId: orphan.askId,
            answer: '(cancelled — left this task)',
          },
        }).catch(console.error);
        useAgentStreamStore.setState({ pendingAsk: null });
      }
      setSession(null);
      resetSessionView();
      if (workspace.project) setScope(workspace.project.id, null);
      setBlankRun(true);
      setView('run');
    },
    [resetSessionView, setScope, setSession],
  );

  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);

  const ensureProjectForSession = useCallback(
    async (projectId: string, hint?: ProjectSummary): Promise<ProjectSummary | null> => {
      const current = useWorkspaceStore.getState().project;
      if (current?.id === projectId) return current;

      let target = hint?.id === projectId ? hint : undefined;
      if (!target) {
        const cached = queryClient.getQueryData<ProjectSummary[]>(['project.listRecent']);
        target = cached?.find((item) => item.id === projectId);
      }
      if (!target) {
        const recent = await invoke<ProjectSummary[]>({ method: 'project.listRecent' });
        target = recent.find((item) => item.id === projectId);
      }
      if (!target) return null;

      const opened = await invoke<ProjectSummary>({
        method: 'project.open',
        params: { path: target.path },
      });
      setActiveProject(opened);
      return opened;
    },
    [queryClient, setActiveProject],
  );

  const selectSession = useCallback(
    (session: SessionSummary, projectHint?: ProjectSummary) => {
      setPriorSession(null);
      void (async () => {
        // #12: switching away from a session that owns a pending ask would
        // orphan the blocked tool call — cancel it before changing scope.
        const orphan = useAgentStreamStore.getState().pendingAsk;
        if (orphan && orphan.sessionId !== session.id) {
          try {
            await invoke({
              method: 'agent.answerAsk',
              params: {
                askId: orphan.askId,
                answer: '(cancelled — switched to another task)',
              },
            });
          } catch (error) {
            console.error('[app] cancelling orphaned ask failed', error);
          }
          useAgentStreamStore.setState({ pendingAsk: null });
        }

        const project = await ensureProjectForSession(session.projectId, projectHint);
        if (!project) {
          console.error('[app] could not resolve project for session', session.id);
          return;
        }

        setSession(session);
        resetSessionView();
        setScope(session.projectId, session.id);
        setBlankRun(false);
        setView('run');
        try {
          const history = await invoke<StoredMessage[]>({
            method: 'session.messages',
            params: { sessionId: session.id },
          });
          if (useWorkspaceStore.getState().session?.id !== session.id) return;
          loadHistory(history);
        } catch (error) {
          console.error('[app] loading the transcript failed', error);
        }
        // #11: seed the sidebar with the persisted checklist (the agent may
        // not touch `todo` again, so waiting for an event would miss it).
        try {
          const { items } = await invoke<{ items: TodoItem[] }>({
            method: 'agent.listTodos',
            params: { sessionId: session.id },
          });
          if (useWorkspaceStore.getState().session?.id !== session.id) return;
          setTodos(items);
        } catch (error) {
          console.error('[app] loading todos failed', error);
        }
      })();
    },
    [ensureProjectForSession, setSession, resetSessionView, setScope, loadHistory, setTodos],
  );

  const goBackFromRun = useCallback(() => {
    if (priorSession) {
      const back = priorSession;
      setPriorSession(null);
      selectSession(back);
      return;
    }
    setSession(null);
    resetSessionView();
    const activeProject = useWorkspaceStore.getState().project;
    if (activeProject) setScope(activeProject.id, null);
    setBlankRun(true);
  }, [priorSession, selectSession, resetSessionView, setSession, setScope]);

  /**
   * Open a session we only know the id of (an automation just started it).
   * The full summary is needed, not just the scope, or the run screen would
   * keep showing the previously selected session's title and send its
   * follow-ups to the wrong place.
   */
  const openSessionById = useCallback(
    async (sessionId: string) => {
      // Automations can be launched from the All view for another project.
      // Resolve globally; selectSession will switch to the owning workspace.
      const list = await invoke<SessionSummary[]>({
        method: 'session.list',
        params: {},
      });
      const found = list.find((item) => item.id === sessionId);
      if (found) selectSession(found);
    },
    [selectSession],
  );

  /** Send a skill into the composer rather than firing it blind. */
  const useSkill = useCallback((skill: SkillInfo) => {
    setComposerInsert({ text: `${skill.command} `, token: Date.now() });
    setView('run');
  }, []);

  const selectHistorySession = useCallback(
    (meta: HistorySessionMeta) => {
      setHistoryBootLive(null);
      setHistorySessionKey(meta.key);
      if (meta.origin === 'pix' && meta.pixSessionId && meta.pixProjectId) {
        selectSession({
          id: meta.pixSessionId,
          projectId: meta.pixProjectId,
          title: meta.title || 'Session',
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          archived: false,
        });
        return;
      }
      setView('history');
    },
    [selectSession],
  );

  /**
   * Act on a file or code hit from ⌘K. A hit in another project switches to that
   * project first — the index searches all of them, so a result you cannot reach
   * would be worse than no result. There is no in-app file viewer, so the file
   * itself is handed to the OS rather than pretending to open it here.
   */
  async function openIndexHit(hit: IndexHit) {
    const current = useWorkspaceStore.getState().project;
    if (hit.projectPath && hit.projectId !== current?.id) {
      await openProjectPath(hit.projectPath);
    }
    if (!hit.projectPath) return;
    await invoke({
      method: 'system.revealPath',
      params: { path: `${hit.projectPath}/${hit.path}` },
    }).catch((err) => console.error(err));
  }

  async function openProjectPath(pathValue: string) {
    setProjectError(null);
    try {
      const opened = await invoke<ProjectSummary>({
        method: 'project.open',
        params: { path: pathValue },
      });
      setProject(opened);
      resetSessionView();
      setScope(opened.id, null);
      setPriorSession(null);
      await queryClient.invalidateQueries({ queryKey: ['project.listRecent'] });
      setBlankRun(true);
      setView('run');
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * The OS folder picker, reached from the sidebar's folder button, ⌘O and ⌘K.
   * There is no intermediate dialog: the picker is already modal, so a popup in
   * front of it was one click of pure ceremony.
   */
  const browseForProject = useCallback(async () => {
    setProjectError(null);
    try {
      const opened = await invoke<ProjectSummary>({ method: 'project.pickFolder' });
      setProject(opened);
      resetSessionView();
      setScope(opened.id, null);
      setPriorSession(null);
      await queryClient.invalidateQueries({ queryKey: ['project.listRecent'] });
      setBlankRun(true);
      setView('run');
    } catch (err) {
      // Closing the picker is not an error worth reporting.
      if (err instanceof IpcError && err.code === 'CANCELLED') return;
      setProjectError(err instanceof Error ? err.message : String(err));
    }
  }, [queryClient, resetSessionView, setProject, setScope]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'new-task', title: 'New task', hint: '⌘N', run: () => newTask() },
      { id: 'terminal', title: 'Open terminal', run: () => setView('terminal') },
      { id: 'automations', title: 'Open automations', run: () => setView('automations') },
      { id: 'skills', title: 'Open skills', run: () => setView('skills') },
      {
        id: 'review',
        title: 'Review changes',
        run: () => {
          setDiffFocusPath(undefined);
          setView('diff');
        },
      },
      {
        id: 'open-project',
        title: 'Open project folder',
        hint: '⌘O',
        run: () => void browseForProject(),
      },
      {
        id: 'settings',
        title: 'Open settings',
        hint: '⌘,',
        run: () => {
          setSettingsTab('providers');
          setView('settings');
        },
      },
    ],
    [newTask, browseForProject],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'n') {
        event.preventDefault();
        newTask();
      }
      if (event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'o') {
        event.preventDefault();
        // Straight to the OS picker, the way ⌘O behaves everywhere else.
        void browseForProject();
      }
      if (event.key === ',') {
        event.preventDefault();
        setSettingsTab('providers');
        setView('settings');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newTask, browseForProject]);

  async function decideApproval(decision: ApprovalDecision) {
    if (!approval) return;
    try {
      await invoke({
        method: 'agent.resolveApproval',
        params: { requestId: approval.requestId, decision },
      });
    } catch (err) {
      useAgentStreamStore.setState({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** #12: answer the agent's question; the blocked run resumes with the answer. */
  async function answerAsk(answer: string) {
    if (!pendingAsk) return;
    try {
      await invoke({
        method: 'agent.answerAsk',
        params: { askId: pendingAsk.askId, answer },
      });
      useAgentStreamStore.setState({ pendingAsk: null });
    } catch (err) {
      console.error('[app] answering ask failed', err);
      useAgentStreamStore.setState({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** The thread carries its own approval card, so the modal is for every other screen. */
  const showApprovalDialog =
    approval !== null && view !== 'run' && dismissedApproval !== approval.requestId;

  const main = (
    <div className="flex h-full min-h-0 flex-col">
      <PreflightBanner />
      <div className="flex min-h-0 min-w-0 w-full flex-1">
        {view === 'settings' ? (
          <SettingsView
            initialTab={settingsTab}
            onClose={() => setView('run')}
          />
        ) : view === 'terminal' ? (
          <TerminalView />
        ) : view === 'automations' ? (
          <AutomationsView onOpenSession={openSessionById} />
        ) : view === 'skills' ? (
          <SkillsView onRunSkill={useSkill} />
        ) : view === 'history' ? (
          <HistoryBrowser
            sessionKey={historySessionKey}
            bootLive={historyBootLive}
            onBootLiveConsumed={() => setHistoryBootLive(null)}
          />
        ) : view === 'diff' ? (
          <DiffPanel
            onContinue={() => setView('run')}
            onBack={() => setView('run')}
            focusPath={diffFocusPath}
            onRecoveryResolved={() => setView('run')}
          />
        ) : (
          <ChatPanel
            onBack={goBackFromRun}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((open) => !open)}
            insert={composerInsert}
            blank={blankRun}
            onTaskStarted={() => setBlankRun(false)}
            onNewTask={newTask}
            onOpenProviders={() => {
              setSettingsTab('providers');
              setView('settings');
            }}
            onBrowseForProject={() => void browseForProject()}
          />
        )}
      </div>
    </div>
  );

  return (
    <AppShell
      sidebar={
        <ProjectSidebar
          activeNav={view}
          isBlankRun={blankRun}
          historyScope={historyScope}
          historySessionKey={historySessionKey}
          onHistoryScope={(scope) => {
            setHistoryScope(scope);
            setHistorySessionKey(null);
            setHistoryBootLive(null);
            if (scope.kind !== 'none') setView('history');
          }}
          onSelectHistorySession={selectHistorySession}
          onStartExternalAgent={(boot) => {
            setHistorySessionKey(null);
            setHistoryBootLive(boot);
            setHistoryScope({ kind: 'agent', agent: boot.agent });
            setView('history');
          }}
          onOpenSettings={() => {
            if (view === 'settings') {
              setView('run');
              return;
            }
            setSettingsTab('providers');
            setView('settings');
          }}
          onNewTask={newTask}
          onSelectSession={selectSession}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenAutomations={() => setView('automations')}
          onOpenSkills={() => setView('skills')}
          onBrowseForProject={() => void browseForProject()}
          externalError={projectError}
          onProjectSwitched={() => {
            setPriorSession(null);
            setBlankRun(true);
            setView('run');
          }}
        />
      }
      main={main}
      right={
        <RightDock
          onOpenFullDiff={(path) => {
            setDiffFocusPath(path);
            setView('diff');
          }}
          onInsertPath={(path) =>
            // A trailing space so you can keep typing after the reference.
            setComposerInsert({ text: `@${path} `, token: Date.now() })
          }
          onInsertComposer={(insert) => {
            setPanelOpen(true);
            setComposerInsert(insert);
          }}
        />
      }
      // The dock is not only about a finished run any more — files, terminal and
      // the preview are useful before the first message, so `blankRun` no longer
      // hides it.
      showRight={view === 'run' && panelOpen}
      overlay={
        <>
          {searchOpen ? (
            <SearchPalette
              commands={commands}
              onClose={() => setSearchOpen(false)}
              onOpenSession={(session) => selectSession(session)}
              onOpenHistory={(meta) => {
                setSearchOpen(false);
                if (meta.origin === 'pix' && meta.pixSessionId && meta.pixProjectId) {
                  selectSession({
                    id: meta.pixSessionId,
                    projectId: meta.pixProjectId,
                    title: meta.title,
                    createdAt: meta.createdAt,
                    updatedAt: meta.updatedAt,
                    archived: false,
                  });
                  return;
                }
                setHistoryScope(
                  meta.projectPath
                    ? {
                        kind: 'project',
                        path: meta.projectPath,
                        name: meta.projectName || meta.projectPath,
                      }
                    : { kind: 'agent', agent: meta.agent },
                );
                selectHistorySession(meta);
              }}
              onOpenFile={(hit) => void openIndexHit(hit)}
              onRunSkill={useSkill}
            />
          ) : null}
          {showApprovalDialog ? (
            <ApprovalDialog
              approval={approval}
              onDecide={(decision) => void decideApproval(decision)}
              onDismiss={() => setDismissedApproval(approval.requestId)}
            />
          ) : null}
          {pendingAsk && pendingAsk.sessionId === activeSessionId ? (
            <AskDialog
              ask={pendingAsk}
              onSubmit={(answer) => void answerAsk(answer)}
              onDismiss={() => {
                // Aborting the ask means answering nothing: deny is not a
                // decision, so stop the run instead of pretending an answer.
                const runId = useAgentStreamStore.getState().activeRunId;
                if (runId) {
                  void invoke({ method: 'agent.abort', params: { runId } }).catch(console.error);
                }
                useAgentStreamStore.setState({ pendingAsk: null });
              }}
            />
          ) : null}
        </>
      }
    />
  );
}
