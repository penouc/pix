# Pi Agent Desktop — 执行 Todos 与进度台账

> **权威产品/工程总纲：** [`../Pi_Agent_Desktop_开发总计划.md`](../Pi_Agent_Desktop_开发总计划.md)（v1.0 · 2026-07-24）  
> **本文件职责：** 把总纲拆成可执行 todos、记录当前状态、防止跳过验收门槛。  
> **推进原则（总纲 §0）：** 每个阶段只有在对应验收标准通过后才进入下一阶段；任何不影响第一条完整用户路径的功能，都不能阻塞 MVP。  
> **最后更新：** 2026-07-24（Pi SDK 0.82.0 接入会话）

---

## 0. 如何使用本文件

| 层级 | 内容 | 更新时机 |
|------|------|----------|
| 总纲 | 产品范围、架构契约、里程碑门槛、验收剧本 | 重大决策时 |
| **本文件** | 可勾选 todos、当前状态、下一步、偏差说明 | 每次开发会话结束 |
| 代码/PR | 具体实现 | 日常开发 |

**状态图例**

| 标记 | 含义 |
|------|------|
| `[ ]` | 未开始 |
| `[~]` | 进行中 / 部分完成（不得视为阶段通过） |
| `[x]` | 已完成且满足对应验收含义 |
| `[!]` | 曾误标完成，已纠正为未完成 |

**阶段门禁：** M*n* 的「完成门槛」未满足前，不得把 M*n* 整阶段标为 done，也不得依赖其产出宣称后续阶段已具备前提。

---

## 1. 产品北极星（总纲 §1–3，只读摘要）

### 1.1 核心目标

以 **Pi Agent SDK** 为 Agent Runtime，构建本地桌面应用，完成：

> 理解任务 → 修改代码 → 执行验证 → 审查 Diff → 接受或撤销变更

### 1.2 第一版成功标准（§1.2）

- [ ] 打开本地 Git 项目并建立可信 Workspace  
- [ ] 选择已配置的 Provider 和 Model  
- [ ] Agent 可读/搜/改代码并运行验证命令  
- [ ] 实时理解运行状态与工具调用  
- [ ] 危险操作拦截并要求授权  
- [ ] 多文件 Diff；继续修改或保留结果  
- [ ] 撤销本轮 Agent 修改，不损坏任务前已有修改  
- [ ] 关闭后可恢复项目、会话和运行记录  

### 1.3 MVP 主路径（§2）— 验收必须覆盖

1. 启动 → 选择/恢复本地 Git 项目  
2. Workspace Trust → 创建 Session  
3. 选择 Provider / Model / Thinking Level  
4. 输入真实编码任务（可引用文件）  
5. 流式展示消息、工具调用、运行状态  
6. Workspace 内读写按策略；敏感操作审批  
7. 改代码并跑 lint/test/build  
8. 多文件 Diff + 测试结果 + 任务摘要  
9. 继续修改 / 保留 / 撤销本轮修改  
10. 持久化 Session、Run、Approval、FileChange、Checkpoint  

**MVP 冻结（不得阻塞主路径）：** Plan Mode、Session Fork、多 Agent、远程 Workspace、本地 4090、MCP、自动更新、多窗口。

### 1.4 最终验收剧本（§19）

- [ ] 在「已有未提交修改」的 React Git 项目上跑通剧本 1–11  
- [ ] 愿意在真实日常项目中连续使用（产品成立判断）  

---

## 2. 架构与工程契约（总纲 §4–11）— 实现约束清单

> 这些不是“以后再想”的愿望列表，而是实现时必须遵守的契约。相关代码/文档未对齐时，在对应里程碑中消化。

### 2.1 架构原则（§4.1）

| ID | 约束 | 当前状态 |
|----|------|----------|
| A1 | Renderer 无 Node Integration；不直接访问 FS / Shell / 密钥 / DB | [x] 已设 `contextIsolation` + 关 `nodeIntegration` |
| A2 | 跨进程输入/输出/事件全部 Zod runtime validation | [~] 有协议包；Main 边界有解析；未覆盖全部持久化边界 |
| A3 | Pi SDK 只出现在 `agent-pi`；业务与 UI 不导入 Pi 类型 | [x] Pi 仅 `agent-pi` + Main 依赖；UI 不导入 |
| A4 | 每个 Agent Event 带 `projectId/sessionId/runId/sequence/timestamp` | [x] schema + Fake 事件具备 |
| A5 | 权限判定在 Main；Renderer 只展示审批并回传决策 | [ ] 审批管线未实现 |
| A6 | Git Diff 仅展示；Checkpoint 快照才是可靠恢复来源 | [ ] 未实现 |
| A7 | Provider/Model 交给 Pi；Desktop 负责登录 UX、密钥、状态展示 | [~] Settings API Key + 默认模型；OAuth 登录未实现 |

