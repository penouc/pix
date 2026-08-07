import React from 'react';
import { useCurrentFrame } from 'remotion';
import { theme, fontStack, monoStack } from '../theme';
import { Typewriter, Spinner, Rise, Pop } from './motion';
import { BrainIcon, TerminalIcon, FileIcon, EditIcon, SearchIcon, ChevronIcon } from './icons';

/** Shared horizontal inset for the chat column (matches ChatPanel px-5). */
export const THREAD_X = 20;

/** User bubble — soft surface, asymmetric radius (matches ChatPanel). */
export const UserMessage: React.FC<{ text: string; delay?: number }> = ({
  text,
  delay = 0,
}) => (
  <Rise delay={delay} distance={8}>
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        width: '100%',
        padding: `0 ${THREAD_X}px`,
        marginBottom: 12,
        fontFamily: fontStack,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 16px',
          borderRadius: '22px 22px 6px 22px',
          background: theme.surface,
          boxShadow: theme.shadow,
          color: theme.text,
          fontSize: 13.5,
          lineHeight: 1.55,
          fontWeight: 500,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  </Rise>
);

/** Assistant reply — full-width bare markdown column, no bubble. */
export const AssistantText: React.FC<{
  text: string;
  start?: number;
  charsPerFrame?: number;
  caret?: boolean;
}> = ({ text, start = 0, charsPerFrame = 1.8, caret = true }) => {
  const frame = useCurrentFrame();
  if (frame < start) return null;
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: `2px ${THREAD_X}px 12px`,
        fontFamily: fontStack,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: theme.text,
      }}
    >
      <Typewriter text={text} start={start} charsPerFrame={charsPerFrame} caret={caret} />
    </div>
  );
};

/** Thinking row — circle + label, matches ThinkingStream. */
export const ThinkingBlock: React.FC<{ delay?: number; label?: string }> = ({
  delay = 0,
  label = 'Thought',
}) => (
  <Rise delay={delay} distance={6}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        boxSizing: 'border-box',
        padding: `4px ${THREAD_X}px 10px`,
        fontFamily: fontStack,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          background: theme.accentSoft,
          display: 'grid',
          placeItems: 'center',
          flex: 'none',
        }}
      >
        <BrainIcon size={12} color={theme.accent} />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: theme.muted }}>{label}</span>
    </div>
  </Rise>
);

const TOOL_ICONS: Record<string, React.FC<{ size?: number; color?: string }>> = {
  read: FileIcon,
  edit: EditIcon,
  run: TerminalIcon,
  bash: TerminalIcon,
  grep: SearchIcon,
};

/** Soft tool strip — compact row like ToolCard (not a heavy card). */
export const ToolRow: React.FC<{
  kind: string;
  label: string;
  meta: string;
  status: 'running' | 'done';
  delay?: number;
}> = ({ kind, label, meta, status, delay = 0 }) => {
  const Icon = TOOL_ICONS[kind] ?? FileIcon;
  const done = status === 'done';
  return (
    <Pop delay={delay}>
      <div
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: `2px ${THREAD_X}px`,
          fontFamily: fontStack,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 10px',
            borderRadius: 12,
            background: 'rgba(23,24,26,0.035)',
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: done ? theme.accentSoft : 'rgba(23,24,26,0.06)',
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
            }}
          >
            <Icon size={11} color={done ? theme.accent : theme.muted} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.muted, flex: 'none' }}>
            {label}
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: theme.muted,
              fontFamily: monoStack,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
          >
            {meta}
          </span>
          <span style={{ display: 'grid', placeItems: 'center', width: 16, flex: 'none' }}>
            {!done ? (
              <Spinner size={13} color={theme.accent} track={theme.borderStrong} />
            ) : (
              <ChevronIcon size={11} color={theme.muted} down={false} />
            )}
          </span>
        </div>
      </div>
    </Pop>
  );
};

export const ToolRowAuto: React.FC<{
  kind: string;
  label: string;
  meta: string;
  appear: number;
  doneAt: number;
}> = ({ kind, label, meta, appear, doneAt }) => {
  const frame = useCurrentFrame();
  if (frame < appear) return null;
  return (
    <ToolRow
      kind={kind}
      label={label}
      meta={meta}
      status={frame >= doneAt ? 'done' : 'running'}
      delay={0}
    />
  );
};

/** Completion summary as plain markdown-ish block. */
export const SummaryCard: React.FC<{
  title: string;
  bullets: string[];
  delay?: number;
}> = ({ title, bullets, delay = 0 }) => (
  <Rise delay={delay} distance={8}>
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: `8px ${THREAD_X}px 8px`,
        fontFamily: fontStack,
        color: theme.text,
        fontSize: 13.5,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <ul style={{ margin: 0, padding: '0 0 0 18px', color: theme.textDim }}>
        {bullets.map((b) => (
          <li key={b} style={{ marginBottom: 4 }}>
            {b}
          </li>
        ))}
      </ul>
    </div>
  </Rise>
);
