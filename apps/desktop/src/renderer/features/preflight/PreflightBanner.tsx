import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { AppInfo } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';

const DISMISS_KEY = 'pi-desktop.git-bash-banner-dismissed';

/**
 * Windows-only banner: agent commands (and the Terminal panel) run through Git
 * Bash. When it is missing, PiX still starts and the UI still works — but every
 * command would fail, so the first thing a fresh Windows install should see is
 * what to install. Dismissed once, remembered per app version.
 */
export function PreflightBanner() {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  const appInfo = useQuery({
    queryKey: ['app.getInfo'],
    queryFn: () => invoke<AppInfo>({ method: 'app.getInfo' }),
    staleTime: 60_000,
  });

  const preflight = appInfo.data?.preflight;
  const needsBash = preflight?.bash?.required === true && preflight?.bash?.available === false;
  const version = appInfo.data?.version ?? '';
  if (!needsBash || dismissedVersion === version) return null;

  function dismiss() {
    setDismissedVersion(version);
    try {
      localStorage.setItem(DISMISS_KEY, version);
    } catch {
      /* storage unavailable — banner shows again next launch */
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-none items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12.5px] leading-5 text-amber-100"
    >
      <span className="mt-0.5">⚠️</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-amber-50">Git Bash is required to run agent commands</p>
        <p className="text-amber-100/80">
          {preflight?.bash?.hint ??
            'PiX runs commands through Git Bash on Windows. Install Git for Windows and restart PiX.'}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="cursor-pointer rounded border-0 px-2 py-1 text-[11px] font-medium text-amber-100/80 hover:bg-amber-500/20 hover:text-amber-50"
      >
        Dismiss
      </button>
    </div>
  );
}
