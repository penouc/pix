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
let latest: { url: string; version: string } | null = null;

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
});

/** Resolve the latest release's DMG asset from the GitHub API. */
async function fetchLatestDmg(): Promise<{ url: string; version: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const release = (await res.json()) as GitHubRelease;
    const asset = release.assets?.find(
      (a) => a.name.endsWith('.dmg') && !a.name.includes('blockmap'),
    );
    if (!asset) return null;
    return { url: asset.browser_download_url, version: release.tag_name.replace(/^v/, '') };
  } catch {
    return null;
  }
}

/**
 * Point every `[data-download]` button at the latest DMG and surface the
 * resolved version. When the API is unreachable, keep the releases/latest
 * page as a fallback so the button always works.
 */
function syncDownloadButtons(): void {
  for (const btn of document.querySelectorAll<HTMLAnchorElement>('[data-download]')) {
    btn.href = latest?.url ?? LATEST_PAGE;
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

  const line = document.querySelector<HTMLElement>('[data-download-latest]');
  if (line) {
    if (version) {
      line.textContent = `${translate('download.latestPrefix')} v${version} · Apple Silicon DMG`;
      line.hidden = false;
    } else {
      line.hidden = true;
    }
  }
}

void fetchLatestDmg().then((release) => {
  latest = release;
  syncDownloadButtons();
});

/**
 * Respect `prefers-reduced-motion`: pause the looping showcase videos and
 * show their posters (static screenshots) instead of playing them.
 * Otherwise force muted autoplay — posters alone look like the old static site.
 */
function respectReducedMotion(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const kick = (video: HTMLVideoElement) => {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    const tryPlay = () => void video.play().catch(() => undefined);
    if (video.readyState >= 2) tryPlay();
    else video.addEventListener('loadeddata', tryPlay, { once: true });
  };

  const apply = () => {
    const videos = document.querySelectorAll<HTMLVideoElement>('video');
    for (const video of videos) {
      if (reduced.matches) {
        video.pause();
        video.removeAttribute('autoplay');
        video.load();
      } else {
        kick(video);
      }
    }
  };

  apply();
  reduced.addEventListener('change', apply);
  // Late layout / bfcache returns
  window.addEventListener('pageshow', apply);
}

respectReducedMotion();