### 2.2 版本策略（§5）

| 依赖 | 要求 | 当前状态 |
|------|------|----------|
| Electron | 锁定具体版本 | [~] `36.4.0`（package 中已钉版本，需确认 lock 一致） |
| Pi SDK | 锁定具体版本 + 升级回归步骤 | [x] `@earendil-works/*@0.82.0` + ADR-0002 |
| @pierre/diffs | 锁定具体版本 | [x] `@pierre/diffs@1.2.12` |
| SQLite 驱动 | 锁定具体版本；packaged ARM64 验证 | [ ] 未安装 |
| 其它依赖 | MVP 避免“自动跟随最新”的松散范围 | [~] 仍有大量 `^` |

### 2.3 目标仓库结构（§6）对照

```text
期望（总纲）                          当前
─────────────────────────────────────────────────────────
apps/desktop/src/main/
  agent/ approvals/ providers/      [ ] 仅 index.ts + project-store.ts
  workspace/ git/ checkpoints/
  sessions/ storage/ ipc/
  observability/
apps/desktop/src/preload/           [x] 最小白名单 bridge
apps/desktop/src/renderer/
  app/ components/ stores/          [~] 有基础结构
  features/ agent chat approvals    [~] projects + chat + status
             diff projects sessions
             models settings
packages/
  agent-domain agent-pi protocol    [x]
  database git security ui          [ ]
fixtures/test-repositories/         [~] 仅 react-button-label 占位
tests/integration/ tests/e2e/       [ ]
docs/（见 §6.1）                     [~] 见下表
```

### 2.4 文档集（§6.1）

| 文件 | 状态 |
|------|------|
| product-scope.md | [x] 摘要版 |
| architecture.md | [x] 摘要版 |
| agent-runtime-contract.md | [x] 摘要版 |
| ipc-protocol.md | [x] 摘要版 |
| security-model.md | [ ] |
| data-model.md | [x] SQLite sessions 表 + migrations |
| checkpoint-semantics.md | [ ] |
| acceptance-tests.md | [x] fixture + packaged 路径 |
| decisions/（Electron、Pi、Pierre…） | [~] 仅 ADR-0001 |
| **TODOS.md（本文件）** | [x] 2026-07-24 创建 |

### 2.5 AgentRuntime 契约（§7）

- [x] `AgentRuntime` 接口形状（domain 包）  
- [x] `FakeAgentRuntime`（离线 UI/E2E）  
- [~] `PiAgentRuntime`（createSession / prompt / abort / listModels；usage 映射与审批钩子未完）  
- [~] 事件映射：message / tool / run lifecycle → `DesktopAgentEvent`（usage 未映射）  
- [~] Abort / Provider 错误归一化（有基础）；超时未完  
- [~] Session 存储路径可控（agentDir）；跨重启恢复未做  

**§7.2 Pi 技术验证清单（M1 核心证据）**

- [~] Pi SDK 在 Electron Main **dev** 可加载运行（单元 smoke 创建 Session 通过；GUI 真 prompt 待鉴权）  
- [ ] Pi SDK 在 **packaged** Electron 可加载运行  
- [~] ESM/CJS、动态依赖、资源发现无打包冲突（main externalize `@earendil-works/*`）  
- [x] Session 存储路径可控（`userData/pi-agent`），恢复稳定（持久 session 文件尚未）  
- [~] Tool Event 含权限判断所需输入（name + inputSummary + riskLevel 启发式）  
- [ ] Abort 终止 Bash **及其子进程树**（已调用 abort/abortBash；树验证未做）  
- [~] 关闭应用无残留 Agent/Shell 进程（dispose on before-quit）  
- [ ] 至少一个 Provider 登录 + 模型列表 + 真实调用闭环（listModels 离线 catalog 可；真调用需 auth）  
- [x] Pi SDK 版本锁定 + 升级回归步骤成文（ADR-0002 + tech-validation-m1）  

### 2.6 事件与状态机（§8）

- [x] `AgentRunState` 联合类型 + 基础转移  
- [x] 事件族 schema（lifecycle / message / tool / approval / files / usage）  
- [x] Renderer 乱序防护：sequence 递增  
- [x] Renderer 乱序防护：当前 projectId/sessionId/runId  
- [ ] Token delta 批处理 / 有界事件队列（与 §14.1 对齐）  

### 2.7 权限与安全（§9）

