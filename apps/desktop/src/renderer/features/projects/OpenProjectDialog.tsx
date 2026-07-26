import { FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * The design's Open project modal. A typed path plus a native picker: the
 * picker is kept because typing an absolute path is the worse of the two paths
 * on macOS, and Main honours the configured default projects folder.
 */
export function OpenProjectDialog({
  busy,
  error,
  onOpenPath,
  onBrowse,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onOpenPath: (path: string) => void;
  onBrowse: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="dialog-backdrop z-50"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Open project"
        className="dialog elev-lg w-[min(440px,100%)]"
        style={{ animation: 'pi-in .18s ease-out' }}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-accent-200">
            <FolderOpen className="h-[18px] w-[18px] text-accent-800" />
          </span>
          <div>
            <div className="dialog-title">Open project</div>
            <div className="dialog-body mt-1">Point it at a local Git repository.</div>
          </div>
        </div>

        <input
          ref={inputRef}
          className="input font-mono text-[12.5px]"
          placeholder="~/code/your-project"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) onOpenPath(value.trim());
          }}
        />

        {error ? <div className="text-[11.5px] leading-snug text-danger">{error}</div> : null}

        <div className="flex items-center gap-[var(--space-2)]">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onBrowse}>
            Browse…
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !value.trim()} onClick={() => onOpenPath(value.trim())}>
            Open
          </Button>
        </div>
      </div>
    </div>
  );
}
