# OMP 借鉴能力 — 进度 Todo

> **能力说明（为什么做、路径、粗估）：** [`omp-capability-borrow.md`](./omp-capability-borrow.md)  
> **总工程账本：** [`TODOS.md`](./TODOS.md)  
> **本文件职责：** 跟踪紧急可选池的完成状态与测试状态；会话结束时更新勾选。  
> **策略：** 不换 `@oh-my-pi` 内核；接线官方 Pi / 自建 / 移植思路。  
> **范围：** 原 20 条 + **#21 Auto 模型请求**；按批次推进，不必一次做完。  
> **Last updated:** 2026-08-07

---

## 状态图例

### 实现状态

| 标记 | 含义 |
|------|------|
| `[ ]` | 未开始 |
| `[~]` | 进行中 / 部分完成（不能当整项验收通过） |
| `[x]` | 完成，且满足下方「完成标准」 |
| `[-]` | 明确推迟或取消（须在备注写原因） |

### 测试状态（仅对已完成 / 进行中项填写）

| 标记 | 含义 |
|------|------|
| `—` | 尚未实现，不测 |
| `unit` | 已有自动化单测 / 协议测，通过 |
| `manual` | 已在桌面 App 里手测通过 |
| `partial` | 自动化有一部分，或手测未覆盖完成标准里的关键项 |
| `fail` | 测过但失败，阻塞验收 |
| `untested` | 已实现但**尚未**跑相关测试 |

完成项建议至少到 `unit`；发版前尽量补 `manual`。

---

## 总览

| 状态 | 数量 |
|------|------|
| 未开始 `[ ]` | 0 |
| 进行中 `[~]` | 0 |
| 完成 `[x]` | 21 |
| 推迟 `[-]` | 0 |

**进度：** 21 / 21  

**已完成项测试：** #1 `partial` · #2 `partial` · #3 `unit` · #21 `unit` · #4 `unit` · #6 `unit` · #8 `unit` · #7 `unit` · #10 `unit` · #11 `unit` · #12 `unit` · #13 `unit` · #14 `unit` · #15 `unit` · #16 `unit` · #17 `unit` · #18 `unit` · #19 `unit` · #20 `unit`

---

## Batch A — 接线官方 Pi（日用止血）