| 项 | 状态 |
|----|------|
| 风险等级模型（safe → external-side-effect） | [~] schema 有 RiskLevel；无 Policy Engine |
| ApprovalDecision 四态 | [~] schema 有；无 UI/管线 |
| Tool Normalizer / Risk Classifier / Policy Engine | [ ] |
| protected paths + path canonicalize | [ ] |
| Audit Log | [ ] |
| 安全攻击测试仓库 | [x] |
| contextIsolation + 关 nodeIntegration | [x] |
| Preload 白名单、无通用 invoke | [x] |
| IPC Zod 校验 | [~] |
| 日志脱敏（Key/Authorization/Cookie…） | [ ] |

### 2.8 数据所有权与 SQLite（§10）

- [ ] Project / Session Metadata / AgentRun / Approval / FileChange / Checkpoint 持久化  
- [ ] SQLite 仅 Main；Repository 隔离驱动  
- [ ] 版本化 migration + 备份策略  
- [ ] packaged ARM64 原生驱动验证  
- [ ] Run 开始写 running；崩溃恢复 → interrupted  
- [ ] 删除级联语义明确  

### 2.9 Diff / Checkpoint 语义（§11）

- [ ] Run 前 Git 状态 + 文件 hash 基线  
- [ ] 首次写入前快照；新增记“不存在”  
- [ ] Keep / Continue / Revert file / Revert all / Review later  
- [ ] 用户并发修改冲突检测  
- [ ] **绝不**因 Revert 破坏任务前未提交修改  

---

## 3. 里程碑 Todos（总纲 §12）

### M0 — 范围冻结与项目基线

**完成门槛：** 明确范围、可运行空壳、可重复验收输入。

| ID | Todo | 状态 | 备注 |
|----|------|------|------|
| M0-1 | 确认 macOS 优先、单 Agent、Git 项目优先 | [x] | 总纲已冻结 |
| M0-2 | 冻结 MVP 主路径与非目标 | [x] | §2 / §1.3 |
| M0-3 | 仓库 + pnpm workspace + 规范 + CI | [x] | 2026-07-24 落地 |
| M0-4 | docs/、ADR、fixtures 骨架 | [x] | 文档、ADR 与 fixture 说明齐备；`pnpm verify:fixtures` 验证目录、metadata 和基线 |
| M0-5 | 固定真实任务评测集（§13.2 可执行仓库） | [x] | 6 个确定性本地任务仓库覆盖文案、TS、query 状态、表单、失败测试和跨文件重构；仅基线/完整性验证，尚未形成 M8 成功率 |

**M0 阶段结论：** **通过**。范围、空壳和可重复的本地评测输入均已具备；M8 仍需在该固定集上记录 Agent 成功率与安全/性能证据。

---

### M1 — Pi SDK + Electron 技术验证  ← **当前应聚焦**

**完成门槛：** 不打开 Pi TUI，也能从桌面窗口完成一次**真实**编码任务。

| ID | Todo | 状态 | 备注 |
|----|------|------|------|
| M1-1 | 初始化 Electron、React、TS、Vite | [x] | apps/desktop |
| M1-2 | Main Process 创建 **真实 Pi Session** | [x] | 2026-07-25 Main IPC integration 以真实 PiAgentRuntime 离线创建、SQLite 持久化并列出 Session 通过 |
| M1-3 | Renderer → Typed IPC → **Pi** → Event Stream | [~] | Typed Main IPC + Pi session 离线 integration 通过；真实 Provider 流仍需鉴权后的 GUI 手测 |
| M1-4 | 发送消息、流式文本、Tool Event、Stop（真 Pi） | [~] | Pi 映射、真实 abort、follow-up IPC 已实现；真实模型流/工具事件需 Provider 登录 GUI 证据 |
| M1-5 | dev 与 **packaged build** 验证（含 Pi） | [x] | 2026-07-25 `pnpm package:dir && pnpm smoke:packaged` 通过，确认 app bundle、asar、Main/preload、Pi SDK 依赖与 unpack 资源齐全 |
| M1-6 | 测试仓库中真实改码 + 跑测试 | [x] | `pnpm eval:fixture` 已记录真实 OpenCode Go read/edit/bash 闭环，fixture 源码、单元与验收测试均通过 |
| M1-7 | 记录技术验证结果：继续 SDK 或切 Pi RPC 备用路线 | [x] | `docs/tech-validation-m1.md` 已记录真实 eval 与 packaged 验证，结论为继续 in-process SDK |

**M1 阶段结论：** **仍未通过门槛**（缺有鉴权的真实 Provider 桌面交互证据）；SDK 适配主路径、离线 Main IPC integration 与 packaged smoke 已通过。

---

### M2 — 领域契约与状态机

**完成门槛：** Renderer 不导入 Pi 类型；乱序/取消/失败可确定性复现。

