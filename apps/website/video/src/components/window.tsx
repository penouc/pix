import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { theme, fontStack, monoStack } from '../theme';
import {
  PlusIcon,
  SearchIcon,
  ZapIcon,
  SparklesIcon,
  ChevronIcon,
  GearIcon,
  PanelIcon,
  ImageIcon,
  ArrowUpIcon,
  BrainIcon,
} from './icons';

const navItem = (active = false): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 10px',
  margin: '1px 8px',
  borderRadius: 12,
  fontSize: 13,
  fontWeight: active ? 600 : 500,
  color: active ? theme.text : 'rgba(23,24,26,0.68)',
  background: active ? theme.bg : 'transparent',
  boxShadow: active ? theme.shadow : 'none',
  fontFamily: fontStack,
});

/** Title bar — 36px surface, traffic lights, centred PiMark + muted PiX. */
export const TitleBar: React.FC = () => (
  <div
    style={{
      height: 36,
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.surface,
      fontFamily: fontStack,
      position: 'relative',
    }}
  >
    <div style={{ position: 'absolute', left: 14, display: 'flex', gap: 7, alignItems: 'center' }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <span key={c} style={{ width: 11, height: 11, borderRadius: 999, background: c }} />
      ))}
    </div>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        letterSpacing: '0.02em',
        color: theme.muted,
        fontWeight: 600,
      }}
    >
      <Img
        src={staticFile('pix-mascot.png')}
        style={{ width: 16, height: 16, objectFit: 'contain' }}
      />
      PiX
    </div>
  </div>
);

/** ProjectSidebar — 210px, nav pills, PROJECTS, sage task selection. */
export const Sidebar: React.FC<{
  activeTask?: string;
  /** When true, highlight New task (empty workbench). */
  newTaskActive?: boolean;
  tasks?: string[];
}> = ({
  activeTask = 'Fix submit button label',
  newTaskActive = false,
  tasks = [
    'Fix submit button label',
    'Wire approvals log',
    'Pin favorite models',
    'Git commit && push',
    'Summarize current changes',
  ],
}) => (
  <div
    style={{
      width: 210,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      background: theme.surface,
      borderRight: `1px solid ${theme.border}`,
      fontFamily: fontStack,
    }}
  >
    <div style={{ padding: '6px 0 4px' }}>
      <div style={navItem(newTaskActive)}>
        <PlusIcon size={15} color={newTaskActive ? theme.text : theme.muted} />
        <span style={{ flex: 1, fontWeight: newTaskActive ? 600 : 500 }}>New task</span>
        <span style={{ fontSize: 11, fontFamily: monoStack, opacity: 0.5 }}>⌘N</span>
      </div>
      <div style={navItem()}>
        <SearchIcon size={15} />
        <span style={{ flex: 1 }}>Search</span>
        <span style={{ fontSize: 11, fontFamily: monoStack, opacity: 0.5 }}>⌘K</span>
      </div>
      <div style={navItem()}>
        <ZapIcon size={15} />
        Automations
      </div>
      <div style={navItem()}>
        <SparklesIcon size={15} />
        Skills
      </div>
    </div>

    <div style={{ height: 1, background: theme.border, margin: '10px 12px 8px' }} />

    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 14px 8px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        color: 'rgba(23,24,26,0.45)',
        textTransform: 'uppercase',
      }}
    >
      Projects
    </div>

    <div style={{ padding: '0 6px', flex: 1, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          fontSize: 12.5,
          fontWeight: 600,
          color: 'rgba(23,24,26,0.6)',
        }}
      >
        <ChevronIcon size={11} color={theme.muted} down />
        pix
      </div>
      {tasks.map((title) => {
        const active = !newTaskActive && title === activeTask;
        return (
          <div
            key={title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '1px 0 1px 8px',
              padding: '6px 8px',
              borderRadius: 10,
              background: active ? theme.accentSoft : 'transparent',
              fontSize: 12.5,
              color: active ? theme.text : 'rgba(23,24,26,0.6)',
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                flex: 'none',
                background: active ? theme.accent2 : theme.borderStrong,
              }}
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
          </div>
        );
      })}
    </div>

    <div style={{ borderTop: `1px solid ${theme.border}`, padding: '8px 10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 30,
          padding: '0 10px',
          borderRadius: 999,
          fontSize: 12.5,
          color: 'rgba(23,24,26,0.68)',
        }}
      >
        <GearIcon size={15} />
        Settings
      </div>
    </div>
  </div>
);

