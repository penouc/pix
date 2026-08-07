import type { CaptionCue } from '../components/captions';

/** WorkbenchSession — 13s @ 24fps (312). */
export const WORKBENCH_CAPTIONS: CaptionCue[] = [
  { from: 0, to: 36, text: '本地项目工作台：任务、权限与模型都在这里' },
  { from: 36, to: 100, text: '直接描述你要改什么 — @ 文件，$ Skill' },
  { from: 100, to: 168, text: '交给 Agent：先读代码，再动手改' },
  { from: 168, to: 228, text: '工具调用全程可见 — 读、改、跑测试' },
  { from: 228, to: 312, text: 'Changes 面板审 Diff，再决定保留或回退' },
];

/** AgentRun — 13s @ 24fps (312). */
export const AGENT_RUN_CAPTIONS: CaptionCue[] = [
  { from: 0, to: 40, text: '提出问题，Agent 开始思考' },
  { from: 40, to: 110, text: '推理过程可见，不是黑盒' },
  { from: 110, to: 200, text: '读文件、搜索、改代码、跑命令验证' },
  { from: 200, to: 250, text: '修复落地：空请求体返回 400' },
  { from: 250, to: 312, text: '完成摘要 + Changes 审查面板' },
];

/** UsageDashboard — 12s @ 24fps (288). */
export const USAGE_CAPTIONS: CaptionCue[] = [
  { from: 0, to: 48, text: 'Settings → Usage & cost：本地用量一览' },
  { from: 48, to: 120, text: '花费、Token、成功率与中位耗时' },
  { from: 120, to: 200, text: '按日活跃热力图，看出忙碌节奏' },
  { from: 200, to: 288, text: '按模型拆解用量与花费' },
];