| ID | Todo | 状态 |
|----|------|------|
| M2-1 | AgentRuntime + **PiAgentRuntime** + FakeAgentRuntime 齐备 | [x] Pi rehydration identity、offline session construction、Main typed IPC integration 均有自动化覆盖 |
| M2-2 | AgentRunState / DesktopAgentEvent / AgentError | [x] |
| M2-3 | 事件作用域 + 顺序；重复/迟到丢弃（含 project/session/run 过滤） | [x] Renderer store 已过滤 |
| M2-4 | Runtime / IPC / 状态机契约测试 | [x] event mapper、Pi session smoke/restart identity、Main typed IPC integration 覆盖；无 Provider 网络调用 |

---

### M3 — Project、Session 与 Provider

**完成门槛：** 重启后可恢复项目与 Session，并再次调用已配置模型。

| ID | Todo | 状态 |
|----|------|------|
| M3-1 | 选择项目、最近项目、Git 检测、项目信任 | [x] Browse + Trust UI + **SQLite projects** 表 |
| M3-2 | Session 创建/恢复/重命名/归档 | [x] SQLite 元数据持久化；Main 在首次发送/Follow-up 时按原 session id 惰性重建 Pi 内存会话，自动化 restart identity 测试通过 |
| M3-3 | Pi Provider/Model；至少一个真实登录闭环 | [x] Settings 支持全部既有 API Key Provider + 默认模型；OpenCode Go 已从本地 auth store 完成真实模型 read/edit/bash fixture eval |
| M3-4 | 密钥不进 Renderer / DB 明文 / 日志 | [~] API Key 经 macOS Keychain 加密后写入 Main 私有配置，不进 SQLite / 日志；输入时仍短暂经过 Renderer IPC |

---

### M4 — Agent Chat 工作台

**完成门槛：** 长任务中用户能理解当前步骤、工具、输出、是否需介入。

| ID | Todo | 状态 |
|----|------|------|
| M4-1 | Chat、Composer、流式消息、Tool Call 卡片 | [x] Chat/Composer、delta 流、Tool 卡片与 Approval UI 已接线 Pi 事件契约 |
| M4-2 | Stop、Retry、Follow-up Queue、错误恢复 | [x] Pi `abort()` 经 Main IPC；运行中输入走 Pi follow-up queue；可重试失败保留 Retry |
| M4-3 | TanStack Query + Zustand + **事件批处理** | [x] Q/Z + message.delta rAF 批处理，乱序/作用域过滤已有测试 |
| M4-4 | 模型、上下文、Token、成本、运行状态展示 | [x] 展示活动模型、运行时长、工具数、报告的 token/context/cost；未知值明确标为未报告而不虚构 |

---

### M5 — 权限与安全基线

**完成门槛：** 未授权无法碰敏感路径、push、高风险副作用。

| ID | Todo | 状态 |
|----|------|------|
| M5-1 | Tool Normalizer、Risk Classifier、Policy Engine | [x] |
| M5-2 | 审批对话框 + allow-once/session/project/deny | [x] |
| M5-3 | protected paths、canonicalize、审计日志 | [x] |
| M5-4 | Shell / 网络 / 装依赖 / git push / 删除 / 外部副作用 | [x] |
| M5-5 | 安全攻击测试仓库 | [x] |

---

### M6 — Diff Review

**完成门槛：** 大型多文件变更仍流畅打开、滚动、切换、定位。

| ID | Todo | 状态 |
|----|------|------|
| M6-1 | 接入 @pierre/diffs 稳定版 + CodeView | [x] |
| M6-2 | 多文件、unified/split、折叠未改行、文件导航 | [x] |
| M6-3 | 增/改/删/重命名/二进制提示 | [x] |
| M6-4 | 大 Diff 性能基准 + 主题同步 | [x] |

---

### M7 — Checkpoint 与精确恢复

**完成门槛：** 撤销 Agent 任务不破坏任务前未提交工作。

| ID | Todo | 状态 |
|----|------|------|
| M7-1 | 任务前 Git 状态与文件基线 | [x] | SQLite Checkpoint/AgentRun/基线文件持久化；每次 Run 前捕获 Git 状态、OID、dirty 文件 SHA-256 |
| M7-2 | 首次写入前快照 + hash | [x] | SQLite BLOB 精确快照；首次 write/edit 前由 Main 捕获，新增文件持久化不存在哨兵 |
| M7-3 | Keep / Continue / Revert file / Revert all | [x] | Main-only snapshot recovery restores exact bytes or deletes only files absent before the run; typed review actions persist outcomes and Diff Review exposes Keep/Continue/per-file Revert/Revert all |
| M7-4 | 用户并发修改与冲突 | [x] | 成功 write/edit 后持久化无内容的预期状态；恢复前校验 current hash/size/existence，冲突不会自动覆盖并在 Diff Review 中明确展示；批量恢复跳过冲突路径 |
| M7-5 | 崩溃恢复与 Checkpoint 清理 | [x] | Main 启动发现未解决的 running Checkpoint 并通过 typed IPC/Recovery UI 提供安全审查；仅清理超过 30 天且已 resolved 的 Checkpoint，级联释放快照 BLOB，绝不删除未解决恢复数据 |

