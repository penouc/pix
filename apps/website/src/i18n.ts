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
