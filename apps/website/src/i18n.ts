export type Locale = 'zh' | 'en';

type Messages = Record<string, string>;

const en: Messages = {
  'meta.description':
    'PiX is a local desktop coding agent built on the open-source Pi Agent SDK. Fork it and shape your own agent.',
  'meta.title': 'PiX — Built on Pi Agent',
  'a11y.skip': 'Skip to content',
  'a11y.home': 'PiX home',
  'a11y.nav': 'Primary',
  'a11y.lang': 'Language',
  'nav.pi': 'Pi Agent',
  'nav.own': 'Your agent',
  'nav.how': 'How it works',
  'nav.features': 'Features',
  'nav.download': 'Download',
  'hero.title': 'A desktop shell on Pi Agent — fork it into yours',
  'hero.lede':
    'PiX is a local coding workbench built on the open-source Pi Agent SDK. Use it as-is, or take the codebase and shape your own agent product.',
  'hero.ctaPrimary': 'View on GitHub',
  'hero.ctaSecondary': 'About Pi Agent',
  'hero.mascotAlt': 'PiX mascot',
  'download.title': 'Download PiX for macOS',
  'download.lede': 'Apple Silicon build. Grab the latest release from GitHub.',
  'download.cta': 'Download for macOS · Apple Silicon',
  'download.note': 'Not notarized yet — on first open, right-click the app and choose Open, or allow it in System Settings → Privacy & Security.',
  'download.latestPrefix': 'Latest release',
  'features.title': 'Core capabilities',
  'features.lede':
    'Real coding work stays visible, controllable, reviewable, and restorable — all on your machine.',
  'features.f1.title': 'Local project workbench',
  'features.f1.body':
    'Open a Git project, confirm Workspace Trust, manage projects and task history; files and commands run locally by default.',
  'features.f2.title': 'Real agent runtime',
  'features.f2.body':
    'Built on the Pi Agent SDK — provider login, model switching, thinking levels, streaming replies, tool calls, stop, and follow-up.',
  'features.f3.title': 'Rich context input',
  'features.f3.body':
    'Reference project files with @, attach images, and pick standard /skill:name skills with $.',
  'features.f4.title': 'Permissions & audit',
  'features.f4.body':
    'The main process classifies tool risk; Ask, auto-reads, and read-only modes, with approvals and auto-decisions logged.',
  'features.f5.title': 'Diff & precise restore',
  'features.f5.body':
    'Multi-file diffs, pre-task snapshots, pre-write backups, concurrent-edit detection, and safe per-file or whole-round revert.',
  'features.f6.title': 'Automations',
  'features.f6.body':
    'Save prompts and trigger them manually, on an interval, daily, or when a task finishes; each automation has its own approval mode.',
  'features.f7.title': 'Skills',
  'features.f7.body':
    'Discover Pi-standard global and project skills with search, scope filters, composer invocation, and installable examples.',
  'features.f8.title': 'Local terminal & search',
  'features.f8.body':
    'Workspace-scoped terminal, project file tree, cross-project search, session search, and diagnostics export.',
  'preview.title': 'Interface preview',
  'preview.lede':
    'A quick look at the workbench, an agent run, and the local usage dashboard.',
  'preview.w1':
    'Local projects, task history, permission modes, model selection, and context input in one workbench.',
  'preview.w2':
    'Agent run with tool calls, reasoning, completion summary, and the Changes review panel.',
  'preview.w3':
    'Local Usage & Cost: run counts, tokens, spend trends, and model breakdown.',
  'pi.title': 'Built on Pi Agent',
  'pi.lede':
    'The agent runtime comes from Pi — multi-provider models, tools, and the coding loop — so PiX can focus on the desktop workbench around it.',
  'pi.p1.title': 'Pi Agent SDK',
  'pi.p1.body':
    'Powered by the open-source Pi coding agent. Providers, models, and tool calls ride on Pi instead of a closed proprietary runtime.',
  'pi.p2.title': 'Desktop workbench',
  'pi.p2.body':
    'Chat, approvals, multi-file diffs, checkpoints, and local Git — the UI and process boundaries live in PiX.',
  'pi.p3.title': 'Local by default',
  'pi.p3.body':
    'Open a Git project on your machine. Files, shell, and review stay with you.',
  'own.title': 'Make it your own agent',
  'own.lede':
    'PiX is a starting point, not a black box. Fork the repo, swap the branding, tune the workbench, and ship an agent that fits your product.',
  'own.s1.title': 'Fork the shell',
  'own.s1.body':
    'Electron + React desktop app with typed IPC — keep what you need, cut what you don’t.',
  'own.s2.title': 'Keep Pi as the engine',
  'own.s2.body':
    'The AgentRuntime adapter wraps Pi. You stay on the Pi ecosystem while owning the product surface.',
  'own.s3.title': 'Ship your agent',
  'own.s3.body':
    'Rename, rebrand, add your workflows — turn PiX into the agent experience you want to offer.',
  'how.title': 'The coding loop',
  'how.lede':
    'Understand the task → edit code → verify → review the diff → keep or revert.',
  'how.s1.title': 'Open a local project',
  'how.s1.body': 'Pick a Git repo on your machine and start a task.',
  'how.s2.title': 'Let the agent work',
  'how.s2.body':
    'Watch reads, edits, and commands stream in — transparent, not a black box.',
  'how.s3.title': 'Review, then decide',
  'how.s3.body':
    'Inspect the multi-file diff. Keep the result or revert the whole round safely.',
  'close.title': 'Start from the source',
  'close.body':
    'Clone PiX, explore the Pi integration, and build the agent you want on top.',
  'close.cta': 'Open the repo',
  'contact.title': 'Connect',
  'footer.line': '· Local desktop coding agent, built on',
};