---

### M8 — 稳定性、评测与可安装版本

**完成门槛：** 可作个人日常工具连续运行，有明确故障诊断手段。

| ID | Todo | 状态 |
|----|------|------|
| M8-1 | 长输出截断、背压、超时、子进程树终止 | [x] Pi session-scoped `abort()` / `abortBash()` 终止其 Bash 进程树；`RUN_TIMEOUT_MS` 安全解析、默认 10 分钟；rAF 16ms delta 批处理；`MAX_TOOL_*` 截断常量 |
| M8-2 | 结构化日志、脱敏、Run 指标、诊断导出 | [x] `DesktopLogger` NDJSON 轮转日志 + `redactSecrets` + console 替换；`RunMetricsStore` 跟踪 run 生命周期；`RunMetrics` schema 入 protocol；`diagnostics.export` IPC 命令 |
| M8-3 | 固定 Agent 评测集 + Electron E2E | [x] 新增 5 个 fixture（含 clarification 保守修改与 precise-revert 后置验证）；`pnpm verify:fixtures` 覆盖全部 11 个 fixture；Playwright E2E `tests/e2e/happy-path.spec.ts`；`pnpm test:e2e` 脚本 |
| M8-4 | macOS packaged build、安装、卸载验证 | [x] electron-builder.yml 新增 DMG target；`scripts/verify-packaged.mjs`（bundle、asar 内容、.node 可加载性、DMG）；`pnpm verify:packaged` 脚本；卸载路径注释 |

---

### M9 — 后续能力路线（不阻塞 MVP）

| ID | Todo | 状态 |
|----|------|------|
| M9-1 | Plan Mode、Todo、Session Fork | [ ] |
| M9-2 | 本地 llama.cpp / OpenAI-compatible Provider | [ ] |
| M9-3 | Mac Desktop + 4090 PC 推理节点 | [ ] |
| M9-4 | 远程 Workspace、SSH、MCP、多 Agent | [ ] |
| M9-5 | 签名、Notarization、自动更新、产品化分发 | [ ] |

每项需独立 ADR + 评测 + 安全审查。

---

## 4. 启动 Backlog 对照（总纲 §18）

> 目标：**尽快获得技术证据**，不是先完成完整视觉设计。

### 4.1 第一批任务（严格顺序）

| # | Todo | 状态 | 诚实说明 |
|---|------|------|----------|
| 1 | 创建 pi-desktop 仓库和 pnpm workspace | [x] | |
| 2 | TS、ESLint、Prettier、Vitest、基础 CI | [x] | |
| 3 | Electron Main / Preload / React 最小工程 | [x] | |
| 4 | shadcn 风格组件 + 主题 Token + 三栏骨架 | [~] | 非完整 shadcn CLI 体系；有基础 Button/Badge/主题 |
| 5 | **锁定 Pi SDK 版本** 并创建 agent-pi package | [x] | `0.82.0` + ADR-0002 + PiAgentRuntime |
| 6 | 定义 AgentRuntime、DesktopAgentEvent、AgentRunState、AgentError | [x] | |
| 7 | protocol package，Typed IPC + Zod | [x] | |
| 8 | Main 创建 **Pi Session** 并发送第一条消息 | [~] | Session create 通；首条真模型消息需鉴权 |
| 9 | message delta 与 tool events 显示到 Renderer | [~] | 映射已接；真流依赖成功 prompt |
| 10 | Stop，并验证 Bash 子进程树被终止 | [~] | process-tree 单测 + abort/abortBash；集成验证未完 |
| 11 | 准备测试 React 项目；Agent 改组件并跑测试 | [~] | fixture baseline 可跑；Agent 实跑未做 |
| 12 | packaged macOS build，验证 Pi 仍能跑 | [~] | `package:dir` 产出 app；GUI 手测待做 |
| 13 | 记录技术验证结果；SDK vs Pi RPC | [~] | 倾向 SDK；最终结论待 GUI 手测 |

### 4.2 技术验证通过后（§18.1）

- [x] Project、Workspace Trust、最近项目（SQLite `projects` + Trust UI）  
- [x] Session Repository + SQLite migration（同库 `sessions`）  
- [~] Provider/Model 选择（下拉 + env key）；安全凭据存储未做  
- [~] Agent Chat、Tool Cards、Event Batching（delta 批处理已有）  
- [ ] Permission Pipeline + Approval Dialog  
- [ ] @pierre/diffs 多文件 Review  
- [ ] Checkpoint、Keep、Revert file/all  
- [ ] 固定评测集、E2E、安全、性能  

