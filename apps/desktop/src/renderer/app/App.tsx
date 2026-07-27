import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ApprovalDecision,
  CheckpointRecoverySummary,
  IndexHit,
  ProjectSummary,
  SessionSummary,
  StoredMessage,
  SkillInfo,
} from '@pi-desktop/protocol';

import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { ApprovalDialog } from '@/features/approvals/ApprovalDialog';
import { AutomationsView } from '@/features/automations/AutomationsView';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { DiffPanel } from '@/features/diff/DiffPanel';
import { ProjectSidebar, type SidebarDestination } from '@/features/projects/ProjectSidebar';
import { SearchPalette, type PaletteCommand } from '@/features/search/SearchPalette';
import { useCreateTask } from '@/features/sessions/use-create-task';
import { SettingsView } from '@/features/settings/SettingsView';
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
type View = 'run' | 'diff' | 'settings' | 'recovery' | 'terminal' | 'automations' | 'skills';

export function App() {
  const [view, setView] = useState<View>('run');
  const [blankRun, setBlankRun] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [recoveryRunId, setRecoveryRunId] = useState<string | undefined>();
  const [diffFocusPath, setDiffFocusPath] = useState<string | undefined>();
  const [panelOpen, setPanelOpen] = useState(true);
  const [dismissedApproval, setDismissedApproval] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerInsert, setComposerInsert] = useState<{ text: string; token: number } | null>(
    null,
  );
  /** Session to restore when leaving an unstarted new task — back is not "new task again". */
  const [priorSession, setPriorSession] = useState<SessionSummary | null>(null);

  const queryClient = useQueryClient();
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);
  const approval = useAgentStreamStore((s) => s.approval);
  const applyEvent = useAgentStreamStore((s) => s.applyEvent);
  const loadHistory = useAgentStreamStore((s) => s.loadHistory);
  const { createTask } = useCreateTask();

  /**
   * Subscribed at the shell, not in the thread: a run keeps streaming while the
   * user is on the task list or in settings, and an approval that arrives then
   * still has to reach the store (and the modal below).
   */
  useEffect(() => {
    if (!window.piDesktop) return;
    return window.piDesktop.onAgentEvent((event) => {
      applyEvent(event);
      // A finished run is also when Main applies an auto-generated task name,
      // so refresh the list that shows it.
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        void queryClient.invalidateQueries({ queryKey: ['session.list', event.projectId] });
      }
    });
  }, [applyEvent, queryClient]);

  const recoverable = useQuery({
    queryKey: ['checkpoint.listRecoverable'],
    queryFn: () => invoke<CheckpointRecoverySummary[]>({ method: 'checkpoint.listRecoverable' }),
  });

  const newTask = useCallback(async () => {
    const current = useWorkspaceStore.getState().session;
    const created = await createTask();
    if (created) {
      if (current) setPriorSession(current);
      setBlankRun(true);
      setView('run');
    }
  }, [createTask]);

  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);

  async function ensureProjectForSession(
    projectId: string,
    hint?: ProjectSummary,
  ): Promise<ProjectSummary | null> {
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
  }

  const selectSession = useCallback(
    (session: SessionSummary, projectHint?: ProjectSummary) => {
      setPriorSession(null);
      void (async () => {
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
      })();
    },
    [
      queryClient,
      setActiveProject,
      setSession,
      resetSessionView,
      setScope,
      loadHistory,
    ],
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
      const project = useWorkspaceStore.getState().project;
      if (!project) return;
      const list = await invoke<SessionSummary[]>({
        method: 'session.list',
        params: { projectId: project.id },
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
      { id: 'new-task', title: 'New task', hint: '⌘N', run: () => void newTask() },
      { id: 'terminal', title: 'Open terminal', run: () => setView('terminal') },
      { id: 'automations', title: 'Open automations', run: () => setView('automations') },
      { id: 'skills', title: 'Open skills', run: () => setView('skills') },
      { id: 'review', title: 'Review changes', run: () => { setDiffFocusPath(undefined); setView('diff'); } },
      { id: 'open-project', title: 'Open project folder', hint: '⌘O', run: () => void browseForProject() },
      { id: 'settings', title: 'Open settings', hint: '⌘,', run: () => setView('settings') },
    ],
    [newTask, browseForProject],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'n') {
        event.preventDefault();
        void newTask();
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
        setView('settings');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newTask, browseForProject]);

  function reviewRecovery(runId: string) {
    setRecoveryRunId(runId);
    setView('recovery');
  }

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

  const unresolved = recoverable.data ?? [];
  /** The design carries the banner on the task screen; a live run keeps its own chrome. */
  /**
   * The design carried this on the task screen, which v3 removed. Kept on every
   * screen except the recovery view itself: an unresolved checkpoint is a safety
   * affordance and dropping it with the page would lose the only entry point.
   */
  const showBanner = unresolved.length > 0 && view !== 'recovery';

  /** The thread carries its own approval card, so the modal is for every other screen. */
  const showApprovalDialog =
    approval !== null && view !== 'run' && dismissedApproval !== approval.requestId;

  const main = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        {view === 'settings' ? (
          <SettingsView onClose={() => setView('run')} />
        ) : view === 'terminal' ? (
          <TerminalView />
        ) : view === 'automations' ? (
          <AutomationsView onOpenSession={openSessionById} />
        ) : view === 'skills' ? (
          <SkillsView onRunSkill={useSkill} />
        ) : view === 'recovery' ? (
          <DiffPanel
            onContinue={() => setView('run')}
            onBack={() => setView('run')}
            recoveryRunId={recoveryRunId}
            onRecoveryResolved={() => {
              setRecoveryRunId(undefined);
              setView('run');
              void recoverable.refetch();
            }}
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
          onOpenSettings={() => setView(view === 'settings' ? 'run' : 'settings')}
          onNewTask={(previous) => {
            if (previous) setPriorSession(previous);
            setBlankRun(true);
            setView('run');
          }}
          onSelectSession={selectSession}
          onOpenSearch={() => setSearchOpen(true)}
          onBrowseForProject={() => void browseForProject()}
          externalError={projectError}
          onProjectSwitched={() => {
            setPriorSession(null);
            setBlankRun(true);
            setView('run');
          }}
          onNavigate={(destination: SidebarDestination) => setView(destination)}
        />
      }
      main={main}
      right={
        <RightDock
          onOpenFullDiff={(path) => {
            setDiffFocusPath(path);
            setView('diff');
          }}
          onContinue={() => setView('run')}
          onInsertPath={(path) =>
            // A trailing space so you can keep typing after the reference.
            setComposerInsert({ text: `@${path} `, token: Date.now() })
          }
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
        </>
      }
    />
  );
}
