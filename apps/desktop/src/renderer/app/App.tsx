import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
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
  const [panelOpen, setPanelOpen] = useState(true);
  const [dismissedApproval, setDismissedApproval] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerInsert, setComposerInsert] = useState<{ text: string; token: number } | null>(
    null,
  );

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
    const created = await createTask();
    if (created) {
      setBlankRun(true);
      setView('run');
    }
  }, [createTask]);

  const selectSession = useCallback(
    (session: SessionSummary) => {
      setSession(session);
      resetSessionView();
      setScope(session.projectId, session.id);
      // Picking an existing task shows its run, not the unstarted state.
      setBlankRun(false);
      setView('run');
      /*
       * Reopening a task shows what was said in it. Before this the thread was
       * empty every time, so past work was invisible even though the agent still
       * had it in context — the single most disorienting thing about the app.
       */
      void invoke<StoredMessage[]>({
        method: 'session.messages',
        params: { sessionId: session.id },
      })
        .then((history) => {
          // Ignore a late reply for a task the user has already navigated away
          // from, or it would drop someone else's transcript into this thread.
          if (useWorkspaceStore.getState().session?.id !== session.id) return;
          if (history.length) loadHistory(history);
        })
        .catch((error) => console.error('[app] loading the transcript failed', error));
    },
    [setSession, resetSessionView, setScope, loadHistory],
  );

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
      { id: 'review', title: 'Review changes', run: () => setView('diff') },
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
      {showBanner ? (
        <div className="flex flex-none items-center gap-2.5 border-b border-accent/25 bg-accent-100 px-4.5 py-2.5">
          <AlertTriangle className="h-[15px] w-[15px] flex-none text-accent-700" />
          <span className="flex-1 text-[12.5px] text-accent-900">
            {unresolved.length} unresolved checkpoint{unresolved.length > 1 ? 's' : ''} need
            {unresolved.length > 1 ? '' : 's'} review — run{' '}
            <span className="font-mono">{unresolved[0]!.runId.slice(0, 8)}</span>
            {unresolved.length > 1 ? ' and others were' : ' was'} interrupted.
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="border-accent/35"
            onClick={() => reviewRecovery(unresolved[0]!.runId)}
          >
            Review
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
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
            onRecoveryResolved={() => setView('run')}
          />
        ) : (
          <ChatPanel
            onBack={() => void newTask()}
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
          onNewTask={() => {
            setBlankRun(true);
            setView('run');
          }}
          onSelectSession={() => {
            setBlankRun(false);
            setView('run');
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onBrowseForProject={() => void browseForProject()}
          externalError={projectError}
          onProjectSwitched={() => {
            setBlankRun(true);
            setView('run');
          }}
          onNavigate={(destination: SidebarDestination) => setView(destination)}
        />
      }
      main={main}
      right={
        <RightDock
          onOpenFullDiff={() => setView('diff')}
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
