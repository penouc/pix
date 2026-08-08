import { applyLocale, resolveLocale, setLocale, translate, type Locale } from './i18n';

/** GitHub repo that hosts the PiX releases. */
const REPO = 'penouc/pix';
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

/** Latest release resolved from the GitHub API, or null when unavailable. */
let latest: ReleaseAssets | null = null;

applyLocale(resolveLocale());

const year = document.getElementById('year');
if (year) {
  year.textContent = String(new Date().getFullYear());
}

document.querySelector('.lang-switch')?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>('button[data-locale]');
  const next = button?.dataset.locale;
  if (next !== 'zh' && next !== 'en') return;
  setLocale(next as Locale);
  refreshDownloadUi();
});

interface ReleaseAssets {
  version: string;
  macos?: string;
  windows?: string;
}

/** Coarse OS detection: only macOS vs Windows matters for downloads. */
type DownloadPlatform = 'macos' | 'windows' | 'other';
function detectDownloadPlatform(): DownloadPlatform {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  return 'other';
}

/** Resolve the latest release's per-platform assets from the GitHub API. */
async function fetchLatestAssets(): Promise<ReleaseAssets | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const release = (await res.json()) as GitHubRelease;
    const assets: ReleaseAssets = { version: release.tag_name.replace(/^v/, '') };
    for (const asset of release.assets ?? []) {
      if (!assets.macos && asset.name.endsWith('.dmg') && !asset.name.includes('blockmap')) {
        assets.macos = asset.browser_download_url;
      } else if (!assets.windows && asset.name.endsWith('-setup.exe')) {
        assets.windows = asset.browser_download_url;
      }
    }
    if (!assets.macos && !assets.windows) return null;
    return assets;
  } catch {
    return null;
  }
}

/**
 * Point every `[data-download]` button at the latest asset for its OS and
 * surface the resolved version. When the API is unreachable, keep the
 * releases/latest page as a fallback so the buttons always work.
 */
function syncDownloadButtons(platform: DownloadPlatform): void {
  for (const btn of document.querySelectorAll<HTMLAnchorElement>('[data-download]')) {
    const os = (btn.dataset.os ?? (platform === 'windows' ? 'windows' : 'macos')) as
      'macos' | 'windows';
    btn.href = latest?.[os] ?? LATEST_PAGE;
  }

  const version = latest?.version;

  for (const chip of document.querySelectorAll<HTMLElement>('[data-download-version]')) {
    if (version) {
      chip.textContent = `v${version}`;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  const isWindows = platform === 'windows';
  const line = document.querySelector<HTMLElement>('[data-download-latest]');
  if (line) {
    if (version) {
      line.textContent =
        `${translate('download.latestPrefix')} v${version} · ` +
        translate(isWindows ? 'download.badgeWindows' : 'download.badgeMac');
      line.hidden = false;
    } else {
      line.hidden = true;
    }
  }

  const note = document.querySelector<HTMLElement>('[data-download-note]');
  if (note) {
    note.textContent = translate(isWindows ? 'download.noteWindows' : 'download.noteMac');
    note.hidden = false;
  }
}

function refreshDownloadUi(): void {
  syncDownloadButtons(detectDownloadPlatform());
}

void fetchLatestAssets().then((release) => {
  latest = release;
  refreshDownloadUi();
});

/**
 * Hero video: muted autoplay when motion is allowed.
 * Preview videos stay on posters until near the viewport.
 * If autoplay is blocked (or Reduce Motion is on), a click starts playback.
 */
function setupVideos(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const armClickToPlay = (video: HTMLVideoElement) => {
    const host = video.closest('.hero-screen, figure.screen');
    if (!(host instanceof HTMLElement)) return;
    host.classList.add('video-needs-gesture');
    host.title = 'Click to play';
    const onClick = () => {
      host.classList.remove('video-needs-gesture');
      host.removeAttribute('title');
      video.muted = true;
      void video.play().catch(() => undefined);
    };
    host.addEventListener('click', onClick, { once: true });
  };

  const playMuted = (video: HTMLVideoElement) => {
    video.muted = true;
    video.playsInline = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    const tryPlay = () => {
      void video
        .play()
        .then(() => {
          video.closest('.hero-screen, figure.screen')?.classList.remove('video-needs-gesture');
        })
        .catch(() => armClickToPlay(video));
    };
    if (video.readyState >= 2) tryPlay();
    else {
      video.addEventListener('loadeddata', tryPlay, { once: true });
      video.addEventListener('canplay', tryPlay, { once: true });
      // Cached error / decode failure → still offer a gesture.
      video.addEventListener('error', () => armClickToPlay(video), { once: true });
    }
  };

  const hydrateLazy = (video: HTMLVideoElement) => {
    if (video.dataset.hydrated === '1') return;
    const webm = video.dataset.srcWebm;
    const mp4 = video.dataset.srcMp4;
    if (!webm && !mp4) return;
    video.dataset.hydrated = '1';
    // MP4 first: Safari + any Chromium with a bad WebM cache still get a playable source.
    if (mp4) {
      const source = document.createElement('source');
      source.src = mp4;
      source.type = 'video/mp4';
      video.appendChild(source);
    }
    if (webm) {
      const source = document.createElement('source');
      source.src = webm;
      source.type = 'video/webm';
      video.appendChild(source);
    }
    video.preload = 'metadata';
    video.load();
    if (reduced.matches) armClickToPlay(video);
    else playMuted(video);
  };

  const applyHero = () => {
    const hero = document.querySelector<HTMLVideoElement>('video.hero-video');
    if (!hero) return;
    if (reduced.matches) {
      hero.pause();
      hero.removeAttribute('autoplay');
      armClickToPlay(hero);
    } else {
      playMuted(hero);
    }
  };

  applyHero();
  reduced.addEventListener('change', () => {
    applyHero();
    if (reduced.matches) {
      for (const video of document.querySelectorAll<HTMLVideoElement>('video.lazy-video')) {
        video.pause();
        video.removeAttribute('autoplay');
        if (video.dataset.hydrated === '1') armClickToPlay(video);
      }
    } else {
      for (const video of document.querySelectorAll<HTMLVideoElement>(
        'video.lazy-video[data-hydrated="1"]',
      )) {
        playMuted(video);
      }
    }
  });

  const lazyVideos = document.querySelectorAll<HTMLVideoElement>('video.lazy-video');
  if (!('IntersectionObserver' in window)) {
    for (const video of lazyVideos) hydrateLazy(video);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const video = entry.target;
        if (video instanceof HTMLVideoElement) {
          hydrateLazy(video);
          observer.unobserve(video);
        }
      }
    },
    { rootMargin: '200px 0px', threshold: 0.01 },
  );

  for (const video of lazyVideos) observer.observe(video);
  window.addEventListener('pageshow', applyHero);
}

setupVideos();