> 优先：长会话不死、能控思考与规划、Composer 承诺兑现。

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 1 | [x] | partial | Compaction + 上下文用量 | 接线 Pi | 自动/手动 compact 可用；Composer 上方可见 context 用量；撞墙 fixture 仍能完成任务 | 实现：2026-08-07。**已测：** protocol events/commands、fake-runtime compact、agent-stream-store `context.updated`/compacting；相关 vitest 通过。**未测：** 桌面手测 Compact 按钮；context-overflow fixture |
| 2 | [x] | partial | Thinking level 控制 | 接线 Pi | 会话可选 thinking；主路径步骤 3 不再缺控件 | 此前已接线：`ThinkingLevelPicker` + `agent.set/getThinkingLevel` + Pi `setThinkingLevel`；建任务时会套用所选 level。**已测：** 代码路径存在且桌面可见。**未测：** 本轮未单独补自动化断言 |
| 3 | [x] | unit | Plan Mode（只读再动手） | 接线 Pi | Plan 下无 write/edit/bash 落盘；Approve → Build 可切换；安全测试断言 | 实现：2026-08-07。**已测：** `policy-engine` Plan 下 deny write/edit/bash；packages build + vitest 通过。Approve → Build：`pendingPlan` 卡片 + `approvePlan` 已接线。**未测：** 桌面手测 Plan/Build 与真实 Pi `setActiveToolsByName` |
| 4 | [x] | unit | Composer `@` 文件引用 | 接线 Pi / Main | `@` 可搜并插入工作区内路径；受 protected paths 约束 | 实现：2026-08-07（此前已接线 index 搜索）。**本轮：** `index.search` 增加 `excludeProtected`，`@` 提及不再给出 `.env` 类 protected 路径（⌘K 面板不受影响）。**已测：** index-service 过滤测试 + protocol schema。**未测：** 桌面手测插入路径后真实模型读取 |
| 5 | [x] | partial | Composer `$` skills | 接线 Pi | `$` 触发已启用 skill；与 Skills 面板开关一致 | 此前已接线：`$` 弹出已启用 skill 列表，插入 `/skill:name`；与 Skills 面板同一 `skills.list` 数据源与 enabled 开关。**已测：** 代码路径存在且桌面可见。**未测：** 本轮未补自动化断言 |
| 6 | [x] | unit | Composer `/` 命令 | 接线 Pi | `/` 可调内置/模板命令（含 compact 等入口） | 实现：2026-08-07。Composer 行首 `/` 弹出命令菜单：`/compact`、`/plan`、`/build`、`/auto`（模型 Auto）、`/clear`（清队列）、`/new`；选中即执行并清空草稿，Enter 取首个可用。**已测：** `matchSlashQuery`/`filterSlashCommands` 单测 + 桌面 typecheck。**未测：** 桌面手测菜单交互 |
| 7 | [x] | unit | 成本 / token / cache 面板 | 接线 Pi | run/session/project 级用量与粗算成本可见；量级与账单同阶 | 此前已实现：Usage 页（热力图/按模型/花费 KPI）+ `usage.summary`（支持 projectId）。**本轮：** 新增 `usage.projects` IPC + Usage 页项目筛选下拉。**已测：** run-metrics `projects`/按项目 scope 单测。**未测：** session 级明细视图；桌面手测账单量级对比 |
| 8 | [x] | unit | Auto-retry 可见化 | 接线 Pi | Provider 重试时 UI 显示 attempt，而非假死 | 实现：2026-08-07；**修复 2026-08-07：** `agent_end.willRetry` 时不发 `run.completed`、不清除 `activeRunId`，以便 `auto_retry_*` 与续跑事件到达 UI。**已测：** event-mapper willRetry 抑制 + retry 映射、protocol schema、agent-stream-store。**未测：** 桌面手测真实 429 |
| 9 | [x] | partial | Steer 队列 UI | 接线 Pi | steer/followUp 策略可配；待发队列可看可清 | 此前已接线：运行中 Queue/Steer 分段切换、QueuePanel（可见/编辑/发送/清空）、agent.steer IPC。**已测：** 代码路径存在且桌面可见；store 队列单测在。**未测：** 本轮未补自动化断言 |
| 10 | [x] | unit | Session Fork | 接线 Pi | 可从历史 user message 分叉；不复制 Checkpoint BLOB；冲突检测仍有效 | 实现：2026-08-07。接线 Pi `getUserMessagesForForking` + `navigateTree`（原位回卷，不复制 Checkpoint）；协议 `agent.forkPoints`/`agent.forkSession`；Main 侧删除过期的 session_messages 行使 `session.messages` 回落到回卷后的 Pi 分支；UI：输入框上方工具栏「Fork」按钮 → 分叉点列表 → 二次确认 → 回卷并把该消息放回输入框。**已测：** fake-runtime fork 流、protocol 命令、`deleteBySession` 仓库测试。**未测：** 桌面手测真实会话回卷与分支摘要 |
| 21 | [x] | unit | **Auto 模型请求**（自动选模 / 角色路由 / fallback） | 接线 Pi + 产品化 | 见下方专条 | 实现：2026-08-07。**已测：** `auto-model` 单测 12 条（角色链派生、fallback 去重、auth 跳过、错误分类）+ pi-runtime run 循环 auto-switch 断言 + protocol 事件/命令 + provider-settings 持久化 + agent-stream-store `model.auto-switched` 系统消息。**未测：** 桌面手测真实 Provider 429 触发换模；AutoModelSection 表单手测 |

### #21 专条 — Auto 模型请求

用户在模型选择器里可选 **Auto**（或不指定具体模型），由系统代发请求：