const zh: Messages = {
  'meta.description':
    'PiX 是基于开源 Pi Agent SDK 的本地桌面编程助手。可直接使用，也可在此基础上改成你自己的 Agent。',
  'meta.title': 'PiX — 基于 Pi Agent',
  'a11y.skip': '跳到主要内容',
  'a11y.home': 'PiX 首页',
  'a11y.nav': '主导航',
  'a11y.lang': '语言',
  'nav.pi': 'Pi Agent',
  'nav.own': '做成自己的',
  'nav.how': '怎么用',
  'nav.features': '核心能力',
  'nav.download': '下载',
  'hero.title': '基于 Pi Agent 的桌面壳，也能改成你自己的 Agent',
  'hero.lede':
    'PiX 是建立在开源 Pi Agent SDK 上的本地编程工作台。可以直接用，也可以拿这份代码，改成面向你自己产品的 Agent。',
  'hero.ctaPrimary': '在 GitHub 查看',
  'hero.ctaSecondary': '了解 Pi Agent',
  'hero.mascotAlt': 'PiX 吉祥物',
  'download.title': '下载 PiX for macOS',
  'download.lede': 'Apple Silicon 版本。从 GitHub Releases 获取最新构建。',
  'download.cta': '下载 macOS 版 · Apple Silicon',
  'download.note': '暂未签名公证:首次打开请右键应用并选择“打开”,或在“系统设置 → 隐私与安全性”中允许。',
  'download.latestPrefix': '最新版本',
  'features.title': '核心能力',
  'features.lede':
    '让真实的编码任务保持可见、可控、可审查、可恢复——不需要离开你的电脑。',
  'features.f1.title': '本地项目工作台',
  'features.f1.body':
    '打开 Git 项目、确认 Workspace Trust、管理项目与历史任务；文件和命令默认在本机执行。',
  'features.f2.title': '真实 Agent 运行',
  'features.f2.body':
    '基于 Pi Agent SDK，支持 Provider 登录、模型切换、Thinking Level、流式回复、工具调用、停止和 Follow-up。',
  'features.f3.title': '上下文输入',
  'features.f3.body':
    '使用 @ 引用项目文件、附加图片，使用 $ 快速选择标准 /skill:name Skill。',
  'features.f4.title': '权限与审计',
  'features.f4.body':
    'Main Process 统一判断工具风险；支持 Ask、Auto reads、Read-only，并记录审批与自动决策。',
  'features.f5.title': 'Diff 与精确恢复',
  'features.f5.body':
    '多文件 Diff、任务前快照、写入前内容备份、并发修改检测，以及按文件或整轮安全回退。',
  'features.f6.title': 'Automations',
  'features.f6.body':
    '保存 Prompt，通过手动、间隔、每日或任务完成事件触发；每个 Automation 都有独立审批模式。',
  'features.f7.title': 'Skills',
  'features.f7.body':
    '发现 Pi 标准的全局与项目 Skill，支持搜索、作用域筛选、Composer 调用和可安装示例。',
  'features.f8.title': '本地终端与搜索',
  'features.f8.body':
    '工作区受限终端、项目文件树、跨项目搜索、Session 搜索和诊断导出。',
  'preview.title': '界面预览',
  'preview.lede': '快速看一下工作台、Agent 执行过程与本地用量面板。',
  'preview.w1':
    '本地项目、任务历史、权限模式、模型选择与上下文输入集中在一个工作台中。',
  'preview.w2':
    'Agent 执行过程、工具调用、完成总结与 Changes 审查面板。',
  'preview.w3':
    '本地 Usage & Cost：运行次数、Token、费用趋势与模型分布。',
  'pi.title': '基于 Pi Agent 实现',
  'pi.lede':
    'Agent 运行时来自 Pi——多 Provider、多模型、工具调用与编程循环都由它承担，PiX 专注桌面工作台这一层。',
  'pi.p1.title': 'Pi Agent SDK',
  'pi.p1.body':
    '底层是开源的 Pi coding agent。Provider、模型与工具调用走 Pi，而不是封闭的私有运行时。',
  'pi.p2.title': '桌面工作台',
  'pi.p2.body':
    '对话、授权、多文件 Diff、检查点与本地 Git——界面与进程边界由 PiX 负责。',
  'pi.p3.title': '默认本地',
  'pi.p3.body': '打开本机 Git 项目。文件、Shell 与审阅都留在你这边。',
  'own.title': '在此基础上做成自己的 Agent',
  'own.lede':
    'PiX 是起点，不是黑盒。Fork 仓库、换品牌、调工作台，做出适合你产品的 Agent 体验。',
  'own.s1.title': 'Fork 这层壳',
  'own.s1.body':
    'Electron + React 桌面应用，带类型化 IPC——留下你要的，去掉你不需要的。',
  'own.s2.title': '继续用 Pi 当引擎',
  'own.s2.body':
    'AgentRuntime 适配层包装 Pi。你留在 Pi 生态里，同时拥有自己的产品界面。',
  'own.s3.title': '发出去你的 Agent',
  'own.s3.body':
    '改名、换皮、加上你的工作流——把 PiX 变成你想交付的 Agent 产品。',
  'how.title': '编程循环',
  'how.lede': '理解任务 → 改代码 → 跑验证 → 审 Diff → 保留或还原。',
  'how.s1.title': '打开本地项目',
  'how.s1.body': '选中本机 Git 仓库，新建任务。',
  'how.s2.title': '交给 Agent',
  'how.s2.body': '看着它读文件、改代码、跑命令——过程可见，不是黑盒。',
  'how.s3.title': '审 Diff，再决定',
  'how.s3.body': '多文件 Diff 一次看清。满意就留，不行就整轮安全回退。',
  'close.title': '从源码开始',
  'close.body': '克隆 PiX，看看和 Pi 的集成，在此基础上做出你想要的 Agent。',
  'close.cta': '打开仓库',
  'contact.title': '联系',
  'footer.line': '· 本地桌面编程助手，基于',
};

