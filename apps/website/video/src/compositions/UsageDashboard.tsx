import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { theme, fontStack, monoStack } from '../theme';
import { TitleBar, Sidebar } from '../components/window';
import { Rise, CountUp } from '../components/motion';
import { Captions } from '../components/captions';
import { USAGE_CAPTIONS } from '../captions';

const FPS = 24;
export const USAGE_DURATION = FPS * 12; // 288

const PREFS = [
  'Providers & models',
  'Permissions',
  'Projects & trust',
  'Checkpoints',
  'Appearance',
  'Usage',
  'Notifications',
  'About',
];

const MODELS = [
  { id: 'gpt-5.6-sol', provider: 'openai-codex', runs: 210, tokens: '2.1M', spend: 38.2, share: 0.55 },
  { id: 'grok-4.5', provider: 'xai', runs: 64, tokens: '0.72M', spend: 14.1, share: 0.2 },
  { id: 'deepseek-v4-pro', provider: 'deepseek', runs: 48, tokens: '0.51M', spend: 9.4, share: 0.14 },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', runs: 45, tokens: '0.34M', spend: 7.8, share: 0.11 },
];

/** Deterministic heatmap levels for a year-ish grid (52 weeks × 7). */
function heatLevel(week: number, day: number): 0 | 1 | 2 | 3 | 4 {
  const n = (week * 7 + day * 3) % 17;
  if (n > 14) return 4;
  if (n > 11) return 3;
  if (n > 8) return 2;
  if (n > 5) return 1;
  return 0;
}

