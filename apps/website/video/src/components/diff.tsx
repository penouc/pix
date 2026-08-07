import React from 'react';
import { theme, fontStack, monoStack } from '../theme';
import { Rise } from './motion';

const TABS = ['Files', 'Changes', 'Todo', 'Terminal', 'Browser'] as const;

const badgeColor = (status: 'M' | 'A' | 'D') => {
  if (status === 'A') return { bg: 'rgba(93,158,130,0.18)', fg: theme.accent2 };
  if (status === 'D') return { bg: 'rgba(23,24,26,0.08)', fg: theme.muted };
  return { bg: theme.accentSoft, fg: theme.accentText };
};

/** Right dock Changes tab — lifted pill tabs, A/M badges, Run & models, Checkpoint. */
export const ChangesPanel: React.FC<{
  delay?: number;
  activeTab?: (typeof TABS)[number];
  files?: Array<{ path: string; status: 'M' | 'A' | 'D' }>;
  status?: string;
  tools?: string;
  model?: string;
  width?: number;
}> = ({
  delay = 0,
  activeTab = 'Changes',
  files = [
    { path: 'src/components/Button.tsx', status: 'M' },
    { path: 'src/components/Button.test.tsx', status: 'M' },
  ],
  status = 'Done',
  tools = '3',
  model = 'openai-codex/gpt-5.6-sol',
  width = 380,
}) => (
  <Rise delay={delay} distance={14}>
    <div
      style={{
        width,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.surface,
        borderLeft: `1px solid ${theme.border}`,
        fontFamily: fontStack,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: '6px 6px',
          borderBottom: `1px solid ${theme.border}`,
          flex: 'none',
        }}
      >
        {TABS.map((tab) => {
          const on = tab === activeTab;
          return (
            <span
              key={tab}
              style={{
                padding: '6px 9px',
                borderRadius: 10,
                fontSize: 11.5,
                fontWeight: on ? 700 : 500,
                color: on ? theme.text : 'rgba(23,24,26,0.55)',
                background: on ? theme.bg : 'transparent',
                boxShadow: on ? theme.shadow : 'none',
              }}
            >
              {tab}
            </span>
          );
        })}
      </div>

      <div style={{ padding: '14px 14px 8px', flex: 'none' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, letterSpacing: '-0.01em' }}>
          Review changes
        </div>
        <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 4 }}>
          {files.length} changed file{files.length === 1 ? '' : 's'} · compared with HEAD
        </div>
        <div style={{ display: 'inline-flex', gap: 2, marginTop: 10 }}>
          {['Unified', 'Split'].map((mode, i) => (
            <span
              key={mode}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                background: i === 0 ? theme.bg : 'transparent',
                color: i === 0 ? theme.text : theme.muted,
                boxShadow: i === 0 ? theme.shadow : 'none',
              }}
            >
              {mode}
            </span>
          ))}
        </div>
      </div>

      <div style={{ padding: '4px 8px', flex: 1, minHeight: 0 }}>
        {files.map((file, index) => {
          const colors = badgeColor(file.status);
          return (
            <Rise key={file.path} delay={delay + 6 + index * 5} distance={5}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 16,
                  background: index === 0 ? theme.bg : 'transparent',
                }}
              >
                <span
                  style={{
                    width: 17,
                    height: 17,
                    borderRadius: 6,
                    background: colors.bg,
                    color: colors.fg,
                    fontSize: 9.5,
                    fontWeight: 800,
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none',
                  }}
                >
                  {file.status}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontFamily: monoStack,
                    color: theme.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.path}
                </span>
              </div>
            </Rise>
          );
        })}
      </div>

      <div style={{ padding: '10px 14px 8px', borderTop: `1px solid ${theme.border}`, flex: 'none' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'rgba(23,24,26,0.55)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Run &amp; models
        </div>
        {(
          [
            ['Status', status],
            ['Tools', tools],
            ['Model', model],
          ] as const
        ).map(([k, v]) => (
          <div
            key={k}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              fontSize: 11.5,
              padding: '3px 0',
            }}
          >
            <span style={{ color: theme.muted }}>{k}</span>
            <span
              style={{
                color: theme.text,
                fontWeight: 600,
                fontFamily: monoStack,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 200,
              }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 12px 14px', flex: 'none' }}>
        <div
          style={{
            borderRadius: 20,
            background: 'rgba(248,250,248,0.7)',
            border: `1px solid ${theme.border}`,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>Checkpoint</div>
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              lineHeight: 1.45,
              color: theme.muted,
            }}
          >
            Revert restores files matching the agent&apos;s last recorded write.
          </div>
        </div>
      </div>
    </div>
  </Rise>
);
