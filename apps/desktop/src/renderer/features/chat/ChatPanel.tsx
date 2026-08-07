import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  FileCode2,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderSearch,
  GitBranch,
  ImagePlus,
  ListOrdered,
  ListPlus,
  Lock,
  PanelRight,
  Pencil,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';

import type {
  ApprovalDecision,
  ApprovalMode,
  IndexSearchResult,
  InputImage,
  ModelInfo,
  ProjectSummary,
  RunRef,
  SessionMode,
  SkillInfo,
  StoredMessage,
} from '@pi-desktop/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';

import { SearchableSelect } from '@/components/SearchableSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { ApprovalModePicker } from '@/features/chat/ApprovalModePicker';
import { SessionModePicker } from '@/features/chat/SessionModePicker';
import {
  filterSlashCommands,
  matchSlashQuery,
  type SlashCommand,
} from '@/features/chat/slash-commands';
import { normalizeContextCapacity } from '@/features/chat/context-usage';
import { ThinkingLevelPicker } from '@/features/chat/ThinkingLevelPicker';
import { ThinkingPlaceholderRow, ThinkingStreamRow } from '@/features/chat/ThinkingStream';
import { Markdown } from '@/features/chat/Markdown';
import { ModelPicker } from '@/features/models/ModelPicker';
import { AUTO_MODEL_KEY } from '@/features/models/model-key';
import { useCreateTask } from '@/features/sessions/use-create-task';
import { invoke, IpcError } from '@/lib/ipc';
import { useAnchorAbove, useDismiss } from '@/lib/use-dismiss';
import {
  dotStyle,
  formatDuration,
  formatTokens,
  statusLabel,
  statusTone,
  toneBadge,
} from '@/lib/status';
import { cn } from '@/lib/utils';
import {
  computeTokenRate,
  useAgentStreamStore,
  type QueuedMessage,
  type ToolCallCard,
} from '@/stores/agent-stream-store';
import { composerDraftScope, useComposerDraftStore } from '@/stores/composer-draft-store';
import { useUiPrefsStore } from '@/stores/ui-prefs-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

const LAST_TASK_PROJECT_KEY = 'pi-desktop.last-task-project-id';
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

