import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  FilePlus2,
  FileText,
  FolderSearch,
  GitBranch,
  Lock,
  PanelRight,
  Pencil,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  ApprovalDecision,
  ApprovalMode,
  IndexSearchResult,
  RunRef,
  SkillInfo,
} from '@pi-desktop/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApprovalModePicker } from '@/features/chat/ApprovalModePicker';
import { ThinkingLevelPicker } from '@/features/chat/ThinkingLevelPicker';
import { ThinkingPlaceholderRow, ThinkingStreamRow } from '@/features/chat/ThinkingStream';
import { Markdown } from '@/features/chat/Markdown';
import { ModelPicker } from '@/features/models/ModelPicker';
import { useCreateTask } from '@/features/sessions/use-create-task';
import { invoke } from '@/lib/ipc';
import {
  dotStyle,
  formatDuration,
  formatTokens,
  NOT_REPORTED,
  statusLabel,
  statusTone,
  toneBadge,
} from '@/lib/status';
import { cn } from '@/lib/utils';
import { useAgentStreamStore, type ToolCallCard } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

const toolIcons: Record<string, ReactNode> = {
  read: <BookOpen className="h-3 w-3" />,
  edit: <Pencil className="h-3 w-3" />,
  write: <FilePlus2 className="h-3 w-3" />,
  bash: <Terminal className="h-3 w-3" />,
  grep: <Search className="h-3 w-3" />,
  find: <FolderSearch className="h-3 w-3" />,
  ls: <FolderSearch className="h-3 w-3" />,
};

interface ChatPanelProps {
  onBack: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** Text pushed into the composer from elsewhere (a `$skill`, for instance). */
  insert?: { text: string; token: number } | null;
  /**
   * True for a task that has not been started. The design v3 replaced the task
   * list with this state: same screen, no run to report on yet.
   */
  blank: boolean;
}