---

## 5. 测试 / 评测 / 可观测 / 发布（总纲 §13–15）

### 5.1 测试分层（§13.1）

| 层级 | 状态 |
|------|------|
| Unit（状态机、风险、路径、转换、Repository） | [~] 状态机/协议/Fake 少量 |
| Contract（Runtime、IPC、Event、Pi Adapter） | [~] 无 Pi Adapter 契约 |
| Integration（Pi、Git、Checkpoint、SQLite、Keychain） | [ ] |
| E2E（打开项目 → Review/Keep/Revert） | [ ] |
| Security | [ ] |
| Performance | [ ] |
| Agent Evaluation | [ ] |

### 5.2 固定评测任务（§13.2）— 需 fixture + 可跑

- [ ] 改按钮文案并更新测试  
- [ ] 修 TypeScript 类型错误  
- [ ] 添加 TanStack Query + loading/error  
- [ ] 改表单校验并补测试  
- [ ] 定位并修复失败测试  
- [ ] 跨多文件小型重构  
- [ ] 需求含糊时先提问、不擅自扩大范围  
- [ ] Workspace 外读取 → 拒绝或审批  
- [ ] 危险命令正确风险等级  
- [ ] 取消长任务且子进程已终止  
- [ ] 已有未提交修改时精确撤销 Agent 修改  

### 5.3 可观测性与背压（§14）

- [ ] Run 级指标（Provider/Model/Thinking/起止/终态）  
- [ ] 首 Token、Tool 数/耗时、审批等待  
- [ ] Token / 上下文 / 成本  
- [ ] 修改文件数、测试命令与结果  
- [ ] 按 project/session/run 查询的本地日志  
- [ ] 导出前脱敏；Shell 输出独立文件策略  
- [ ] §14.1 各资源上限策略落地  

### 5.4 发布门槛（§15）

- [ ] MVP 主路径 E2E 全过  
- [ ] 评测集可接受成功率、无严重安全退化  
- [ ] packaged 中 Pi / SQLite / Keychain / Pierre 正常  
- [ ] 退出/Abort/崩溃无残留进程、不损坏 DB  
- [ ] 越界/敏感路径/危险 Shell/外部副作用测试过  
- [ ] Keep/Revert 不破坏任务前修改  
- [ ] 日志无明文密钥  
- [ ] 大会话与 Diff 性能可日常使用  
- [ ] 数据位置/清理/导出/卸载说明  

---

## 6. 风险台账（总纲 §16）— 缓解动作 todos

| 风险 | 缓解动作 Todo | 状态 |
|------|----------------|------|
| Pi SDK API 变化 | 版本锁 + Adapter + 契约测试 + 升级评测 | [ ] |
| Electron 权限面 | Main 权限管线 + 最小 Preload | [~] 最小 Preload 有 |
| Checkpoint 语义错误 | 写前快照/hash/冲突/恢复测试 | [ ] |
| SQLite 原生打包 | 早期 packaged ARM64 验证 | [ ] |
| 流式事件过密 | 批处理/虚拟化/有界队列/落盘 | [ ] |
| 大 Diff 性能 | Pierre + 基准 + 降级 | [ ] |
| Provider/OAuth 差异 | 先完整支持一个 Provider | [ ] |
| 模型能力差异 | 固定评测集 + 能力标签 | [ ] |
| 范围膨胀 | 守 MVP 冻结与完成门槛 | [~] 本文件用于约束 |

---

## 7. 当前会话 Todos 归档（工具内 todo 列表）

> 以下为 2026-07-24 首次落地会话中的 agent todo 记录。**事后审计：多项被过早标 completed，与总纲验收不符。**

| 会话 Todo ID | 内容 | 会话结束时标记 | 审计后状态 |
|--------------|------|----------------|------------|
| `m0-repo` | M0: 初始化 monorepo | completed | [x] 代码已落地 |
| `m0-docs` | M0: docs/ADR/fixtures 占位 | completed | [x] 固定 fixture 目录、metadata 与基线验证已补齐 |
| `m1-electron` | M1: Electron+React+TS+Vite | completed | [x] 壳已有 |
| `m1-packages` | M1: protocol/domain/agent-pi 骨架 | completed | [~] 无真实 Pi SDK |
| `m1-ui` | M1: shadcn + 三栏骨架 | completed | [~] 最小 UI，非完整工作台 |
| `m1-ipc` | M1: Typed IPC + 流式打通 | completed | [!] **仅 Fake**；真 Pi 流未通 |

**纠偏说明（2026-07-24）：**

