import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { theme, fontStack } from '../theme';
import { TitleBar, Sidebar, Composer, ChatHeader } from '../components/window';
import {
  UserMessage,
  AssistantText,
  ToolRowAuto,
  ThinkingBlock,
  SummaryCard,
} from '../components/chat';
import { ChangesPanel } from '../components/diff';
import { Captions } from '../components/captions';
import { AGENT_RUN_CAPTIONS } from '../captions';

const FPS = 24;
export const AGENT_RUN_DURATION = FPS * 13; // 312

/**
 * Preview #2 — live agent run with thinking, tools, summary, Changes dock.
 */
export const AgentRun: React.FC = () => {
  const frame = useCurrentFrame();
  const done = frame >= 250;

  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: fontStack }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TitleBar />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar
            activeTask="Why API returns 500 on empty body"
            tasks={[
              'Why API returns 500 on empty body',
              'Fix submit button label',
              'Wire approvals log',
              'Pin favorite models',
              'Git commit && push',
            ]}
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
              title="Why API returns 500 on empty body"
              meta="pix · main · run"
              badge={done ? 'Done' : 'Working'}
            />
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', paddingTop: 12 }}>
              <div
                style={{
                  maxWidth: 760,
                  margin: '0 auto',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <UserMessage
                  text="Why does the API return 500 on an empty request body?"
                  delay={6}
                />
                <ThinkingBlock delay={22} label="Thought" />
                <AssistantText
                  text="The route handler assumes the body is always populated. I'll guard the empty case and verify with a request."
                  start={48}
                  charsPerFrame={2.1}
                />
                <ToolRowAuto
                  kind="read"
                  label="read"
                  meta="src/routes/api.ts"
                  appear={110}
                  doneAt={130}
                />
                <ToolRowAuto
                  kind="grep"
                  label="grep"
                  meta="req.body · src/"
                  appear={138}
                  doneAt={158}
                />
                <ToolRowAuto
                  kind="edit"
                  label="edit"
                  meta="src/routes/api.ts"
                  appear={166}
                  doneAt={188}
                />
                <ToolRowAuto
                  kind="bash"
                  label="bash"
                  meta="$ curl -s localhost:4000/api"
                  appear={196}
                  doneAt={230}
                />
                <SummaryCard
                  delay={238}
                  title="Completed — empty body now returns 400"
                  bullets={[
                    'Early-return guard added before parsing.',
                    'Content-type check keeps JSON responses clean.',
                    'curl verification returns 200 for valid payloads.',
                  ]}
                />
              </div>
            </div>
            <Composer
              prompt="Describe the change — @ file, $ skill, / command · ⏎ send"
              contextPct={40}
              dim
            />
          </main>
          <ChangesPanel
            delay={40}
            status={done ? 'Done' : 'Working'}
            tools="4"
            files={[
              { path: 'src/routes/api.ts', status: 'M' },
              { path: 'src/routes/api.test.ts', status: 'A' },
            ]}
          />
        </div>
      </div>
      <Captions cues={AGENT_RUN_CAPTIONS} />
    </AbsoluteFill>
  );
};