const catalogs: Record<Locale, Messages> = { en, zh };

/** Translate a key for the current (or given) locale. */
export function translate(key: string, locale: Locale = getLocale()): string {
  return catalogs[locale][key] ?? key;
}

const STORAGE_KEY = 'pix-locale';

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'zh' || value === 'en';
}

/** Prefer Chinese when the browser language is zh*; otherwise English. */
export function detectLocale(): Locale {
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);

  for (const tag of candidates) {
    if (tag.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

/** Saved preference wins; otherwise fall back to browser language. */
export function resolveLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // ignore private-mode / blocked storage
  }
  return detectLocale();
}

export function getLocale(): Locale {
  const lang = document.documentElement.lang;
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function syncLangSwitch(locale: Locale): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-locale]')) {
    const active = btn.dataset.locale === locale;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.classList.toggle('is-active', active);
  }
}

export function applyLocale(locale: Locale): void {
  const messages = catalogs[locale];
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = messages['meta.title'] ?? 'PiX';

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (!key || !(key in messages)) continue;
    el.textContent = messages[key];
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const key = el.dataset.i18nAria;
    if (!key || !(key in messages)) continue;
    el.setAttribute('aria-label', messages[key]);
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-alt]')) {
    const key = el.dataset.i18nAlt;
    if (!key || !(key in messages)) continue;
    el.setAttribute('alt', messages[key]);
  }

  for (const el of document.querySelectorAll<HTMLMetaElement>('[data-i18n-content]')) {
    const key = el.dataset.i18nContent;
    if (!key || !(key in messages)) continue;
    el.setAttribute('content', messages[key]);
  }

  const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (desc && messages['meta.description']) {
    desc.setAttribute('content', messages['meta.description']);
  }

  syncLangSwitch(locale);
  document.documentElement.dataset.ready = '1';
}

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore private-mode / blocked storage
  }
  applyLocale(locale);
}