const Heatmap: React.FC = () => {
  const frame = useCurrentFrame();
  const weeks = 36;
  return (
    <div
      style={{
        borderRadius: 18,
        border: `1px solid ${theme.border}`,
        background: theme.heatSurface,
        padding: 14,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: weeks }, (_, week) => {
          const reveal = interpolate(frame, [50 + week * 1.2, 50 + week * 1.2 + 10], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div key={week} style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: reveal }}>
              {Array.from({ length: 7 }, (_, day) => {
                const level = heatLevel(week, day);
                return (
                  <span
                    key={day}
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: theme.heat[level],
                      boxShadow: 'inset 0 0 0 1px rgba(20,21,24,0.07)',
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          fontSize: 11,
          color: theme.muted,
        }}
      >
        Less
        {theme.heat.map((c, i) => (
          <span
            key={i}
            style={{
              width: 11,
              height: 11,
              borderRadius: 3,
              background: c,
              boxShadow: 'inset 0 0 0 1px rgba(20,21,24,0.07)',
            }}
          />
        ))}
        More
      </div>
    </div>
  );
};

const Stat: React.FC<{
  label: string;
  delay: number;
  children: React.ReactNode;
  sub?: string;
  hero?: boolean;
}> = ({ label, delay, children, sub, hero }) => (
  <Rise delay={delay} distance={10}>
    <div
      style={{
        flex: 1,
        borderRadius: 18,
        border: `1px solid ${theme.border}`,
        background: theme.white,
        padding: '14px 16px',
        fontFamily: fontStack,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: theme.muted,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: hero ? 26 : 22,
          fontWeight: 800,
          color: theme.text,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {children}
      </div>
      {sub ? (
        <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  </Rise>
);

/**
 * Preview #3 — Settings → Usage & cost: KPI tiles + heatmap + by-model table.
 */
export const UsageDashboard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: fontStack }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TitleBar />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar activeTask="Wire approvals log" />

          {/* Preferences rail */}
          <div
            style={{
              width: 186,
              flex: 'none',
              background: theme.surface,
              borderRight: `1px solid ${theme.border}`,
              padding: '14px 10px',
            }}
          >
            <div
              style={{
                padding: '4px 10px 14px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: 'rgba(23,24,26,0.42)',
                textTransform: 'uppercase',
              }}
            >
              Preferences
            </div>
            {PREFS.map((item) => {
              const active = item === 'Usage';
              return (
                <div
                  key={item}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 12,
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    color: active ? theme.text : theme.textDim,
                    background: active ? theme.bg : 'transparent',
                    boxShadow: active ? theme.shadow : 'none',
                    marginBottom: 2,
                  }}
                >
                  {item}
                </div>
              );
            })}
          </div>

          <main
            style={{
              flex: 1,
              minWidth: 0,
              padding: '20px 24px',
              background: theme.bg,
              overflow: 'hidden',
            }}
          >
            <Rise delay={4} distance={8}>
              <div style={{ fontSize: 20, fontWeight: 800, color: theme.text }}>Usage &amp; cost</div>
              <div style={{ fontSize: 12.5, color: theme.muted, marginTop: 4 }}>
                What the agent has actually run, and what it cost.
              </div>
            </Rise>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 2,
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 10,
                  padding: 3,
                }}
              >
                {['30 days', '90 days', '1 year'].map((label, i) => (
                  <span
                    key={label}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      background: i === 2 ? theme.bg : 'transparent',
                      color: i === 2 ? theme.text : theme.muted,
                      boxShadow: i === 2 ? theme.shadow : 'none',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <Stat label="Spend" delay={14} hero sub="over 367 runs">
                $<CountUp to={69.5} start={18} decimals={2} />
              </Stat>
              <Stat label="Tokens" delay={20} sub="3.3M in · 0.37M out">
                <CountUp to={3.67} start={24} decimals={2} suffix="M" />
              </Stat>
              <Stat label="Finished" delay={26} sub="0 failed · 3 cancelled">
                <CountUp to={99} start={30} suffix="%" />
              </Stat>
              <Stat label="Median run" delay={32} sub="wall clock, per run">
                <CountUp to={42} start={36} suffix="s" />
              </Stat>
            </div>

            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                  alignItems: 'baseline',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: theme.text }}>Runs per day</div>
                <div style={{ fontSize: 11, color: theme.muted }}>busiest day: 118 runs</div>
              </div>
              <Heatmap />
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
                By model
              </div>
              <div
                style={{
                  borderRadius: 18,
                  border: `1px solid ${theme.border}`,
                  overflow: 'hidden',
                  background: theme.white,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.6fr 0.5fr 0.6fr 1.4fr',
                    padding: '8px 14px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: theme.muted,
                    borderBottom: `1px solid ${theme.border}`,
                  }}
                >
                  <span>MODEL</span>
                  <span style={{ textAlign: 'right' }}>RUNS</span>
                  <span style={{ textAlign: 'right' }}>TOKENS</span>
                  <span>SPEND</span>
                </div>
                {MODELS.map((row, i) => {
                  const t = interpolate(frame, [140 + i * 8, 140 + i * 8 + 18], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  });
                  return (
                    <div
                      key={row.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.6fr 0.5fr 0.6fr 1.4fr',
                        padding: '10px 14px',
                        borderBottom: i === MODELS.length - 1 ? 'none' : `1px solid ${theme.border}`,
                        alignItems: 'center',
                        opacity: t,
                      }}
                    >
                      <span>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{row.id}</div>
                        <div style={{ fontSize: 11, color: theme.muted }}>{row.provider}</div>
                      </span>
                      <span
                        style={{
                          textAlign: 'right',
                          fontFamily: monoStack,
                          fontSize: 12,
                          color: theme.text,
                        }}
                      >
                        {row.runs}
                      </span>
                      <span
                        style={{
                          textAlign: 'right',
                          fontFamily: monoStack,
                          fontSize: 12,
                          color: theme.text,
                        }}
                      >
                        {row.tokens}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 999,
                            background: theme.border,
                            overflow: 'hidden',
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              height: '100%',
                              width: `${row.share * 100 * t}%`,
                              background: theme.accent,
                              borderRadius: 999,
                            }}
                          />
                        </span>
                        <span
                          style={{
                            width: 52,
                            textAlign: 'right',
                            fontFamily: monoStack,
                            fontSize: 12,
                            color: theme.text,
                          }}
                        >
                          ${row.spend.toFixed(1)}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </main>
        </div>
      </div>
      <Captions cues={USAGE_CAPTIONS} />
    </AbsoluteFill>
  );
};