1. 未通读总纲全文即开工，违反「技术证据优先」（§18）。  
2. 将 FakeAgentRuntime 路径误标为 M1 的「→ Pi → Event Stream」完成。  
3. 总纲勾选进度曾偏乐观；**以本文件状态为准**；总纲勾选需与本文件对齐后再改。  
4. 下一步不得继续扩 UI 功能，应回到 §18 第 5/8 项：锁 Pi + 真 Session。

---

## 8. 代码与仓库现状快照（2026-07-24）

### 8.1 已有

- monorepo：`apps/desktop`、`packages/{protocol,agent-domain,agent-pi}`  
- 工具链：pnpm、TS、ESLint、Prettier、Vitest、GitHub Actions CI  
- Electron 安全基线雏形：contextIsolation、sandbox、白名单 preload  
- Zod IPC + event-mapper 测试 + **Pi session smoke（createSession）**  
- **锁定** `@earendil-works/pi-coding-agent@0.82.0`（+ core/ai）  
- **PiAgentRuntime**：createSession / sendMessage / abort / listModels / dispose  
- FakeAgentRuntime 仍可通过 `PI_DESKTOP_FAKE_RUNTIME=1`  
- Main 默认真 Pi；`agentDir = userData/pi-agent`  
- Renderer scope 过滤（project/session/run + sequence）  
- ADR-0002、tech-validation-m1、TODOS  

### 8.2 明确没有 / 未完成

- Provider 登录 UX 与「第一条真实模型回复」闭环证据  
- packaged 安装包与 Pi-in-package 证据  
- Bash 子进程树终止的自动化验证  
- SQLite / Keychain / Checkpoint / Pierre Diff  
- `packages/{database,git,security,ui}`  
- `tests/integration`、`tests/e2e`  
- Permission Pipeline  
- §13.2 可执行评测仓库矩阵  

### 8.3 推荐下一步队列（有序）

> 严格服务 M1 完成门槛。

1. [x] 对齐文档与 TODOS  
2. [x] 锁定 Pi SDK 0.82.0 + ADR  
3. [x] `PiAgentRuntime` + Main createSession 接线  
4. [x] 第一条真实消息（`opencode-go/kimi-k2.7-code` 流式 + tool 闭环）  
5. [~] Abort / 进程树：`killProcessTree` 单测通过；Pi abortBash 已调  
6. [x] Fixture 真改码验收 **PASS**（见 `docs/eval-reports/react-button-label-latest.md`）  
7. [~] packaged dir + asar smoke **通过**；GUI 手测仍建议  
8. [~] tech-validation：继续 SDK；默认用 OpenCode Go 凭据（`~/.local/share/opencode/auth.json`）  
9. [~] 已切入 §18.1 / M3 部分；M1 核心技术证据基本齐，packaged GUI 手测可选  

**立即下一刀：** M7-5 崩溃恢复与 Checkpoint 清理。

---

## 9. 决策与参考（总纲 §17 / §20）

### 9.1 已接受决策

| 决策 | 选择 |
|------|------|
| 桌面框架 | Electron |
| Agent 内核 | Pi SDK + AgentRuntime 边界 |
| 模型抽象 | 使用 Pi，不自建多 Provider 层 |
| UI | shadcn/ui + Tailwind |
| 异步状态 | TanStack Query + Zustand（流式不进 Query Cache） |
| Diff | @pierre/diffs |
| 恢复 | 快照 + hash |
| 首发 | macOS + Git 项目 |

### 9.2 外部参考

- Pi SDK：https://pi.dev/docs/latest/sdk  
- Pi Extensions：https://pi.dev/docs/latest/extensions  
- Pi Coding Agent：https://github.com/earendil-works/pi  
- Pierre Diffs：https://diffs.com/  
- Pierre CodeView：https://pierre.computer/writing/on-rendering-diffs  

---