1. **代选：** 有可用凭证时自动挑默认/合适模型（扩展现有 `pickDefaultModel`）
2. **角色路由：** 至少支持 `default` + `plan`/`fast`（或 smol）两档；Plan Mode / 重任务可走强模，打杂走便宜模（对齐 Pi `scopedModels` / OMP `modelRoles`）
3. **失败 fallback：** 429 / 超时 / 配额用尽时按链换下一模型，并在 UI 可见（与 #8 retry 配合，但换的是**模型**而不只是重试同模）
4. **可解释：** 每次 run 能看出实际用了哪个 provider/model（成本面板 #7 可复用）

完成标准：Composer 有 Auto 选项；Auto 下能完成一轮真实 prompt；可配置至少一条 fallback；日志/UI 能区分「审批 Auto」与「模型 Auto」。

---

## Batch B — 自建小工具（协作与可跟踪）

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 11 | [x] | unit | Todo 步骤清单工具 | 自建 | Agent 可更新 todo；侧栏/时间线可见；风险 `safe`、不进审批队列 | 实现：2026-08-07；**修复 2026-08-07：** `agent.listTodos` 在会话未 hydrate 时回落 SQLite，重启后侧栏可 seed。**已测：** collab-tools、protocol、risk-classifier、store、sqlite-todo-repository。**未测：** 桌面手测真实模型调用 `todo` |
| 12 | [x] | unit | Ask 结构化追问 | 自建 | Agent 可发起选项/填空追问；用户点选后继续 run | 实现：2026-08-07；**修复 2026-08-07：** 跨会话保留 `ask.pending`；离开任务时自动取消孤儿 ask，避免 run 永久阻塞。**已测：** collab-tools、protocol、agent-stream-store。**未测：** 桌面手测真实模型触发 ask |

---

## Batch C — 从 OMP 借鉴的质量跃迁

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 13 | [x] | unit | Hashline / 锚点编辑 | 移植思路 | edit 成功率相对 baseline 提升；stale anchor 拒绝且不写坏文件；Checkpoint 路径抽取仍正确 | 实现：2026-08-07。自定义 `edit` 工具覆盖 Pi 内置（扩展工具按同名覆盖内置——已验证 SDK 注册表合并逻辑），保留 exact-once 契约并叠加 hashline：`lineHash` 按行 sha256 锚点（同名文本重复时仍唯一、抗空白/引号漂移）、`oldHash` 全文件 sha256 陈旧校验（自上次读取后文件变了就拒绝）、全量先验证后落盘（一个坏锚点整个拒绝，绝不半写）、保留 CRLF/末尾换行。新增 `hash_lines` 工具给模型提供行哈希与文件哈希（只读、`safe`）。工具名仍为 `edit`，Checkpoint 快照/权限（workspace-write）/Plan Mode 阻断全部不变；`lsp_rename` 也纳入 checkpoint 路径抽取。**已测：** hashline-edit 16 条（stale 拒绝/lineHash/歧义/重叠/原子性/CRLF）、risk-classifier、writeToolPath。**未测：** 桌面手测真实模型编辑成功率对比 |
| 14 | [x] | unit | LSP 工具 | 自建 | diagnostics / refs / rename（至少一种语言）经权限管线可用 | 实现：2026-08-07。基于 TypeScript 进程内语言服务（无需外部 LSP server）：`lsp_diagnostics`（语法+类型错误）、`lsp_references`（跨文件引用）、`lsp_rename`（跨文件改名并写回）。权限管线：diagnostics/references 只读=`safe`；rename 改写文件=`workspace-write`（ask 模式需审批，Plan Mode 阻断）；Plan Mode 保留只读 LSP 工具。**已测：** lsp-tools 7 条（真实 TS fixture 项目：错误诊断、跨文件引用、改名+import 重写）、policy-engine Plan 阻断、risk-classifier、writeToolPath。**未测：** 桌面手测真实模型调用 |
| 15 | [x] | unit | grep / glob 一等工具 | 接线 Pi / 自建 | Agent 可直接 grep/glob，不必事事 bash；结果受 workspace 约束 | 实现：2026-08-07；**修复 2026-08-07：** Plan→Build 回退白名单改为完整 `DEFAULT_SESSION_TOOLS`（含 grep/find/ls 与自建工具），避免空/旧快照丢掉工具。**已测：** pi-session.smoke、risk-classifier。**未测：** 桌面手测真实模型是否改用 grep |

