import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { theme, fontStack } from '../theme';
import { TitleBar, Sidebar, Composer, ChatHeader, EmptyState } from '../components/window';
import {
  UserMessage,
  AssistantText,
  ToolRowAuto,
  SummaryCard,
} from '../components/chat';
import { ChangesPanel } from '../components/diff';
import { Captions } from '../components/captions';
import { WORKBENCH_CAPTIONS } from '../captions';

const FPS = 24;
export const WORKBENCH_DURATION = FPS * 13; // 312

/**
 * Hero — blank workbench → typed prompt → agent run → Changes dock.
 * Fidelity pass against ChatPanel + ReviewPanel (Organic light).
 */
export const WorkbenchSession: React.FC = () => {
  const frame = useCurrentFrame();
  const prompt = "Fix the submit button label to fall back to 'Save changes'";
  const typing = frame >= 28 && frame < 96;
  const showSession = frame >= 100;
  const typedLen = Math.floor(
    interpolate(frame, [28, 90], [0, prompt.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const placeholder = 'Describe the change — @ file, $ skill, / command · ⏎ send';
  const composerText = showSession
    ? placeholder
    : typing
      ? prompt.slice(0, typedLen)
      : frame < 28
        ? placeholder
        : prompt;

  const badge = !showSession
    ? 'not started'
    : frame >= 255
      ? 'Done'
      : 'Working';

  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: fontStack }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TitleBar />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar
            newTaskActive={!showSession}
            activeTask={showSession ? 'Fix submit button label' : 'Wire approvals log'}
          />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              background: theme.bg,
              position: 'relative',
            }}
          >
            <ChatHeader
              title={showSession ? 'Fix submit button label' : 'New task'}
              meta={showSession ? 'pix · main · run' : 'pix · main · not started yet'}
              badge={badge}
            />

            {!showSession ? (
              <EmptyState />
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', paddingTop: 12 }}>
                <div
                  style={{
                    maxWidth: 760,
                    margin: '0 auto',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <UserMessage text={prompt} delay={100} />
                  <AssistantText
                    text="I'll update the Button fallback label and fix the test that still expects “Submit”."
                    start={118}
                    charsPerFrame={2.2}
                  />
                  <ToolRowAuto
                    kind="read"
                    label="read"
                    meta="src/components/Button.tsx"
                    appear={165}
                    doneAt={185}
                  />
                  <ToolRowAuto
                    kind="edit"
                    label="edit"
                    meta="src/components/Button.tsx"
                    appear={190}
                    doneAt={210}
                  />
                  <ToolRowAuto
                    kind="bash"
                    label="bash"
                    meta="$ pnpm test -- Button"
                    appear={215}
                    doneAt={245}
                  />
                  <SummaryCard
                    delay={250}
                    title="Done — 6/6 tests pass"
                    bullets={[
                      'Button falls back to “Save changes” when no label is given.',
                      'Test updated to match the new default.',
                    ]}
                  />
                </div>
              </div>
            )}

            <Composer
              prompt={composerText || ' '}
              contextPct={showSession ? 72 : 100}
              dim={!typing && !showSession}
            />
          </main>
          {frame >= 220 ? (
            <ChangesPanel delay={220} status={frame >= 255 ? 'Done' : 'Working'} tools="3" />
          ) : null}
        </div>
      </div>
      <Captions cues={WORKBENCH_CAPTIONS} />
    </AbsoluteFill>
  );
};