/** Chat header — title 14px bold, mono meta, status tag. */
export const ChatHeader: React.FC<{
  title: string;
  meta?: string;
  badge?: string;
}> = ({ title, meta = 'pix · main', badge = 'not started' }) => {
  const frame = useCurrentFrame();
  const working = badge === 'Working';
  const accent =
    badge === 'Working' || badge === 'Done' || badge === 'completed';
  const pulse = working ? 0.85 + 0.15 * Math.sin(frame / 8) : 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        borderBottom: `1px solid ${theme.border}`,
        background: theme.bg,
        fontFamily: fontStack,
        flex: 'none',
      }}
    >
      <span style={{ fontSize: 13, color: theme.muted, lineHeight: 1 }}>&lt;</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: theme.text,
          letterSpacing: '-0.015em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      <span style={{ fontSize: 10.5, color: theme.muted, fontFamily: monoStack, flex: 'none' }}>
        {meta}
      </span>
      <span style={{ flex: 1 }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: accent ? theme.accentText : theme.muted,
          background: accent ? theme.accentSoft : 'rgba(23,24,26,0.05)',
          borderRadius: 999,
          padding: '3px 10px',
          opacity: pulse,
        }}
      >
        {badge}
      </span>
      <PanelIcon size={14} color={theme.muted} />
    </div>
  );
};

const Pill: React.FC<{ children: React.ReactNode; icon?: React.ReactNode }> = ({
  children,
  icon,
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: 26,
      padding: '0 9px',
      borderRadius: 999,
      background: 'rgba(23,24,26,0.06)',
      color: theme.text,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      flex: 'none',
    }}
  >
    {icon}
    {children}
  </span>
);

/** SVG context ring — matches ContextUsageRing (remaining %). */
const ContextRing: React.FC<{ pct: number }> = ({ pct }) => {
  const r = 10;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <span
      style={{
        position: 'relative',
        width: 30,
        height: 30,
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      <svg width={28} height={28} viewBox="0 0 28 28" style={{ position: 'absolute' }}>
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke={theme.borderStrong}
          strokeWidth="2.5"
        />
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke={theme.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 14 14)"
        />
      </svg>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: theme.accentText,
          fontVariantNumeric: 'tabular-nums',
          zIndex: 1,
        }}
      >
        {clamped}
      </span>
    </span>
  );
};

/** Floating composer — 26px card, Auto / Build / Medium, ring, model, send. */
export const Composer: React.FC<{
  prompt: string;
  contextPct?: number;
  model?: string;
  branch?: string;
  dim?: boolean;
}> = ({
  prompt,
  contextPct = 100,
  model = 'GPT-5.6 Sol',
  branch = 'main',
  dim = false,
}) => (
  <div
    style={{
      padding: '40px 20px 16px',
      background:
        'linear-gradient(180deg, transparent 0%, rgba(248,250,248,0.9) 40%, #f8faf8 70%)',
      fontFamily: fontStack,
      flex: 'none',
    }}
  >
    <div style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 2px 8px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 22,
            padding: '0 10px',
            borderRadius: 999,
            border: `1px solid ${theme.border}`,
            fontSize: 11,
            color: theme.muted,
            background: theme.bg,
          }}
        >
          pix
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 22,
            padding: '0 10px',
            borderRadius: 999,
            border: `1px solid ${theme.border}`,
            fontSize: 11,
            color: theme.muted,
            background: theme.bg,
          }}
        >
          {branch}
        </span>
      </div>
      <div
        style={{
          borderRadius: 26,
          border: `1px solid ${theme.border}`,
          background: theme.surface,
          boxShadow: theme.shadow,
          padding: '12px 4px 10px',
        }}
      >
        <div
          style={{
            minHeight: 40,
            padding: '0 16px',
            fontSize: 13.5,
            color: dim ? theme.muted : theme.text,
            lineHeight: 1.5,
            fontWeight: 500,
          }}
        >
          {prompt}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            padding: '0 12px',
          }}
        >
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 30,
              height: 30,
              color: theme.muted,
              flex: 'none',
            }}
          >
            <ImageIcon size={16} />
          </span>
          <Pill icon={<ZapIcon size={11} color={theme.text} />}>Auto</Pill>
          <Pill>Build</Pill>
          <Pill icon={<BrainIcon size={11} color={theme.text} />}>Medium</Pill>
          <span style={{ flex: 1, minWidth: 0 }} />
          <ContextRing pct={contextPct} />
          <Pill
            icon={
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: theme.accent2,
                }}
              />
            }
          >
            {model}
          </Pill>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: theme.accent,
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
            }}
          >
            <ArrowUpIcon size={13} color="#fff" />
          </span>
        </div>
      </div>
    </div>
  </div>
);

/** Empty-state copy — matches ChatPanel. */
export const EmptyState: React.FC = () => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 40px 100px',
      fontFamily: fontStack,
      textAlign: 'center',
    }}
  >
    <div
      style={{
        fontSize: 20,
        fontWeight: 700,
        color: theme.text,
        letterSpacing: '-0.015em',
      }}
    >
      Describe what it should do
    </div>
    <div
      style={{
        marginTop: 10,
        maxWidth: 320,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: theme.muted,
      }}
    >
      Type or attach a screenshot below — @ for a file, $ for a skill, / for commands, ⌘K to
      search. It&apos;ll read the project, plan, then ask before running anything risky.
    </div>
  </div>
);