---

## Batch D — Git / 外部能力 / 扩展

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 16 | [x] | unit | 结构化 Git 工具 | 自建 | status/diff/hunk 类工具可用；与 Diff 面板数据可共享或一致 | 实现：2026-08-07。`git_status` / `git_diff` / `git_log` 自定义工具（`execFile`，无 shell）；解析对齐 Diff 面板的 porcelain / numstat 思路。hunk 级查看走 `git_diff` 全量 patch（无独立 `git_hunk`）。风险 `safe`；Plan Mode 可用。**已测：** git-tools 单测 + risk/policy + session smoke。**未测：** 桌面手测真实模型调用 |
| 17 | [x] | unit | 智能拆 commit（需审批） | 移植思路 | 可提案多 commit；**须用户审批**；默认禁止 push | 实现：2026-08-07。`git_commit`（本地 stage+commit，拒绝 push）；配合 `ask` 提案多 commit；风险 `workspace-write`；Plan Mode 阻断。**已测：** git-tools commit 单测 + risk/policy。**未测：** 桌面手测多 commit 审批流 |
| 18 | [x] | unit | web_search（单 provider） | 自建 | 至少一个搜索后端；默认 `external-side-effect` 审批 | 实现：2026-08-07。`web_search`（DuckDuckGo HTML 起步）；风险 `external-side-effect`；Plan Mode 阻断。**已测：** web-search 单测 + risk/policy。**未测：** 桌面手测真实搜索 |
| 19 | [x] | unit | MCP 桥（经权限管线） | 自建 | MCP tools → customTools；未知工具 fail-closed；进程可随 abort 清理 | 实现：2026-08-07。`.pi-desktop/mcp.json` → `McpBridge` stdio 客户端；工具名 `mcp__{server}__{tool}`；未知调用 fail-closed；`dispose` 关 client/子进程；风险 `sensitive`；Plan Mode 阻断。**已测：** mcp-bridge 单测 + fixture server + risk/policy。**未测：** 桌面手测真实 MCP server |
| 20 | [x] | unit | memory / learn→skill | 自建 / 移植 | 项目范围可 retain/recall；可选把教训写成 skill；无云依赖起步 | 实现：2026-08-07。`memory`（retain/recall/forget → `.pi-desktop/agent/memory.json`）；`learn` 写 `.pi/skills`；recall=`safe`，其余 `workspace-write`；Plan 仅允许 recall。**已测：** memory-tools 单测 + risk/policy。**未测：** 桌面手测 |

---

## 推荐推进顺序（可改）

未另行指定时，按此顺序开干（可并行 Batch A 内多项）：

1. **#1** Compaction + 上下文 ~~（已完成 · partial）~~
2. **#3** Plan Mode ~~（已完成 · unit）~~
3. **#2** Thinking level ~~（已完成 · partial；此前已接线）~~
4. **#21** Auto 模型请求 ~~（已完成 · unit）~~
5. **#4–6** Composer `@` / `$` / `/` ~~（已完成 · #4 unit / #5 partial / #6 unit）~~
6. **#7–9** 成本、retry、steer ~~（已完成 · #7 unit / #8 unit / #9 partial）~~
7. **#11–12** Todo + Ask ~~（已完成 · #11 unit / #12 unit）~~
8. **#10** Session Fork ~~（已完成 · unit）~~
9. **#15** grep/glob ~~（已完成 · unit）~~
10. **#13** Hashline ~~（已完成 · unit）~~
11. **#14** LSP ~~（已完成 · unit）~~
12. **#16–17** Git 工具与拆 commit ~~（已完成 · unit）~~
13. **#18** web_search ~~（已完成 · unit）~~
14. **#19** MCP ~~（已完成 · unit）~~
15. **#20** memory / learn→skill ~~（已完成 · unit）~~