function readImageFile(file: File): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error(`Could not read ${file.name}`));
      resolve({
        data: result.slice(comma + 1),
        mimeType: file.type as InputImage['mimeType'],
        name: file.name || 'Pasted image',
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

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
  /** Called once the deferred session for a new task has been created. */
  onTaskStarted: () => void;
  /** `/new` — start a fresh task from the composer. */
  onNewTask: () => void;
}

export function ChatPanel({
  onBack,
  panelOpen,
  onTogglePanel,
  insert,
  blank,
  onTaskStarted,
  onNewTask,
}: ChatPanelProps) {
  const session = useWorkspaceStore((s) => s.session);
  const project = useWorkspaceStore((s) => s.project);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const setSelectedModel = useWorkspaceStore((s) => s.setSelectedModel);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const { createTask } = useCreateTask();
  const messages = useAgentStreamStore((s) => s.messages);
  const tools = useAgentStreamStore((s) => s.tools);
  const thinkings = useAgentStreamStore((s) => s.thinkings);
  const status = useAgentStreamStore((s) => s.status);
  const tokenRateSamples = useAgentStreamStore((s) => s.tokenRateSamples);
  const showTokenRate = useUiPrefsStore((s) => s.showTokenRate);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const usage = useAgentStreamStore((s) => s.usage);
  const isCompacting = useAgentStreamStore((s) => s.isCompacting);
  const retryAttempt = useAgentStreamStore((s) => s.retry);
  const model = useAgentStreamStore((s) => s.model);
  const pendingPlan = useAgentStreamStore((s) => s.pendingPlan);
  const startedAt = useAgentStreamStore((s) => s.startedAt);
  const approval = useAgentStreamStore((s) => s.approval);
  const error = useAgentStreamStore((s) => s.error);
  const errorRetryable = useAgentStreamStore((s) => s.errorRetryable);
  const lastUserText = useAgentStreamStore((s) => s.lastUserText);
  const lastUserImages = useAgentStreamStore((s) => s.lastUserImages);
  const appendUserMessage = useAgentStreamStore((s) => s.appendUserMessage);
  const setStopping = useAgentStreamStore((s) => s.setStopping);
  const queuedMessages = useAgentStreamStore((s) => s.queuedMessages);
  const addQueuedMessage = useAgentStreamStore((s) => s.addQueuedMessage);
  const removeQueuedMessage = useAgentStreamStore((s) => s.removeQueuedMessage);
  const clearQueue = useAgentStreamStore((s) => s.clearQueue);
  const popNextQueuedMessage = useAgentStreamStore((s) => s.popNextQueuedMessage);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);
  const loadHistory = useAgentStreamStore((s) => s.loadHistory);

  const draftScope = composerDraftScope(session?.id, project?.id);
  const draft = useComposerDraftStore((state) => state.drafts[draftScope] ?? '');
  const setDraft = useCallback(
    (next: SetStateAction<string>) => {
      const current = useComposerDraftStore.getState().drafts[draftScope] ?? '';
      useComposerDraftStore
        .getState()
        .setDraft(draftScope, typeof next === 'function' ? next(current) : next);
    },
    [draftScope],
  );
  const [sending, setSending] = useState(false);
  const [queueMode, setQueueMode] = useState<'queue' | 'steer'>('queue');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [projectSwitchError, setProjectSwitchError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<InputImage[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draggingImages, setDraggingImages] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
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
  const recentProjects = useQuery({
    queryKey: ['project.listRecent'],
    queryFn: () => invoke<ProjectSummary[]>({ method: 'project.listRecent' }),
  });
  const projectOptions = useMemo(() => {
    const byId = new Map<string, ProjectSummary>();
    if (project) byId.set(project.id, project);
    for (const item of recentProjects.data ?? []) byId.set(item.id, item);
    return [
      ...[...byId.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({ value: item.id, label: item.name, sublabel: item.path })),
      { value: '__browse__', label: 'Open another folder…', sublabel: 'Choose a project folder' },
    ];
  }, [project, recentProjects.data]);

  async function selectProject(projectId: string) {
    if (projectSwitching || projectId === project?.id) return;
    setProjectSwitching(true);
    setProjectSwitchError(null);
    try {
      const target = (recentProjects.data ?? []).find((item) => item.id === projectId);
      if (projectId !== '__browse__' && !target) throw new Error('Project is no longer available.');
      const opened =
        projectId === '__browse__'
          ? await invoke<ProjectSummary>({ method: 'project.pickFolder' })
          : await invoke<ProjectSummary>({
              method: 'project.open',
              params: { path: target!.path },
            });
      setProject(opened);
      resetSessionView();
      setScope(opened.id, null);
      await queryClient.invalidateQueries({ queryKey: ['project.listRecent'] });
      focusComposer();
    } catch (err) {
      if (err instanceof IpcError && err.code === 'CANCELLED') return;
      setProjectSwitchError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectSwitching(false);
    }
  }

  useEffect(() => {
    if (session && project) {
      try {
        localStorage.setItem(LAST_TASK_PROJECT_KEY, project.id);
      } catch {
        // Storage is optional; the active project still remains the in-window default.
      }
    }
  }, [project, session]);

  useEffect(() => {
    if (!blank || project || !recentProjects.data?.length) return;
    let preferredId = '';
    try {
      preferredId = localStorage.getItem(LAST_TASK_PROJECT_KEY) ?? '';
    } catch {
      // Fall back to the most recently opened project below.
    }
    const fallback =
      recentProjects.data.find((item) => item.id === preferredId) ??
      [...recentProjects.data].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    if (!fallback) return;
    setProject(fallback);
    resetSessionView();
    setScope(fallback.id, null);
  }, [blank, project, recentProjects.data, resetSessionView, setProject, setScope]);

  // Transient controls reset between tasks, while each task's unsent draft lives
  // in composerDraftStore and returns when the user comes back.
  useEffect(() => {
    setSending(false);
    setExpanded({});
    setSkillMenuOpen(false);
    setAttachments([]);
    setAttachmentError(null);
  }, [session?.id]);

  // New task should always arrive ready for typing. Project selection is
  // separate from the textarea, so changing folders never steals the draft.
  useEffect(() => {
    if (blank) focusComposer();
  }, [blank, project?.id]);

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

  const sessionMode = useQuery({
    queryKey: ['agent.getSessionMode', session?.id],
    queryFn: () =>
      invoke<{ mode: SessionMode }>({
        method: 'agent.getSessionMode',
        params: session?.id ? { sessionId: session.id } : {},
      }),
  });
  const setSessionMode = useMutation({
    mutationFn: (mode: SessionMode) =>
      invoke({
        method: 'agent.setSessionMode',
        params: session?.id ? { mode, sessionId: session.id } : { mode },
      }),
    onMutate: async (mode) => {
      await queryClient.cancelQueries({ queryKey: ['agent.getSessionMode', session?.id] });
      const previous = queryClient.getQueryData<{ mode: SessionMode }>([
        'agent.getSessionMode',
        session?.id,
      ]);
      queryClient.setQueryData(['agent.getSessionMode', session?.id], { mode });
      return { previous };
    },
    onError: (err, _mode, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['agent.getSessionMode', session?.id], context.previous);
      }
      useAgentStreamStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['agent.getSessionMode'] }),
  });

  const models = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });
  const activeModelKey = model ? `${model.providerId}/${model.modelId}` : selectedModel;
  const activeModel = models.data?.find(
    (entry) => `${entry.providerId}/${entry.modelId}` === activeModelKey,
  );
  const contextWindow =
    usage?.contextWindow ?? normalizeContextCapacity(activeModel?.contextWindow);
  const imageInputUnavailable = activeModel?.supportsImages === false;

  // Prefer Pi getContextUsage over last-turn billing totals once a session is open.
  useEffect(() => {
    if (!session?.id) return;
    void invoke<{
      tokens: number | null;
      contextWindow: number;
      percent: number | null;
    } | null>({
      method: 'agent.getContextUsage',
      params: { sessionId: session.id },
    })
      .then((usageNow) => {
        if (!usageNow) return;
        const projectId = session.projectId ?? project?.id;
        if (!projectId) return;
        useAgentStreamStore.getState().applyEvent({
          type: 'context.updated',
          projectId,
          sessionId: session.id,
          timestamp: Date.now(),
          tokens: usageNow.tokens,
          contextWindow: usageNow.contextWindow,
          percent: usageNow.percent,
        });
      })
      .catch(() => {
        // Session may not be resumed yet; stream events will catch up.
      });
  }, [session?.id, session?.projectId, project?.id]);

  async function compactSession() {
    if (!session?.id || compacting || isCompacting || running) return;
    setCompacting(true);
    try {
      await invoke({
        method: 'agent.compact',
        params: { sessionId: session.id },
      });
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompacting(false);
    }
  }

  async function addImageFiles(files: File[]) {
    setAttachmentError(null);
    if (imageInputUnavailable) {
      setAttachmentError(`${activeModel?.displayName ?? 'The selected model'} cannot read images.`);
      return;
    }
    const candidates = files.filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type));
    if (!candidates.length) {
      setAttachmentError('Choose a PNG, JPEG, WebP, or GIF image.');
      return;
    }
    if (attachments.length + candidates.length > MAX_IMAGE_COUNT) {
      setAttachmentError(`You can attach up to ${MAX_IMAGE_COUNT} images.`);
      return;
    }
    const tooLarge = candidates.find((file) => file.size > MAX_IMAGE_BYTES);
    if (tooLarge) {
      setAttachmentError(`${tooLarge.name} is larger than 10 MB.`);
      return;
    }
    const total =
      attachments.reduce((sum, image) => sum + image.size, 0) +
      candidates.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_IMAGE_BYTES) {
      setAttachmentError('Attached images may total at most 20 MB.');
      return;
    }
    try {
      const added = await Promise.all(candidates.map(readImageFile));
      setAttachments((current) => [...current, ...added]);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error));
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setAttachmentError(null);
  }

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
    // Wait until a project is in scope. Listing walks disk (global + project
    // skill roots); doing it on a blank cold start is work the user never asked
    // for and is the kind of background touch that feels like a permission grab.
    enabled: Boolean(project),
    queryFn: () =>
      invoke<SkillInfo[]>({ method: 'skills.list', params: { projectId: project?.id } }),
  });

  // Grow with the prompt up to a useful ceiling, then scroll internally. A
  // fixed 52px composer made long instructions feel like editing through a
  // keyhole and hid most of the text being sent.
  useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    const minHeight = 52;
    const maxHeight = 240;
    textarea.style.height = '0px';
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft]);

  // Text handed in from the Skills screen or the ⌘K palette.
  useEffect(() => {
    if (!insert) return;
    setDraft((current) => (current ? `${current}${insert.text}` : insert.text));
    composerRef.current?.focus();
  }, [insert, setDraft]);

  // When a run finishes, put the caret back in the composer so the next message
  // does not need a click — the thread just stole focus while streaming.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    const wasRunning = prev === 'running' || prev === 'starting' || prev === 'stopping';
    const finished = status === 'completed' || status === 'failed' || status === 'cancelled';
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
   *
   * `excludeProtected` (#4): the referenced path lands in the model's context,
   * so `.env`-style paths are not offered — unlike the ⌘K palette, which only
   * opens a file.
   */
  const fileQuery = /(?:^|\s)@([^\s]*)$/.exec(draft)?.[1];
  const fileHits = useQuery({
    queryKey: ['index.search', 'mention', project?.id, fileQuery],
    enabled: fileQuery !== undefined && Boolean(project?.id),
    queryFn: () =>
      invoke<IndexSearchResult>({
        method: 'index.search',
        // Scoped to this project: a path from another one would not resolve here.
        params: {
          query: fileQuery ?? '',
          projectId: project!.id,
          limit: 6,
          excludeProtected: true,
        },
      }),
  });
  const fileMatches = fileQuery === undefined ? [] : (fileHits.data?.paths ?? []);
  const fileMenuOpen = fileQuery !== undefined && Boolean(project?.id);

  function applyFile(path: string) {
    // Replaces the partial `@…` token, leaving a trailing space to keep typing.
    setDraft((current) => current.replace(/@[^\s]*$/, `@${path} `));
    composerRef.current?.focus();
  }

  /** `$` is a compact picker; the inserted value is Pi's `/skill:name` command. */
  const skillQuery = /(?:^|\s)\$([a-z0-9-]*)$/i.exec(draft)?.[1];
  const skillMatches = (skills.data ?? []).filter((skill) => {
    const commandName = skill.command.replace(/^\/skill:/, '');
    return (
      skill.enabled &&
      (skillQuery === undefined || commandName.startsWith(skillQuery.toLowerCase()))
    );
  });

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

  const hasStreamingAssistant = messages.some((m) => m.role === 'assistant' && m.streaming);
  const hasRunningTools = tools.some((t) => t.status === 'running');
  const hasStreamingThinking = thinkings.some((t) => t.streaming);
  // Some providers report their terminal run state just ahead of the final
  // render batch. Streaming content is itself proof that the turn is still
  // interactive, so keep Queue / Steer available for the whole visible output.
  const running =
    status === 'running' ||
    status === 'starting' ||
    status === 'waiting_for_approval' ||
    status === 'stopping' ||
    hasStreamingAssistant ||
    hasStreamingThinking ||
    hasRunningTools;
  const showThinking =
    (status === 'starting' || status === 'running' || status === 'stopping') &&
    !hasStreamingThinking &&
    !hasStreamingAssistant &&
    !hasRunningTools &&
    !approval;

  // Live token-rate readout next to the Working badge. Re-computed once a
  // second so the number decays to zero (and then away) while the model is
  // between responses — tool calls and thinking produce no usage deltas.
  const [rateNow, setRateNow] = useState(Date.now());
  useEffect(() => {
    if (!showTokenRate || !running) return;
    const timer = window.setInterval(() => setRateNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [showTokenRate, running]);
  const tokenRate =
    showTokenRate && running ? computeTokenRate(tokenRateSamples, rateNow) : null;

  /** Auto model (#21) from the slash menu — mirrors ModelPicker.chooseAuto. */
  async function chooseAutoModel() {
    setSelectedModel(AUTO_MODEL_KEY);
    void invoke({ method: 'settings.setDefaultModel', params: { model: { kind: 'auto' } } })
      .then(() => void queryClient.invalidateQueries({ queryKey: ['settings.get'] }))
      .catch(console.error);
    if (!session) return;
    await invoke({
      method: 'agent.setModel',
      params: { sessionId: session.id, model: { kind: 'auto' } },
    }).catch(console.error);
    void queryClient.invalidateQueries({ queryKey: ['agent.getThinkingLevel', session.id] });
  }

  /**
   * `/` at a line start offers built-in commands (#6): compact, plan/build
   * mode, auto model, clear queue, new task. Picking one runs it and drops the
   * slash text — a command is not something the model should see.
   */
  const slashQuery = matchSlashQuery(draft);
  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        keyword: 'compact',
        title: 'Compact conversation',
        description: 'Free context window space now',
        disabled: !session || running || isCompacting || compacting,
        run: () => void compactSession(),
      },
      {
        keyword: 'plan',
        title: 'Plan mode',
        description: 'Read-only run — nothing is written',
        disabled: running || sending || setSessionMode.isPending,
        run: () => void setSessionMode.mutate('plan'),
      },
      {
        keyword: 'build',
        title: 'Build mode',
        description: 'Full toolset — read, write, bash',
        disabled: running || sending || setSessionMode.isPending,
        run: () => void setSessionMode.mutate('build'),
      },
      {
        keyword: 'auto',
        title: 'Auto model',
        description: 'Pick per task & mode; fall back on rate limits',
        run: () => void chooseAutoModel(),
      },
      {
        keyword: 'clear',
        title: 'Clear message queue',
        description: `Drop ${queuedMessages.length} queued message${queuedMessages.length === 1 ? '' : 's'}`,
        disabled: queuedMessages.length === 0,
        run: clearQueue,
      },
      {
        keyword: 'new',
        title: 'New task',
        description: 'Start a fresh conversation',
        run: onNewTask,
      },
    ],
    // chooseAutoModel / compactSession are component closures; the commands
    // read them at run time, so memoizing on them would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      session,
      running,
      isCompacting,
      compacting,
      sending,
      setSessionMode,
      queuedMessages.length,
      clearQueue,
      onNewTask,
    ],
  );
  const slashMatches = filterSlashCommands(slashCommands, slashQuery);
  const slashMenuOpen = slashQuery !== undefined && slashMatches.length > 0;

  function runSlash(command: SlashCommand) {
    if (command.disabled) return;
    setDraft('');
    command.run();
    composerRef.current?.focus();
  }
  /**
   * Session Fork (#10): rewind to a historical user message from the toolbar
   * above the composer. The picker lists fork points from the Pi session tree;
   * choosing one arms a confirm step because everything after it is discarded.
   */
  const [forkMenuOpen, setForkMenuOpen] = useState(false);
  const [forkArm, setForkArm] = useState<{ entryId: string; text: string } | null>(null);
  const [forking, setForking] = useState(false);
  const forkRootRef = useRef<HTMLDivElement>(null);
  const forkMenuRef = useRef<HTMLDivElement>(null);
  const closeForkMenu = useCallback(() => {
    setForkMenuOpen(false);
    setForkArm(null);
  }, []);
  useDismiss(forkMenuOpen, [forkRootRef, forkMenuRef], closeForkMenu);
  const forkAnchor = useAnchorAbove(forkMenuOpen, forkRootRef, 'left');

  const forkPoints = useQuery({
    queryKey: ['agent.forkPoints', session?.id],
    enabled: Boolean(session?.id) && !blank,
    queryFn: () =>
      invoke<{ points: Array<{ entryId: string; text: string }> }>({
        method: 'agent.forkPoints',
        params: { sessionId: session!.id },
      }),
  });

  async function forkAt(entryId: string) {
    if (!session || running || forking) return;
    setForking(true);
    try {
      const result = await invoke<{ editorText?: string }>({
        method: 'agent.forkSession',
        params: { sessionId: session.id, entryId },
      });
      // Rewind the local thread: the Pi branch is the new source of truth, so
      // clear the timeline and reload from `session.messages` (stored rows were
      // dropped in Main — #10).
      resetSessionView();
      setScope(session.projectId ?? project?.id ?? null, session.id);
      const history = await invoke<StoredMessage[]>({
        method: 'session.messages',
        params: { sessionId: session.id },
      });
      if (useWorkspaceStore.getState().session?.id === session.id) {
        loadHistory(history);
      }
      if (result.editorText) setDraft(result.editorText);
      closeForkMenu();
      focusComposer();
    } catch (err) {
      useAgentStreamStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
      closeForkMenu();
    } finally {
      setForking(false);
    }
  }

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

  async function sendDirect(text: string, images: InputImage[] = []) {
    if (!text && !images.length) return;
    setSending(true);
    let targetSessionId: string | null = null;
    try {
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
        onTaskStarted();
      }
      targetSessionId = active.id;
      // Creating a session resets the timeline, so append only after the final
      // destination exists. Otherwise the first message is immediately erased.
      appendUserMessage(text, images);
      useAgentStreamStore.setState({ status: 'starting', error: null, errorRetryable: false });
      await invoke<RunRef>({
        method: 'agent.sendMessage',
        params: { sessionId: active.id, text, ...(images.length ? { images } : {}) },
      });
    } catch (err) {
      console.error(err);
      // A slow failure from a task we already left must not turn the new task's
      // timeline into an error state.
      if (useAgentStreamStore.getState().activeSessionId === targetSessionId) {
        useAgentStreamStore.setState({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          errorRetryable: true,
        });
      }
    } finally {
      setSending(false);
    }
  }

  // Drain queue automatically when run finishes
  useEffect(() => {
    const isFinished = status === 'completed' || status === 'idle';
    if (isFinished && queuedMessages.length > 0 && !sending && session && !approval) {
      const next = popNextQueuedMessage();
      if (next && (next.text.trim() || next.images?.length)) {
        void sendDirect(next.text.trim(), next.images);
      }
    }
    // sendDirect intentionally follows the current render; depending on its
    // function identity would retrigger this queue-draining effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, queuedMessages.length, sending, session, approval]);

  async function send() {
    if (!draft.trim() && !attachments.length) return;
    if (attachments.length && imageInputUnavailable) {
      setAttachmentError(`${activeModel?.displayName ?? 'The selected model'} cannot read images.`);
      return;
    }
    const text = draft.trim();
    const images = attachments;
    setDraft('');
    setAttachments([]);
    setAttachmentError(null);

    if (running) {
      if (queueMode === 'queue') {
        addQueuedMessage(text, 'queue', images);
        return;
      }
      // Steer mode interrupts the active turn. This used to call followUp,
      // which deliberately waits until the turn settles and therefore behaved
      // exactly like a second queue.
      appendUserMessage(text, images);
      setSending(true);
      try {
        if (session && activeRunId) {
          await invoke({
            method: 'agent.steer',
            params: { runId: activeRunId, text, ...(images.length ? { images } : {}) },
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSending(false);
      }
      return;
    }

    await sendDirect(text, images);
  }

  async function handleSendNow(item: QueuedMessage) {
    removeQueuedMessage(item.id);
    if (running && session && activeRunId) {
      appendUserMessage(item.text, item.images);
      setSending(true);
      try {
        await invoke({
          method: 'agent.steer',
          params: {
            runId: activeRunId,
            text: item.text,
            ...(item.images?.length ? { images: item.images } : {}),
          },
        });
      } catch (err) {
        console.error(err);
      } finally {
        setSending(false);
      }
    } else {
      await sendDirect(item.text, item.images);
    }
  }

  function handleEditQueued(item: QueuedMessage) {
    removeQueuedMessage(item.id);
    setDraft(item.text);
    setAttachments(item.images ?? []);
    composerRef.current?.focus();
  }

  async function retry() {
    if (!session || (!lastUserText && !lastUserImages.length) || running) return;
    setSending(true);
    useAgentStreamStore.setState({ status: 'starting', error: null, errorRetryable: false });
    try {
      await invoke<RunRef>({
        method: 'agent.sendMessage',
        params: {
          sessionId: session.id,
          text: lastUserText ?? '',
          ...(lastUserImages.length ? { images: lastUserImages } : {}),
        },
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

  async function approvePlan() {
    if (!pendingPlan || !session || running) return;
    const planText = pendingPlan.text;
    useAgentStreamStore.setState({ pendingPlan: null });
    try {
      // Approve → Build (#3): leave the read-only toolset, then inject the
      // plan as the first message of a new Build run on the same session.
      await setSessionMode.mutateAsync('build');
      await sendDirect(`I approve this plan — proceed with it now:\n\n${planText}`);
    } catch (err) {
      console.error(err);
      useAgentStreamStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function discardPlan() {
    useAgentStreamStore.setState({ pendingPlan: null });
  }

  const tone = statusTone(status);
  const runTitle = blank ? 'New task' : (session?.title ?? 'No session');
  const runMeta = blank
    ? [project?.name ?? 'no project', branch.data?.branch, 'not started yet']
        .filter(Boolean)
        .join(' · ')
    : [
        activeRunId ? `run ${activeRunId.slice(0, 8)}` : null,
        startedAt ? formatDuration(startedAt) : null,
        usage?.totalTokens != null ? `${formatTokens(usage.totalTokens)} tokens` : null,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Run header */}
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="quiet" size="icon" className="h-7 w-7" onClick={onBack} title="Back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-tight font-bold">{runTitle}</div>
          {runMeta ? (
            <div className="font-mono text-[10.5px] leading-snug text-muted">{runMeta}</div>
          ) : null}
        </div>
        {blank ? <Badge tone="neutral">not started</Badge> : null}
        {!blank && (isCompacting || compacting) ? (
          <Badge tone="accent-2" className="gap-1.5">
            <span style={dotStyle('wait', 6)} />
            Compacting
          </Badge>
        ) : null}
        {/* Auto-retry visibility (#8): the provider is retrying the same call;
            the run is alive, but a frozen Working badge made it look stuck. */}
        {!blank && retryAttempt ? (
          <Badge
            tone="warning"
            className="gap-1.5"
            title={retryAttempt.errorMessage ?? undefined}
          >
            <span
              className="size-1.5 rounded-full bg-warning"
              style={{ animation: 'pi-pulse 1.2s ease-in-out infinite' }}
            />
            Retrying {retryAttempt.attempt}/{retryAttempt.maxAttempts}
          </Badge>
        ) : null}
        {!blank && status !== 'idle' ? (
          <Badge tone={toneBadge[tone]} className="gap-1.5">
            <span style={dotStyle(tone, 6)} />
            {statusLabel(status)}
            {tokenRate ? (
              <span className="font-mono text-[10px] font-normal opacity-75">
                {formatTokens(Math.round(tokenRate.totalPerSec))} tok/s
              </span>
            ) : null}
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
          <div className="px-5 pt-5" style={{ paddingBottom: composerPad + 48 }}>
            <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-3">
              {!timeline.length && !approval ? (
                <div className="flex flex-col items-center gap-2 px-5 py-20 text-center">
                  <div className="text-sm font-bold">
                    {project ? 'Describe what it should do' : 'Choose a project to start'}
                  </div>
                  <p className="max-w-[320px] text-[12.5px] leading-relaxed text-muted">
                    {project
                      ? "Type or attach a screenshot below — @ for a file, $ for a skill, / for commands, ⌘K to search. It'll read the project, plan, then ask before running anything risky."
                      : 'Choose a project above the composer. You can start typing while it loads.'}
                  </p>
                </div>
              ) : null}

              {timeline.map((entry) =>
                entry.kind === 'message' ? (
                  entry.message.role === 'user' ? (
                    <div
                      key={`message:${entry.message.id}`}
                      className="group/message flex max-w-[78%] self-end flex-col items-end gap-1.5"
                    >
                      {entry.message.images?.length ? (
                        <MessageImages images={entry.message.images} />
                      ) : null}
                      {entry.message.content ? (
                        <div className="rounded-[22px_22px_6px_22px] bg-surface px-4 py-2.5 text-[13.5px] leading-relaxed shadow-[var(--shadow-sm)] whitespace-pre-wrap">
                          {entry.message.content}
                        </div>
                      ) : null}
                      {entry.message.content ? (
                        <MessageCopyButton content={entry.message.content} />
                      ) : null}
                    </div>
                  ) : entry.message.role === 'system' ? (
                    <div
                      key={`message:${entry.message.id}`}
                      className="self-center rounded-full bg-foreground/[0.05] px-3 py-1 text-center text-[11px] leading-snug text-muted"
                    >
                      {entry.message.content}
                    </div>
                  ) : (
                    <AssistantMessage
                      key={`message:${entry.message.id}`}
                      content={entry.message.content}
                      streaming={entry.message.streaming}
                    />
                  )
                ) : entry.kind === 'thinking' ? (
                  <ThinkingStreamRow
                    key={`thinking:${entry.thinking.id}`}
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
                    key={`tool:${entry.tool.id}`}
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

              {/* Plan Mode draft (#3): the read-only run produced a plan; offer
                  Approve → Build so the plan becomes the first message of a
                  Build run. */}
              {pendingPlan && pendingPlan.sessionId === session?.id && !blank && !running ? (
                <div className="rounded-[20px] border border-accent/30 bg-accent-100 px-4 py-4">
                  <div className="flex items-center gap-2.5">
                    <ListOrdered className="h-4 w-4 flex-none text-accent-800" />
                    <div className="flex-1 text-sm font-bold text-accent-900">
                      Plan ready
                    </div>
                    <Badge tone="outline" className="text-[10.5px]">
                      Plan Mode
                    </Badge>
                  </div>
                  <p className="mt-1.5 pl-[26px] text-[12.5px] leading-normal text-accent-900/80">
                    The run stayed read-only. Approving switches to Build and sends the
                    plan as the first instruction — nothing else has been written.
                  </p>
                  <pre className="output-pre mt-2 ml-[26px] max-h-56 overflow-y-auto rounded-[14px] px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap">
                    {pendingPlan.text}
                  </pre>
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-[26px]">
                    <Button size="sm" onClick={() => void approvePlan()}>
                      <Check className="h-3.5 w-3.5" />
                      Approve &amp; start Build
                    </Button>
                    <Button size="sm" variant="ghost" onClick={discardPlan}>
                      <X className="h-3.5 w-3.5" />
                      Discard
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Error */}
              {error ? (
                <div className="flex items-center justify-between gap-3 rounded-[18px] border border-danger/30 bg-danger/10 px-4 py-2.5 text-[12.5px] text-danger">
                  <span className="min-w-0 flex-1">{error}</span>
                  {errorRetryable && (lastUserText || lastUserImages.length) ? (
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

              {/* Keep the final message clear of the composer without leaving an oversized void. */}
              <div
                style={{ height: Math.max(composerPad + 40, 160) }}
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
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                        {hit.path}
                      </span>
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
            {/* `/` commands (#6): compact, plan/build, auto model, clear queue, new task. */}
            {slashMenuOpen ? (
              <div className="mb-1.5 overflow-hidden rounded-[18px] border border-border bg-background shadow-[var(--shadow-md)]">
                {slashMatches.slice(0, 6).map((command) => (
                  <button
                    key={command.keyword}
                    type="button"
                    disabled={command.disabled}
                    onClick={() => runSlash(command)}
                    title={command.disabled ? 'Not available right now' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 border-0 bg-transparent px-3.5 py-2 text-left',
                      command.disabled
                        ? 'cursor-not-allowed opacity-45'
                        : 'cursor-pointer hover:bg-foreground/[0.06]',
                    )}
                  >
                    <span className="rounded-full bg-accent-100 px-2 py-0.5 font-mono text-[11.5px] text-accent-800">
                      /{command.keyword}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{command.title}</span>
                    <span className="max-w-[180px] truncate text-[10.5px] text-muted">
                      {command.description}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {queuedMessages.length > 0 ? (
              <QueuePanel
                queuedMessages={queuedMessages}
                onRemove={removeQueuedMessage}
                onEdit={handleEditQueued}
                onSendNow={(item) => void handleSendNow(item)}
                onClear={clearQueue}
              />
            ) : null}
            {blank ? (
              <div className="mb-1.5 flex h-7 items-center gap-1 px-1.5 text-muted">
                <FolderOpen className="h-3 w-3 flex-none opacity-60" />
                <SearchableSelect
                  options={projectOptions}
                  value={project?.id ?? ''}
                  onChange={(value) => void selectProject(value)}
                  placeholder={recentProjects.isLoading ? 'Loading projects…' : 'Choose a project'}
                  searchPlaceholder="Search projects…"
                  emptyText="No matching projects."
                  disabled={projectSwitching}
                  className="h-6 w-auto min-w-0 max-w-[300px] border-0 bg-transparent px-1.5 py-0 text-[11.5px] shadow-none hover:bg-foreground/[0.035] [&>span]:text-foreground/60 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-60"
                />
                {projectSwitching ? (
                  <span className="flex-none text-[10.5px] text-muted/70">Opening…</span>
                ) : null}
              </div>
            ) : null}
            {/* Session Fork (#10) lives in the toolbar above the composer, not on
                every bubble: a compact trigger keeps the transcript uncluttered. */}
            {!blank && session ? (
              <div ref={forkRootRef} className="mb-1.5 flex h-7 items-center gap-1 px-1.5 text-muted">
                <button
                  type="button"
                  onClick={() => {
                    if (running) return;
                    setForkArm(null);
                    setForkMenuOpen((open) => !open);
                  }}
                  title={
                    running
                      ? 'Wait for the current run to finish before forking'
                      : 'Fork this task at an earlier message — later messages are discarded'
                  }
                  className={cn(
                    'inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-foreground/[0.04] px-2.5 text-[11px] hover:bg-foreground/[0.09]',
                    running && 'cursor-not-allowed opacity-45',
                    forkMenuOpen && 'bg-foreground/[0.09]',
                  )}
                >
                  <GitBranch className="h-3 w-3 flex-none" />
                  Fork
                </button>
                {forking ? (
                  <span className="flex-none text-[10.5px] text-muted/70">Forking…</span>
                ) : null}
                {forkPoints.data && forkPoints.data.points.length ? (
                  <span className="hidden flex-none text-[10.5px] text-muted/60 sm:inline">
                    {forkPoints.data.points.length} forkable message
                    {forkPoints.data.points.length === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
            ) : null}
            {forkMenuOpen && forkAnchor && !running
              ? createPortal(
                  <div
                    ref={forkMenuRef}
                    style={forkAnchor}
                    className="z-50 flex w-[360px] flex-col overflow-hidden rounded-[16px] border border-border bg-background shadow-[var(--shadow-lg)]"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
                      <span className="text-[12.5px] font-bold">Fork at a message</span>
                      <span className="text-[10.5px] text-muted">
                        rewinds the task; later messages are discarded
                      </span>
                    </div>
                    {forkPoints.isLoading ? (
                      <p className="px-3.5 py-4 text-center text-[12px] text-muted">
                        Loading fork points…
                      </p>
                    ) : (forkPoints.data?.points ?? []).length ? (
                      <div className="max-h-[240px] min-h-0 flex-1 overflow-y-auto py-1">
                        {(forkPoints.data?.points ?? []).map((point) => {
                          const armed = forkArm?.entryId === point.entryId;
                          return (
                            <button
                              key={point.entryId}
                              type="button"
                              onClick={() =>
                                setForkArm(armed ? null : { entryId: point.entryId, text: point.text })
                              }
                              className={cn(
                                'flex w-full items-center gap-2.5 border-0 bg-transparent px-3.5 py-2 text-left',
                                armed
                                  ? 'bg-accent-soft'
                                  : 'hover:bg-foreground/[0.06]',
                              )}
                            >
                              <GitBranch
                                className={cn(
                                  'h-3.5 w-3.5 flex-none',
                                  armed ? 'text-accent-700' : 'text-muted',
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate text-[12px]">
                                {point.text}
                              </span>
                              <span className="flex-none text-[10.5px] text-muted">
                                {armed ? 'selected' : ''}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="px-3.5 py-4 text-center text-[12px] text-muted">
                        No messages to fork yet.
                      </p>
                    )}
                    {forkArm ? (
                      <div className="flex items-center gap-2 border-t border-border px-3.5 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">
                          Fork at “{forkArm.text.slice(0, 48)}
                          {forkArm.text.length > 48 ? '…' : ''}”?
                        </span>
                        <Button
                          size="sm"
                          className="flex-none"
                          onClick={() => void forkAt(forkArm.entryId)}
                        >
                          <GitBranch className="h-3 w-3" />
                          Fork
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-none"
                          onClick={() => setForkArm(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>,
                  document.body,
                )
              : null}
            {projectSwitchError ? (
              <div className="mb-2 px-2 text-[11px] text-danger">{projectSwitchError}</div>
            ) : null}
            <div
              className={cn(
                'density-composer overflow-hidden rounded-[26px] border bg-surface shadow-[var(--shadow-sm)]',
                draggingImages ? 'border-accent bg-accent/5' : 'border-border',
              )}
              onDragEnter={(event) => {
                if (
                  !Array.from(event.dataTransfer.items).some((item) =>
                    item.type.startsWith('image/'),
                  )
                )
                  return;
                event.preventDefault();
                dragDepthRef.current += 1;
                setDraggingImages(true);
              }}
              onDragOver={(event) => {
                if (
                  Array.from(event.dataTransfer.items).some((item) =>
                    item.type.startsWith('image/'),
                  )
                ) {
                  event.preventDefault();
                }
              }}
              onDragLeave={() => {
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDraggingImages(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepthRef.current = 0;
                setDraggingImages(false);
                void addImageFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="sr-only"
                onChange={(event) => {
                  void addImageFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              {attachments.length ? (
                <div className="flex flex-wrap gap-2 px-3.5 pt-3">
                  {attachments.map((image, index) => (
                    <div key={`${image.name}-${index}`} className="group/attachment relative">
                      <img
                        src={`data:${image.mimeType};base64,${image.data}`}
                        alt={image.name}
                        className="size-16 rounded-xl border border-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${image.name}`}
                        title={`Remove ${image.name}`}
                        onClick={() => removeAttachment(index)}
                        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted shadow-sm hover:text-danger"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {attachmentError ? (
                <p className="px-4 pt-2 text-[11.5px] text-danger" role="alert">
                  {attachmentError}
                </p>
              ) : null}
              <textarea
                ref={composerRef}
                rows={1}
                className="max-h-[240px] min-h-[52px] w-full resize-none overflow-y-hidden bg-transparent px-4 py-3 text-[13.5px] leading-normal outline-none placeholder:text-muted"
                placeholder={
                  !project
                    ? 'Choose a project above — you can start typing now…'
                    : running
                      ? queueMode === 'queue'
                        ? 'Type a message to queue… (⏎ to Queue)'
                        : 'Type to interject mid-run… (⏎ to Steer)'
                      : 'Describe the change you want — @ for a file, $ for a skill'
                }
                // The model can begin streaming before the initial send IPC
                // finishes its checkpoint bookkeeping. Once a run is visible,
                // keep the composer enabled so the user can queue immediately.
                disabled={sending && !running}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.items)
                    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);
                  if (files.length) void addImageFiles(files);
                }}
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
                  // rather than sending a half-typed `$re`, `@src/` or `/pla`.
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
                  if (slashMenuOpen) {
                    const first = slashMatches.find((command) => !command.disabled);
                    if (first) runSlash(first);
                    return;
                  }
                  void send();
                }}
              />

              <div className="flex items-center gap-2 px-3 pb-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-[30px] flex-none text-muted"
                  aria-label="Attach images"
                  title={
                    imageInputUnavailable
                      ? `${activeModel?.displayName ?? 'Selected model'} cannot read images`
                      : 'Attach images (PNG, JPEG, WebP, or GIF)'
                  }
                  disabled={
                    !project || imageInputUnavailable || attachments.length >= MAX_IMAGE_COUNT
                  }
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImagePlus className="size-4" />
                </Button>
                <ApprovalModePicker
                  mode={approvalMode.data?.mode ?? 'auto-reads'}
                  onChange={(mode) => setApprovalMode.mutate(mode)}
                />
                <SessionModePicker
                  mode={sessionMode.data?.mode ?? 'build'}
                  onChange={(mode) => setSessionMode.mutate(mode)}
                  disabled={running || sending || setSessionMode.isPending}
                />
                <ThinkingLevelPicker disabled={!project || sending} />
                {branch.data?.branch ? (
                  <ContextPill icon={<GitBranch className="h-3 w-3" />}>
                    {branch.data.branch}
                  </ContextPill>
                ) : null}
                <span className="min-w-0 flex-1" />
                {running ? (
                  <Segmented
                    aria-label="Queue mode"
                    size="sm"
                    options={[
                      { value: 'queue', label: 'Queue' },
                      { value: 'steer', label: 'Steer' },
                    ]}
                    value={queueMode}
                    onChange={(val) => setQueueMode(val as 'queue' | 'steer')}
                  />
                ) : null}
                <ContextUsageRing
                  used={usage?.contextTokens}
                  capacity={contextWindow}
                  compacting={isCompacting || compacting}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-[30px] px-2 text-[11px] text-muted"
                  disabled={!session || running || isCompacting || compacting}
                  title="Compact conversation context to free window space"
                  onClick={() => void compactSession()}
                >
                  Compact
                </Button>
                {/* Model choice belongs with the send button: it is a property of the
                    message you are about to send, not of the window. */}
                <ModelPicker />
                <span className="flex-none font-mono text-[11px] text-muted">↵</span>
                <Button
                  size={running && queueMode === 'queue' ? 'sm' : 'icon'}
                  className={cn(
                    running && queueMode === 'queue'
                      ? 'h-[30px] px-3 gap-1.5 font-semibold text-[12px] bg-accent text-accent-foreground hover:bg-accent/90'
                      : 'h-[30px] w-[30px] flex-none',
                  )}
                  disabled={
                    !project ||
                    (!draft.trim() && !attachments.length) ||
                    (imageInputUnavailable && attachments.length > 0) ||
                    (sending && !running)
                  }
                  onClick={() => void send()}
                  title={
                    running
                      ? queueMode === 'queue'
                        ? 'Queue message for when agent finishes (⏎)'
                        : 'Interject mid-run immediately (⏎)'
                      : 'Send (⏎ — use ⇧⏎ for a new line)'
                  }
                >
                  {running ? (
                    queueMode === 'queue' ? (
                      <>
                        <ListPlus className="h-3.5 w-3.5" />
                        <span>Queue</span>
                      </>
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageImages({
  images,
}: {
  images: Array<{ name: string; mimeType: string; size: number; data?: string }>;
}) {
  return (
    <div className={cn('grid max-w-[360px] gap-1.5', images.length > 1 && 'grid-cols-2')}>
      {images.map((image, index) =>
        image.data ? (
          <img
            key={`${image.name}-${index}`}
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={image.name}
            className="max-h-64 min-h-20 w-full rounded-[18px] border border-border object-cover shadow-sm"
          />
        ) : (
          <div
            key={`${image.name}-${index}`}
            className="flex min-w-40 items-center gap-2 rounded-[16px] border border-border bg-surface px-3 py-2 text-left"
          >
            <ImagePlus className="size-4 flex-none text-muted" />
            <span className="min-w-0 truncate text-[12px]">{image.name}</span>
          </div>
        ),
      )}
    </div>
  );
}

function QueuePanel({
  queuedMessages,
  onRemove,
  onEdit,
  onSendNow,
  onClear,
}: {
  queuedMessages: QueuedMessage[];
  onRemove: (id: string) => void;
  onEdit: (item: QueuedMessage) => void;
  onSendNow: (item: QueuedMessage) => void;
  onClear: () => void;
}) {
  if (!queuedMessages.length) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-[20px] border border-border bg-surface shadow-[var(--shadow-md)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-3.5 w-3.5 text-accent" />
          <span className="text-[12.5px] font-bold text-foreground">
            Message Queue ({queuedMessages.length})
          </span>
          <span className="text-[11px] text-muted">
            Will run automatically after current turn finishes
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-6 px-2 text-[11px] text-muted hover:text-foreground"
        >
          Clear queue
        </Button>
      </div>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto p-2">
        {queuedMessages.map((item, idx) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 rounded-xl bg-background/80 px-3 py-1.5 transition-colors hover:bg-background"
          >
            <span className="font-mono text-[10.5px] font-bold text-muted">#{idx + 1}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold',
                item.mode === 'steer'
                  ? 'bg-warning/15 text-warning-700'
                  : 'bg-accent/15 text-accent-700',
              )}
            >
              {item.mode === 'steer' ? 'Steer' : 'Queued'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
              {item.text ||
                `${item.images?.length ?? 0} attached image${item.images?.length === 1 ? '' : 's'}`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-accent hover:bg-accent/10"
                title="Send now"
                aria-label="Send queued message now"
                onClick={() => onSendNow(item)}
              >
                <Zap className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted hover:text-foreground"
                title="Edit in composer"
                aria-label="Edit queued message in composer"
                onClick={() => onEdit(item)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted hover:text-danger"
                title="Remove from queue"
                aria-label="Remove queued message"
                onClick={() => onRemove(item.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[chat] copy failed', error);
    }
  }

  return (
    <button
      type="button"
      className="message-copy-button"
      onClick={() => void copyMessage()}
      title={copied ? 'Copied' : 'Copy message'}
      aria-label={copied ? 'Message copied' : 'Copy message'}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function AssistantMessage({ content, streaming }: { content: string; streaming: boolean }) {
  const renderedRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'markdown' | 'formatted' | null>(null);

  function showCopied(format: 'markdown' | 'formatted') {
    setCopied(format);
    window.setTimeout(() => setCopied((current) => (current === format ? null : current)), 1600);
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(content);
      showCopied('markdown');
    } catch (error) {
      console.error('[chat] copy markdown failed', error);
    }
  }

  async function copyFormatted() {
    const rendered = renderedRef.current;
    if (!rendered) return;

    const copy = rendered.cloneNode(true) as HTMLDivElement;
    copy
      .querySelectorAll('button, [data-streamdown="code-block-actions"]')
      .forEach((control) => control.remove());
    const html = copy.innerHTML;
    const plainText = rendered.innerText;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      showCopied('formatted');
    } catch (error) {
      console.error('[chat] copy formatted output failed', error);
    }
  }

  return (
    <div className="group/assistant flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-x-hidden py-1">
      <div ref={renderedRef} className="min-w-0 max-w-full">
        <Markdown streaming={streaming}>{content}</Markdown>
      </div>
      {!streaming && content ? (
        <div className="assistant-message-actions" aria-label="Copy response">
          <button
            type="button"
            className="message-icon-button"
            onClick={() => void copyMarkdown()}
            title={copied === 'markdown' ? 'Markdown copied' : 'Copy original Markdown'}
            aria-label={copied === 'markdown' ? 'Markdown copied' : 'Copy original Markdown'}
          >
            {copied === 'markdown' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <FileCode2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="message-icon-button"
            onClick={() => void copyFormatted()}
            title={copied === 'formatted' ? 'Formatted response copied' : 'Copy formatted response'}
            aria-label={
              copied === 'formatted' ? 'Formatted response copied' : 'Copy formatted response'
            }
          >
            {copied === 'formatted' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      ) : null}
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
  const isBash =
    tool.toolName.toLowerCase() === 'bash' ||
    tool.toolName.toLowerCase() === 'exec' ||
    tool.toolName.toLowerCase() === 'terminal';

  const icon = toolIcons[tool.toolName.toLowerCase()] ?? <Wrench className="h-3 w-3" />;
  const canExpand = Boolean(tool.inputSummary || tool.outputSummary || runningNow);

  const rawSummary = tool.inputSummary.replace(new RegExp(`^${tool.toolName}:\\s*`, 'i'), '');
  let bashCommand = rawSummary;
  if (isBash) {
    try {
      const parsed = JSON.parse(rawSummary);
      if (parsed && typeof parsed === 'object' && typeof parsed.command === 'string') {
        bashCommand = parsed.command;
      }
    } catch {
      // Keep raw string if not JSON
    }
  }

  return (
    <div className="my-0.5 flex w-full min-w-0 max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-0.5 py-1 text-left transition-colors',
          canExpand ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent/10 text-accent-700',
            ok && 'bg-accent-2/10 text-accent-2',
            failed && 'bg-danger/10 text-danger',
            runningNow && 'animate-[pi-think-pulse_1.8s_ease-in-out_infinite]',
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            'flex-none text-[12px] font-semibold tracking-[0.01em] text-muted',
            runningNow && 'think-label-shimmer',
          )}
        >
          {tool.toolName}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-snug text-muted">
          {isBash ? `$ ${bashCommand}` : rawSummary || tool.inputSummary}
        </span>
        {canExpand ? (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 flex-none text-muted transition-transform',
              expanded && 'rotate-180',
            )}
          />
        ) : null}
      </button>

      {expanded ? (
        <div className="max-h-72 overflow-y-auto py-1 pl-7 font-mono text-[11.5px] leading-relaxed">
          {isBash ? (
            <>
              <div className="flex items-start gap-2 font-semibold text-foreground/80">
                <span className="select-none text-accent-700">$</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{bashCommand}</span>
              </div>
              {tool.outputSummary ? (
                <pre className="output-pre mt-2 w-full max-w-full overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted">
                  {tool.outputSummary}
                </pre>
              ) : runningNow ? (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                  <span
                    className="size-1.5 rounded-full bg-accent"
                    style={{ animation: 'pi-pulse 1.2s ease-in-out infinite' }}
                  />
                  <span>Executing command…</span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {tool.inputSummary ? (
                <pre className="output-pre w-full max-w-full whitespace-pre-wrap font-mono text-[11.5px] text-muted">
                  {tool.inputSummary}
                </pre>
              ) : null}
              {tool.outputSummary ? (
                <pre className="output-pre w-full max-w-full whitespace-pre-wrap font-mono text-[11.5px] text-muted">
                  {tool.outputSummary}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ContextUsageRing({
  used,
  capacity,
  compacting = false,
}: {
  used?: number;
  capacity?: number;
  compacting?: boolean;
}) {
  // Providers report usage only after a model call finishes. Before the first
  // response there is still useful information: the whole context window is
  // available, so show 100% remaining instead of an unexplained dash.
  const remaining = capacity ? Math.max(0, capacity - (used ?? 0)) : 0;
  const remainingRatio = capacity ? Math.min(1, Math.max(0, remaining / capacity)) : 0;
  const remainingPercent = Math.round(remainingRatio * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const label = compacting
    ? 'Compacting conversation context…'
    : !capacity
      ? 'Context capacity is loading'
      : used == null
        ? `${formatTokens(capacity)} context available · 100% remaining`
        : `${formatTokens(remaining)} context remaining of ${formatTokens(capacity)} · ${remainingPercent}%`;

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'relative flex h-[30px] w-[30px] flex-none items-center justify-center text-[8px] font-semibold tabular-nums text-muted',
        compacting && 'animate-pulse text-warning',
      )}
    >
      <svg
        className="absolute inset-0 h-full w-full -rotate-90"
        viewBox="0 0 28 28"
        aria-hidden="true"
      >
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-foreground/10"
        />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remainingRatio)}
          className={cn(
            'text-accent transition-[stroke-dashoffset] duration-300',
            remainingPercent <= 10 && 'text-danger',
            remainingPercent > 10 && remainingPercent <= 25 && 'text-warning',
            compacting && 'text-warning',
          )}
        />
      </svg>
      <span>{compacting ? '…' : capacity ? remainingPercent : '—'}</span>
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
