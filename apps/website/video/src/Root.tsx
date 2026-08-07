import React from 'react';
import { Composition } from 'remotion';
import {
  WorkbenchSession,
  WORKBENCH_DURATION,
} from './compositions/WorkbenchSession';
import { AgentRun, AGENT_RUN_DURATION } from './compositions/AgentRun';
import { UsageDashboard, USAGE_DURATION } from './compositions/UsageDashboard';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WorkbenchSession"
        component={WorkbenchSession}
        durationInFrames={WORKBENCH_DURATION}
        fps={24}
        width={1280}
        height={800}
      />
      <Composition
        id="AgentRun"
        component={AgentRun}
        durationInFrames={AGENT_RUN_DURATION}
        fps={24}
        width={1280}
        height={800}
      />
      <Composition
        id="UsageDashboard"
        component={UsageDashboard}
        durationInFrames={USAGE_DURATION}
        fps={24}
        width={1280}
        height={800}
      />
    </>
  );
};