---

## 会话更新日志

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 建档；20 条全部纳入，状态均为未开始 |
| 2026-08-07 | 新增 **#21 Auto 模型请求**；进度改为 0/21；推荐顺序提前到 Plan Mode 之后 |
| 2026-08-07 | **#1 完成**：compaction/context 接线（协议 + agent-pi + Main IPC + Composer Compact/gauge）；测试=`partial` |
| 2026-08-07 | **#3 完成**：Plan/Build 模式（工具集切换 + 安全 fail-closed + Composer 切换器）；测试=`unit` |
| 2026-08-07 | 表格增加「测试」列与测试状态图例；总览增加已完成项测试摘要 |
| 2026-08-07 | **#2 标记完成**：Thinking level 此前已接线（Picker + IPC + Pi）；测试=`partial` |
| 2026-08-07 | **#21 标记完成**：Auto 模型路由（代选 + 角色路由 + fallback）已实现并有 12 条单测；测试=`unit` |
| 2026-08-07 | **#4 完成**：`@` 提及增加 protected-paths 过滤（`index.search excludeProtected`）；测试=`unit` |
| 2026-08-07 | **#5 标记完成**：`$` skills 此前已接线；测试=`partial` |
| 2026-08-07 | **#6 完成**：Composer `/` 命令菜单（compact/plan/build/auto/clear/new）；测试=`unit` |
| 2026-08-07 | **#8 完成**：接线 Pi `auto_retry_start/end`，UI 显示重试 attempt；测试=`unit` |
| 2026-08-07 | **#9 标记完成**：Steer 队列 UI 此前已接线；测试=`partial` |
| 2026-08-07 | **#7 完成**：Usage 页增加项目筛选（`usage.projects` IPC + 下拉）；测试=`unit` |
| 2026-08-07 | **#10 完成**：Session Fork（`agent.forkPoints`/`agent.forkSession` + 工具栏 Fork 菜单 + 回卷）；测试=`unit` |
| 2026-08-07 | 发版 **v0.2.3**；同步 `omp-capability-borrow.md` 紧急池勾选（#1–10、#21 → `[x]`） |
| 2026-08-07 | **#11 完成**：`todo` 自定义工具（create/update/clear）+ `todo.updated` 事件 + SQLite 持久化 + Dock Todo 面板；风险 `safe`；测试=`unit` |
| 2026-08-07 | **#12 完成**：`ask` 自定义工具（选项/填空，阻塞式）+ `ask.pending/resolved` 事件 + AskDialog；`agent.answerAsk` 解析后 run 继续；测试=`unit` |
| 2026-08-07 | **#13 完成**：hashline `edit` 覆盖 Pi 内置（lineHash 锚点 + oldHash 陈旧校验 + 全量原子应用）+ `hash_lines` 工具；测试=`unit` |
| 2026-08-07 | **#14 完成**：TS 进程内语言服务 LSP 工具（diagnostics/references/rename），rename 走 workspace-write 审批、Plan 阻断；测试=`unit` |
| 2026-08-07 | **#15 完成**：修复 grep/find/ls 默认未启用（`createAgentSession` 全量工具白名单）+ `listActiveTools` 可见性；测试=`unit` |
| 2026-08-07 | **审计修复**：#8 `willRetry` 不误发 completed；#11 listTodos SQLite 回落；#12 跨会话 ask 不孤儿；#15 Plan→Build 全量工具回退；#3 备注更正 Approve→Build 已接线 |
| 2026-08-07 | **#16–20 完成（Batch D）**：Git 工具 + `git_commit`、`web_search`、MCP 桥、`memory`/`learn` 接入会话白名单与权限管线；进度 21/21；测试=`unit` |
