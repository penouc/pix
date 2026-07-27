import { code } from '@streamdown/code';
import { memo, type ComponentProps } from 'react';
import { Streamdown } from 'streamdown';

import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';

/**
 * Assistant prose via Streamdown — handles incomplete Markdown while tokens stream.
 *
 * Links open in the system browser (`system.openExternal`), not inside Electron.
 */
export const Markdown = memo(function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string;
  streaming?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'pi-md w-full max-w-full min-w-0 overflow-x-hidden break-words text-[13.5px] leading-[1.62]',
        className,
      )}
    >
      <Streamdown
        mode="streaming"
        isAnimating={streaming}
        parseIncompleteMarkdown
        caret={streaming ? 'block' : undefined}
        plugins={{ code }}
        shikiTheme={['github-light', 'github-dark']}
        lineNumbers={false}
        controls={{ code: { copy: true } }}
        components={{ a: ExternalLink }}
      >
        {children}
      </Streamdown>
    </div>
  );
});

function ExternalLink({
  href,
  children,
  ...props
}: ComponentProps<'a'> & { node?: unknown }) {
  return (
    <a
      href={href}
      className="text-accent-700 underline decoration-accent/40 underline-offset-2"
      onClick={(event) => {
        event.preventDefault();
        if (!href) return;
        void invoke({ method: 'system.openExternal', params: { url: href } }).catch(
          console.error,
        );
      }}
      {...props}
    >
      {children}
    </a>
  );
}
