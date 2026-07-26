import { Check, Copy } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';

/**
 * Assistant prose, rendered as Markdown.
 *
 * The thread used to print raw text in a `whitespace-pre-wrap` block, so every
 * fenced code block, list and table arrived as literal backticks and hyphens —
 * which is most of what a coding agent writes.
 *
 * No `rehype-raw` and no `dangerouslySetInnerHTML`: react-markdown builds React
 * elements, so model output cannot inject markup into the app. Links are handed
 * to the OS browser rather than navigated in place, for the same reason the
 * window-open handler refuses anything but http(s) — a link in generated text is
 * untrusted input.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="pi-md text-[13.5px] leading-[1.62]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeRenderer,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
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
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            // Wide tables scroll in their own box; the thread never scrolls sideways.
            <div className="my-2 overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-[12.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-2.5 py-1.5 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-2.5 py-1.5 last:border-b-0">{children}</td>
          ),
          ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h4 className="mt-3 mb-1.5 first:mt-0">{children}</h4>,
          h2: ({ children }) => <h4 className="mt-3 mb-1.5 first:mt-0">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-2.5 mb-1 first:mt-0">{children}</h5>,
          h4: ({ children }) => <h5 className="mt-2.5 mb-1 first:mt-0">{children}</h5>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-accent/35 pl-3 text-muted">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-0 border-t border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

/** Inline code stays inline; a fenced block becomes a CodeBlock. */
function CodeRenderer({ className, children }: { className?: string; children?: ReactNode }) {
  const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
  const text = String(children ?? '');

  // react-markdown routes both inline code and fenced blocks here. A fence is
  // the one that carries a language class or spans lines.
  if (!language && !text.includes('\n')) {
    return (
      <code className="rounded-md bg-foreground/[0.07] px-1 py-0.5 font-mono text-[12px]">
        {text}
      </code>
    );
  }
  return <CodeBlock language={language} code={text.replace(/\n$/, '')} />;
}

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error('[markdown] copy failed', error);
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-border bg-[var(--color-output)]">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-1.5">
        <span className="flex-1 font-mono text-[10.5px] tracking-wide text-white/45 lowercase">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          title="Copy"
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 font-mono text-[10.5px]',
            copied ? 'text-white/85' : 'text-white/45 hover:text-white/85',
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      {/* Code scrolls inside its own box rather than widening the thread. */}
      <pre className="m-0 overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[1.55] text-[var(--color-output-foreground)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