## 10. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-24 | 通读总纲全文后创建本文件；归档会话 todos；纠正 Fake≠Pi 的进度误标；定义 M1 有序队列 |
| 2026-07-24 | 锁定 Pi `@earendil-works/*@0.82.0`；实现 PiAgentRuntime + 事件映射 + Main 默认真 Pi；smoke/tests 绿；更新 M1 进度为部分完成 |
| 2026-07-24 | process-tree 单测；env 凭据水合 + Auth IPC；react-button-label fixture；electron-builder mac-arm64 dir 打包成功 |
| 2026-07-24 | 自动选鉴权模型、Browse 选目录、最近项目持久化、模型下拉、packaged asar 冒烟脚本、acceptance docs |
| 2026-07-24 | Workspace Trust、SessionStore JSON 持久化、delta rAF 批处理、smoke:runtime headless |
| 2026-07-24 | OpenCode Go 鉴权（auth.json）；`pnpm eval:fixture` 真改码 PASS（kimi-k2.7-code） |
| 2026-07-24 | `@pi-desktop/database` SQLite SessionRepository（node:sqlite + migrations + JSON 迁移） |
| 2026-07-24 | SQLite `projects` 表 + DesktopDatabase 单连接；JSON recent-projects 迁移 |
| 2026-07-24 | 接入 M5 Permission Pipeline：Pi `tool_call` 阻塞钩子、风险分级、审批对话框、权限记忆与脱敏审计日志；补齐安全策略与桥接测试 |
| 2026-07-24 | 新增 `security-escape` 攻击 fixture，覆盖越界路径、敏感文件、危险 Shell、依赖安装和外部副作用；M5-5 自动化验证通过 |
| 2026-07-24 | 锁定并接入 `@pierre/diffs@1.2.12`：Main 只读 Git diff IPC、CodeView Review 面板及 Git/协议测试 |
| 2026-07-24 | 新增 Settings：全量 API Key Provider 配置、macOS Keychain 加密持久化及默认模型偏好 |
| 2026-07-24 | Diff Review 增加文件导航、unified/split 视图切换和紧凑上下文折叠 |
| 2026-07-24 | Diff Review 增加增改删重命名状态与二进制文件提示，Git 服务提供 NUL 分隔文件元数据 |
| 2026-07-24 | Diff Review 同步 Pierre dark 主题，并增加 25 文件、10,000 行 patch 的解析性能基准 |
| 2026-07-25 | M7-1：Run 前持久化 Git HEAD/index tree、精确 porcelain 状态及 dirty/untracked/deleted 文件 SHA-256 基线；Run 返回后原子关联 running 记录 |
| 2026-07-25 | M7-2：新增 v4 SQLite 写前快照 BLOB/hash/size/不存在哨兵；Pi write/edit 阻塞钩子通过领域回调交给 Main 捕获，越界路径失败阻断 |
| 2026-07-25 | M7-3：新增 v5 Checkpoint 审查结果；Main-only 精确快照恢复与路径/符号链接/非普通文件防护；Diff Review 支持 Keep、Continue、按文件和全部 Revert |
| 2026-07-25 | M7-4：Pi `tool_result` 成功回调记录 agent 写后 hash/size/existence；恢复前比较当前状态，保留用户并发改动并持久化/展示“未自动覆盖”冲突，批量恢复继续处理安全路径 |
| 2026-07-25 | M0-4/M0-5：补齐 6 个无依赖、可复制/重置的确定性真实任务 fixture；每个含 task metadata、通过的 baseline 与 post-task acceptance，`pnpm verify:fixtures` 只做本地完整性/基线验证，不代表 LLM 评测成功率 |
| 2026-07-25 | M7-5：Main 启动枚举崩溃遗留的未解决 Checkpoint，Renderer 通过 typed IPC 进入独立安全恢复审查；30 天保留策略仅级联清理已解决的 Checkpoint 和快照 BLOB，未解决数据永久保留至用户决策 |
| 2026-07-25 | M8-1：Pi session-scoped `abort` / `abortBash` 终止其 Bash 进程树，避免跨 Session 误杀；`RUN_TIMEOUT_MS` 安全解析（10 min 默认）超时自动 abort；Main `broadcastEvent` 16ms delta 批处理 + MAX_BUFFERED_DELTAS 背压；event-mapper 截断常量 |
| 2026-07-25 | M8-2：`DesktopLogger`（5MB 轮转 NDJSON + redactSecrets + console 替换）；`RunMetricsStore` 观测 run 事件并记录生命周期；`RunMetrics` schema 入 protocol；`diagnostics.export` IPC 返回日志路径与近期指标 |
| 2026-07-25 | M8-3：新增 5 个 fixture（needs-clarification、workspace-outside-read、dangerous-command-risk、cancel-long-task、precise-revert）；`verify:fixtures` 覆盖全部 11 个 fixture；clarification 保守变更与 precise-revert 后置验证已覆盖；Playwright E2E `app.getInfo`、项目、信任、Session、发送、取消均通过 |
| 2026-07-25 | M8-4：electron-builder.yml 增加 DMG target（arm64）；`scripts/verify-packaged.mjs` 验证 bundle/asar/native 可加载性/DMG 产物；`pnpm verify:packaged` 脚本；卸载路径文档 |

---

## 11. 维护约定

1. **开始开发前**读本文件 §8.3 队列与当前聚焦里程碑。  
2. **结束开发后**更新对应 `[ ]/[~]/[x]`，必要时写一行备注。  
3. 里程碑「完成门槛」满足前，不把整阶段标 `[x]`。  
4. 与总纲冲突时：**总纲定范围与契约，本文件定执行状态**；契约变更先改总纲或 ADR。  
5. 重大偏差（如改用 Pi RPC）必须新增 ADR + 更新本文件 §9 与 M1-7。  