export function ChatPanel({ onBack, panelOpen, onTogglePanel, insert, blank }: ChatPanelProps) {
  const session = useWorkspaceStore((s) => s.session);
  const project = useWorkspaceStore((s) => s.project);
  const { createTask } = useCreateTask();
  const messages = useAgentStreamStore((s) => s.messages);
  const tools = useAgentStreamStore((s) => s.tools);
  const thinkings = useAgentStreamStore((s) => s.thinkings);
  const status = useAgentStreamStore((s) => s.status);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const usage = useAgentStreamStore((s) => s.usage);
  const startedAt = useAgentStreamStore((s) => s.startedAt);
  const approval = useAgentStreamStore((s) => s.approval);
  const error = useAgentStreamStore((s) => s.error);
  const errorRetryable = useAgentStreamStore((s) => s.errorRetryable);
  const lastUserText = useAgentStreamStore((s) => s.lastUserText);
  const appendUserMessage = useAgentStreamStore((s) => s.appendUserMessage);
  const setStopping = useAgentStreamStore((s) => s.setStopping);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  /** Room reserved under the floating composer so the last message stays visible. */
  const [composerPad, setComposerPad] = useState(140);
  /** IME composition (中文等) — Enter confirms candidates, it must not send. */
  const composingRef = useRef(false);
  const prevStatusRef = useRef(status);

  function focusComposer() {
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  const queryClient = useQueryClient();
  const approvalMode = useQuery({
    queryKey: ['agent.getApprovalMode', session?.id],
    queryFn: () =>
      invoke<{ mode: ApprovalMode }>({
        method: 'agent.getApprovalMode',
        params: { sessionId: session?.id },
      }),
  });
  const setApprovalMode = useMutation({
    mutationFn: (mode: ApprovalMode) =>
      invoke({ method: 'agent.setApprovalMode', params: { mode, sessionId: session?.id } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['agent.getApprovalMode'] }),
  });

  const branch = useQuery({
    queryKey: ['git.getBranch', project?.id],
    enabled: Boolean(project?.trusted && project.isGit),
    queryFn: () =>
      invoke<{ branch: string | null }>({
        method: 'git.getBranch',
        params: { projectId: project!.id },
      }),
  });

  const skills = useQuery({
    queryKey: ['skills.list', project?.id],
    queryFn: () =>
      invoke<SkillInfo[]>({ method: 'skills.list', params: { projectId: project?.id } }),
  });

  // Text handed in from the Skills screen or the ⌘K palette.
  useEffect(() => {
    if (!insert) return;
    setDraft((current) => (current ? `${current}${insert.text}` : insert.text));
    composerRef.current?.focus();
  }, [insert]);

  // When a run finishes, put the caret back in the composer so the next message
  // does not need a click — the thread just stole focus while streaming.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    const wasRunning =
      prev === 'running' || prev === 'starting' || prev === 'stopping';
    const finished =
      status === 'completed' || status === 'failed' || status === 'cancelled';
    if (wasRunning && finished && !approval && project) {
      focusComposer();
    }
  }, [status, approval, project]);

  /**
   * `@` at the start of a word offers files from the workspace index.
   *
   * The composer advertised "@ for files" from the day the design landed and
   * nothing was behind it. The index already knows every tracked file in the
   * project, so this is the same data ⌘K searches.
   */
  const fileQuery = /(?:^|\s)@([^\s]*)$/.exec(draft)?.[1];
  const fileHits = useQuery({
    queryKey: ['index.search', 'mention', project?.id, fileQuery],
    enabled: fileQuery !== undefined && Boolean(project?.id),
    queryFn: () =>
      invoke<IndexSearchResult>({
        method: 'index.search',
        // Scoped to this project: a path from another one would not resolve here.
        params: { query: fileQuery ?? '', projectId: project!.id, limit: 6 },
      }),
  });
  const fileMatches = fileQuery === undefined ? [] : (fileHits.data?.paths ?? []);
  const fileMenuOpen = fileQuery !== undefined && Boolean(project?.id);

  function applyFile(path: string) {
    // Replaces the partial `@…` token, leaving a trailing space to keep typing.
    setDraft((current) => current.replace(/@[^\s]*$/, `@${path} `));
    composerRef.current?.focus();
  }

  /** `$` at the start of a word opens the skill list (the design's `$` affordance). */
  const skillQuery = /(?:^|\s)\$([a-z0-9-]*)$/i.exec(draft)?.[1];
  const skillMatches = (skills.data ?? []).filter(
    (skill) =>
      skill.enabled &&
      (skillQuery === undefined || skill.command.slice(1).startsWith(skillQuery.toLowerCase())),
  );

  useEffect(() => {
    setSkillMenuOpen(skillQuery !== undefined && skillMatches.length > 0);
  }, [skillQuery, skillMatches.length]);

  function applySkill(skill: SkillInfo) {
    setDraft((current) => current.replace(/(?:\$[a-z0-9-]*)$/i, `${skill.command} `));
    setSkillMenuOpen(false);
    composerRef.current?.focus();
  }

  // NB: agent events are subscribed once in App, not here — the stream must keep
  // being applied while the user is on another screen.

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottomRef.current = distance < 96;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // One scrollbar for the whole chat surface; the composer floats over it.
  // Track dock height (card + fade pad) so the last bubble stays clear.
  useEffect(() => {
    const el = composerDockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const next = el.offsetHeight;
      setComposerPad((prev) => (prev === next ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, tools, status, approval, thinkings, composerPad]);

  const running =
    status === 'running' ||
    status === 'starting' ||
    status === 'waiting_for_approval' ||
    status === 'stopping';

  const hasStreamingAssistant = messages.some((m) => m.role === 'assistant' && m.streaming);
  const hasRunningTools = tools.some((t) => t.status === 'running');
  const hasStreamingThinking = thinkings.some((t) => t.streaming);
  const showThinking =
    (status === 'starting' || status === 'running' || status === 'stopping') &&
    !hasStreamingThinking &&
    !hasStreamingAssistant &&
    !hasRunningTools &&
    !approval;

  /** Messages, reasoning, and tool calls share an arrival counter. */
  const timeline = useMemo(
    () =>
      [
        ...messages.map((message) => ({ kind: 'message' as const, order: message.order, message })),
        ...thinkings.map((thinking) => ({
          kind: 'thinking' as const,
          order: thinking.order,
          thinking,
        })),
        ...tools.map((tool) => ({ kind: 'tool' as const, order: tool.order, tool })),
      ].sort((a, b) => a.order - b.order),
    [messages, thinkings, tools],
  );

  async function send() {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    appendUserMessage(text);
    setSending(true);
    try {
      /*
       * The unstarted-task screen can be reached with no session behind it —
       * switching to a project that has no tasks lands there. Sending is what
       * creates the task in that case; before this, Enter did nothing at all.
       */
      let active = session;
      if (!active) {
        active = await createTask();
        if (!active) {
          useAgentStreamStore.setState({
            status: 'failed',
            error: 'Open a project before sending.',
            errorRetryable: false,
          });
          return;
        }
      }
      if (running) {
        await invoke({ method: 'agent.followUp', params: { sessionId: active.id, text } });
      } else {
        useAgentStreamStore.setState({ status: 'starting', error: null, errorRetryable: false });
        await invoke<RunRef>({
          method: 'agent.sendMessage',
          params: { sessionId: active.id, text },
        });
      }
    } catch (err) {
      console.error(err);
      useAgentStreamStore.setState({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        errorRetryable: true,
      });
    } finally {
      setSending(false);
    }
  }

  async function retry() {
    if (!session || !lastUserText || running) return;
    setSending(true);
    useAgentStreamStore.setState({ status: 'starting', error: null, errorRetryable: false });
    try {
      await invoke<RunRef>({
        method: 'agent.sendMessage',
        params: { sessionId: session.id, text: lastUserText },
      });
    } catch (err) {
      useAgentStreamStore.setState({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        errorRetryable: true,
      });
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!activeRunId) return;
    setStopping(activeRunId);
    try {
      await invoke({ method: 'agent.abort', params: { runId: activeRunId } });
    } catch (err) {
      console.error(err);
    }
  }

  async function resolveApproval(decision: ApprovalDecision) {
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

  const tone = statusTone(status);
  const runTitle = blank ? 'New task' : (session?.title ?? 'No session');
  const runMeta = blank
    ? [project?.name ?? 'no project', branch.data?.branch, 'not started yet']
        .filter(Boolean)
        .join(' · ')
    : [
        activeRunId ? `run ${activeRunId.slice(0, 8)}` : `run ${NOT_REPORTED}`,
        formatDuration(startedAt),
        usage?.totalTokens != null
          ? `${formatTokens(usage.totalTokens)} tokens`
          : 'usage not reported',
      ].join(' · ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Run header */}
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="quiet" size="icon" className="h-7 w-7" onClick={onBack} title="Back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-tight font-bold">{runTitle}</div>
          <div className="font-mono text-[10.5px] leading-snug text-muted">{runMeta}</div>
        </div>
        {blank ? <Badge tone="neutral">not started</Badge> : null}
        {!blank && status !== 'idle' ? (
          <Badge tone={toneBadge[tone]} className="gap-1.5">
            <span style={dotStyle(tone, 6)} />
            {statusLabel(status)}
          </Badge>
        ) : null}
        {!blank && running ? (
          <Button variant="secondary" size="sm" onClick={() => void stop()}>
            <Square className="h-2.5 w-2.5 fill-current" />
            Stop
          </Button>
        ) : null}
        <Button
          variant="quiet"
          size="icon"
          onClick={onTogglePanel}
          title={panelOpen ? 'Hide review panel' : 'Show review panel'}
          className={cn(panelOpen && 'bg-foreground/[0.08]')}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Full-height scroller with a floating composer on top — Cursor/Codex
          style. Padding sits outside max-w so transcript (bash / markdown)
          matches the composer width; scrollbar is hidden so it can't skew that. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="px-5 pt-5" style={{ paddingBottom: composerPad + 84 }}>
            <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-3">
              {!timeline.length && !approval ? (
                <div className="flex flex-col items-center gap-2 px-5 py-20 text-center">
                  <div className="text-sm font-bold">
                    {session ? 'Describe what it should do' : 'Open a project to start'}
                  </div>
                  <p className="max-w-[320px] text-[12.5px] leading-relaxed text-muted">
                    {session
                      ? "Type below — @ for a file, $ for a skill, ⌘K for commands. It'll read the project, plan, then ask before running anything risky."
                      : 'Use Open project in the sidebar, then start a task.'}
                  </p>
                </div>
              ) : null}

            {timeline.map((entry) =>
              entry.kind === 'message' ? (
                entry.message.role === 'user' ? (
                  <div
                    key={entry.message.id}
                    className="max-w-[78%] self-end rounded-[22px_22px_6px_22px] bg-surface px-4 py-2.5 text-[13.5px] leading-relaxed shadow-[var(--shadow-sm)] whitespace-pre-wrap"
                  >
                    {entry.message.content}
                  </div>
                ) : (
                  <AssistantMessage
                    key={entry.message.id}
                    content={entry.message.content}
                    streaming={entry.message.streaming}
                  />
                )
              ) : entry.kind === 'thinking' ? (
                <ThinkingStreamRow
                  key={entry.thinking.id}
                  content={entry.thinking.content}
                  streaming={entry.thinking.streaming}
                  expanded={Boolean(expanded[entry.thinking.id])}
                  onToggle={() =>
                    setExpanded((state) => ({
                      ...state,
                      [entry.thinking.id]: !state[entry.thinking.id],
                    }))
                  }
                />
              ) : (
                <ToolCard
                  key={entry.tool.id}
                  tool={entry.tool}
                  expanded={Boolean(expanded[entry.tool.id])}
                  onToggle={() =>
                    setExpanded((state) => ({ ...state, [entry.tool.id]: !state[entry.tool.id] }))
                  }
                />
              ),
            )}

            {/* Approval */}
            {approval ? (
              <div className="flex flex-col gap-3 rounded-[20px] border border-accent/30 bg-accent-100 px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <Lock className="h-4 w-4 flex-none text-accent-800" />
                  <div className="text-sm font-bold text-accent-900">Approval required</div>
                  <Badge tone="outline" className="text-[10.5px]">
                    risk: {approval.riskLevel}
                  </Badge>
                </div>
                <div className="pl-[26px] text-[13px] leading-normal text-accent-900">
                  {approval.summary}
                </div>
                {approval.command ? (
                  <pre className="output-pre ml-[26px] rounded-[14px] px-3.5 py-2.5">
                    {approval.command}
                  </pre>
                ) : null}
                {approval.reasons.length ? (
                  <div className="flex flex-col gap-1.5 pl-[26px]">
                    {approval.reasons.map((reason) => (
                      <div key={reason} className="flex items-start gap-2.5 text-[12.5px]">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-accent-2" />
                        <span className="leading-normal text-accent-900">{reason}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {approval.affectedPaths.length ? (
                  <div className="pl-[26px] font-mono text-[11px] text-accent-800/80">
                    {approval.affectedPaths.slice(0, 4).join('  ')}
                    {approval.affectedPaths.length > 4
                      ? `  +${approval.affectedPaths.length - 4} more`
                      : ''}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pl-[26px]">
                  <Button size="sm" onClick={() => void resolveApproval('allow-once')}>
                    Allow once
                  </Button>
                  {approval.rememberable ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="border-accent/35"
                        onClick={() => void resolveApproval('allow-session')}
                      >
                        Allow session
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="border-accent/35"
                        onClick={() => void resolveApproval('allow-project')}
                      >
                        Allow project
                      </Button>
                    </>
                  ) : null}
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-accent-800"
                    onClick={() => void resolveApproval('deny')}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Error */}
            {error ? (
              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-danger/30 bg-danger/10 px-4 py-2.5 text-[12.5px] text-danger">
                <span className="min-w-0 flex-1">{error}</span>
                {errorRetryable && lastUserText ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={sending || running}
                    onClick={() => void retry()}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : null}

            {showThinking ? <ThinkingPlaceholderRow /> : null}

            {status === 'waiting_for_approval' && !approval ? (
              <div className="text-[12.5px] text-muted">
                Waiting for your decision — the run is paused.
              </div>
            ) : null}

            {status === 'stopping' ? (
              <div className="text-[12.5px] text-muted">Stopping the run…</div>
            ) : null}

            {/* Bottom spacer guarantees last message scrolls cleanly above floating composer */}
            <div
              style={{ height: Math.max(composerPad + 60, 180) }}
              className="flex-none pointer-events-none"
              aria-hidden
            />
            </div>
          </div>
        </div>

        {/* Floating composer dock. Only the card captures pointer events so
            scroll still works through the fade and empty side gutters. */}
        <div
          ref={composerDockRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background from-[52%] via-background/90 to-transparent pt-10 px-5 pb-4"
        >
          <div className="pointer-events-auto mx-auto w-full min-w-0 max-w-[760px]">
            {fileMenuOpen ? (
              <div className="mb-1.5 overflow-hidden rounded-[18px] border border-border bg-background shadow-[var(--shadow-md)]">
                {fileHits.isLoading ? (
                  <p className="px-3.5 py-2 text-[12px] text-muted">Searching files…</p>
                ) : fileMatches.length ? (
                  fileMatches.map((hit) => (
                    <button
                      key={hit.path}
                      type="button"
                      onClick={() => applyFile(hit.path)}
                      className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3.5 py-2 text-left hover:bg-foreground/[0.06]"
                    >
                      <FileText className="h-3.5 w-3.5 flex-none text-muted" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{hit.path}</span>
                    </button>
                  ))
                ) : (
                  <p className="px-3.5 py-2 text-[12px] text-muted">
                    {project?.trusted
                      ? 'No files indexed yet — open Files and tap Refresh, or keep typing to filter.'
                      : 'Trust this project to search and reference files.'}
                  </p>
                )}
              </div>
            ) : null}
            {skillMenuOpen ? (
              <div className="mb-1.5 overflow-hidden rounded-[18px] border border-border bg-background shadow-[var(--shadow-md)]">
                {skillMatches.slice(0, 6).map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => applySkill(skill)}
                    className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3.5 py-2 text-left hover:bg-foreground/[0.06]"
                  >
                    <span className="rounded-full bg-accent-100 px-2 py-0.5 font-mono text-[11.5px] text-accent-800">
                      {skill.command}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{skill.name}</span>
                    <span className="text-[10.5px] text-muted">{skill.scope}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="density-composer overflow-hidden rounded-[26px] border border-border bg-surface shadow-[var(--shadow-sm)]">
              <textarea
                ref={composerRef}
                className="max-h-44 min-h-[52px] w-full resize-none bg-transparent px-4 py-3 text-[13.5px] leading-normal outline-none placeholder:text-muted"
                placeholder={
                  project
                    ? 'Describe the change you want — @ for a file, $ for a skill'
                    : 'Open a project to begin…'
                }
                disabled={!project || sending}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  // While the IME is open (拼音选字等), Enter confirms the candidate —
                  // not sends. Without this, Chinese input accidentally submits mid-word.
                  if (
                    event.nativeEvent.isComposing ||
                    composingRef.current ||
                    event.keyCode === 229
                  ) {
                    return;
                  }
                  // Shift+Enter is the newline. Enter sends, which is what a chat
                  // composer is expected to do; ⌘/Ctrl+Enter keeps working for the
                  // muscle memory it was built with.
                  if (event.shiftKey) return;
                  event.preventDefault();
                  // With a suggestion list open, Enter takes the first suggestion
                  // rather than sending a half-typed `$re` or `@src/`.
                  if (fileMenuOpen) {
                    if (fileMatches.length) {
                      applyFile(fileMatches[0]!.path);
                    }
                    return;
                  }
                  if (skillMenuOpen && skillMatches.length) {
                    applySkill(skillMatches[0]!);
                    return;
                  }
                  void send();
                }}
              />

              <div className="flex items-center gap-2 px-3 pb-2.5">
                <ApprovalModePicker
                  mode={approvalMode.data?.mode ?? 'auto-reads'}
                  onChange={(mode) => setApprovalMode.mutate(mode)}
                />
                <ThinkingLevelPicker disabled={!project || sending} />
                {branch.data?.branch ? (
                  <ContextPill icon={<GitBranch className="h-3 w-3" />}>
                    {branch.data.branch}
                  </ContextPill>
                ) : null}
                <span className="min-w-0 flex-1" />
                {/* Model choice belongs with the send button: it is a property of the
                    message you are about to send, not of the window. */}
                <ModelPicker />
                <span className="flex-none font-mono text-[11px] text-muted">↵</span>
                <Button
                  size="icon"
                  className="h-[30px] w-[30px] flex-none"
                  // Not `!session`: the unstarted-task screen has no session yet and
                  // sending is what creates one, so gating on it left a dead button
                  // next to a working ⌘↵.
                  disabled={!project || !draft.trim() || sending}
                  onClick={() => void send()}
                  title="Send (⏎ — use ⇧⏎ for a new line)"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <Markdown streaming={streaming}>{content}</Markdown>
    </div>
  );
}

function ToolCard({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolCallCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ok = tool.status === 'completed';
  const failed = tool.status === 'failed';
  const runningNow = tool.status === 'running';
  const icon = toolIcons[tool.toolName.toLowerCase()] ?? <Wrench className="h-3 w-3" />;
  const canExpand = Boolean(tool.inputSummary || tool.outputSummary);
  const summary = tool.inputSummary.replace(new RegExp(`^${tool.toolName}:\\s*`, 'i'), '');

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-1 my-0.5">
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 py-1 px-0.5 text-left transition-opacity',
          canExpand ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
        )}
      >
        <span
          className="grid size-5 flex-none place-items-center rounded-full"
          style={
            failed
              ? { background: 'var(--color-accent-200)', color: 'var(--color-accent-800)' }
              : ok
                ? { background: 'var(--color-accent-2-200)', color: 'var(--color-accent-2-800)' }
                : { background: 'var(--color-neutral-200)', color: 'var(--color-neutral-700)' }
          }
        >
          {icon}
        </span>
        <span className="flex-none text-[12px] font-semibold">{tool.toolName}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted">{summary || tool.inputSummary}</span>
        {runningNow ? (
          <span
            className="size-1.5 flex-none rounded-full bg-accent-2"
            style={{ animation: 'pi-pulse 1.2s ease-in-out infinite' }}
          />
        ) : null}
        {canExpand ? (
          <ChevronDown
            className="size-3.5 flex-none opacity-45 transition-transform"
            style={expanded ? { transform: 'rotate(180deg)' } : undefined}
          />
        ) : null}
      </button>
      {expanded ? (
        <div className="flex w-full min-w-0 max-w-full flex-col gap-2 my-1 pl-3 border-l-2 border-foreground/20 font-mono text-[11.5px] leading-relaxed">
          {tool.inputSummary ? (
            <div className="min-w-0 max-w-full">
              <div className="mb-1 text-[10px] font-bold tracking-wider text-muted uppercase">Input</div>
              <pre className="output-pre w-full max-w-full whitespace-pre-wrap font-mono text-[11.5px]">
                {tool.inputSummary}
              </pre>
            </div>
          ) : null}
          {tool.outputSummary ? (
            <div className="min-w-0 max-w-full">
              <div className="mb-1 text-[10px] font-bold tracking-wider text-muted uppercase">Output</div>
              <pre className="output-pre w-full max-w-full whitespace-pre-wrap font-mono text-[11.5px]">
                {tool.outputSummary}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ContextPill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border px-2.5 py-[3px] text-[11px] text-foreground/[0.62]">
      <span className="flex-none">{icon}</span>
      {children}
    </span>
  );
}
