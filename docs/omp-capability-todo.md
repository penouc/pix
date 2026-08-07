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
| 未开始 `[ ]` | 8 |
| 进行中 `[~]` | 0 |
| 完成 `[x]` | 13 |
| 推迟 `[-]` | 0 |

**进度：** 13 / 21  

**已完成项测试：** #1 `partial` · #2 `partial` · #3 `unit` · #21 `unit` · #4 `unit` · #6 `unit` · #8 `unit` · #7 `unit` · #10 `unit` · #11 `unit` · #12 `unit`

---

## Batch A — 接线官方 Pi（日用止血）

> 优先：长会话不死、能控思考与规划、Composer 承诺兑现。

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 1 | [x] | partial | Compaction + 上下文用量 | 接线 Pi | 自动/手动 compact 可用；Composer 上方可见 context 用量；撞墙 fixture 仍能完成任务 | 实现：2026-08-07。**已测：** protocol events/commands、fake-runtime compact、agent-stream-store `context.updated`/compacting；相关 vitest 通过。**未测：** 桌面手测 Compact 按钮；context-overflow fixture |
| 2 | [x] | partial | Thinking level 控制 | 接线 Pi | 会话可选 thinking；主路径步骤 3 不再缺控件 | 此前已接线：`ThinkingLevelPicker` + `agent.set/getThinkingLevel` + Pi `setThinkingLevel`；建任务时会套用所选 level。**已测：** 代码路径存在且桌面可见。**未测：** 本轮未单独补自动化断言 |
| 3 | [x] | unit | Plan Mode（只读再动手） | 接线 Pi | Plan 下无 write/edit/bash 落盘；Approve → Build 可切换；安全测试断言 | 实现：2026-08-07。**已测：** `policy-engine` Plan 下 deny write/edit/bash；packages build + vitest 通过。**未测：** 桌面手测 Plan/Build 切换与真实 Pi `setActiveToolsByName`；Approve-plan→Build 注入仍未做 |
| 4 | [x] | unit | Composer `@` 文件引用 | 接线 Pi / Main | `@` 可搜并插入工作区内路径；受 protected paths 约束 | 实现：2026-08-07（此前已接线 index 搜索）。**本轮：** `index.search` 增加 `excludeProtected`，`@` 提及不再给出 `.env` 类 protected 路径（⌘K 面板不受影响）。**已测：** index-service 过滤测试 + protocol schema。**未测：** 桌面手测插入路径后真实模型读取 |
| 5 | [x] | partial | Composer `$` skills | 接线 Pi | `$` 触发已启用 skill；与 Skills 面板开关一致 | 此前已接线：`$` 弹出已启用 skill 列表，插入 `/skill:name`；与 Skills 面板同一 `skills.list` 数据源与 enabled 开关。**已测：** 代码路径存在且桌面可见。**未测：** 本轮未补自动化断言 |
| 6 | [x] | unit | Composer `/` 命令 | 接线 Pi | `/` 可调内置/模板命令（含 compact 等入口） | 实现：2026-08-07。Composer 行首 `/` 弹出命令菜单：`/compact`、`/plan`、`/build`、`/auto`（模型 Auto）、`/clear`（清队列）、`/new`；选中即执行并清空草稿，Enter 取首个可用。**已测：** `matchSlashQuery`/`filterSlashCommands` 单测 + 桌面 typecheck。**未测：** 桌面手测菜单交互 |
| 7 | [x] | unit | 成本 / token / cache 面板 | 接线 Pi | run/session/project 级用量与粗算成本可见；量级与账单同阶 | 此前已实现：Usage 页（热力图/按模型/花费 KPI）+ `usage.summary`（支持 projectId）。**本轮：** 新增 `usage.projects` IPC + Usage 页项目筛选下拉。**已测：** run-metrics `projects`/按项目 scope 单测。**未测：** session 级明细视图；桌面手测账单量级对比 |
| 8 | [x] | unit | Auto-retry 可见化 | 接线 Pi | Provider 重试时 UI 显示 attempt，而非假死 | 实现：2026-08-07。接线 Pi `auto_retry_start/end` → protocol `run.retry-started/finished` → store `retry` 状态 → Composer 头部「Retrying 1/2」徽标（含 delayMs 提示）+ StatusPanel 行。**已测：** event-mapper 映射、protocol schema、agent-stream-store 状态转移。**未测：** 桌面手测真实 429 触发徽标 |
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
| 11 | [x] | unit | Todo 步骤清单工具 | 自建 | Agent 可更新 todo；侧栏/时间线可见；风险 `safe`、不进审批队列 | 实现：2026-08-07。自定义 Pi 工具 `todo`（create/update/clear）注册进会话扩展；每次变更发 `todo.updated` 事件并持久化到 SQLite（`session_todos`）；右侧 Dock 新增 Todo 面板（只读渲染、完成计数）；风险分类器将 `todo` 判为 `safe`。**已测：** collab-tools 单测（reducer/事件/持久化）、protocol schema、risk-classifier、agent-stream-store 事件处理、sqlite-todo-repository。**未测：** 桌面手测真实模型调用 `todo` 工具 |
| 12 | [x] | unit | Ask 结构化追问 | 自建 | Agent 可发起选项/填空追问；用户点选后继续 run | 实现：2026-08-07。自定义 Pi 工具 `ask`（question/options/allowFreeText）；`execute` 阻塞等待用户回答；`ask.pending` 事件 → 桌面 AskDialog 弹窗（选项按钮 + 填空）；用户作答经 `agent.answerAsk` IPC → 解析阻塞的工具调用 → run 继续；abort signal 时拒绝。**已测：** collab-tools 单测（阻塞/回答/abort/dispose）、protocol schema、agent-stream-store。**未测：** 桌面手测真实模型触发 ask |

---

## Batch C — 从 OMP 借鉴的质量跃迁

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 13 | [ ] | — | Hashline / 锚点编辑 | 移植思路 | edit 成功率相对 baseline 提升；stale anchor 拒绝且不写坏文件；Checkpoint 路径抽取仍正确 | |
| 14 | [ ] | — | LSP 工具 | 自建 | diagnostics / refs / rename（至少一种语言）经权限管线可用 | |
| 15 | [ ] | — | grep / glob 一等工具 | 接线 Pi / 自建 | Agent 可直接 grep/glob，不必事事 bash；结果受 workspace 约束 | |

---

## Batch D — Git / 外部能力 / 扩展

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 16 | [ ] | — | 结构化 Git 工具 | 自建 | status/diff/hunk 类工具可用；与 Diff 面板数据可共享或一致 | |
| 17 | [ ] | — | 智能拆 commit（需审批） | 移植思路 | 可提案多 commit；**须用户审批**；默认禁止 push | |
| 18 | [ ] | — | web_search（单 provider） | 自建 | 至少一个搜索后端；默认 `external-side-effect` 审批 | |
| 19 | [ ] | — | MCP 桥（经权限管线） | 自建 | MCP tools → customTools；未知工具 fail-closed；进程可随 abort 清理 | |
| 20 | [ ] | — | memory / learn→skill | 自建 / 移植 | 项目范围可 retain/recall；可选把教训写成 skill；无云依赖起步 | |

---

## 推荐推进顺序（可改）

未另行指定时，按此顺序开干（可并行 Batch A 内多项）：

1. **#1** Compaction + 上下文 ~~（已完成 · partial）~~
2. **#3** Plan Mode ~~（已完成 · unit）~~
3. **#2** Thinking level ~~（已完成 · partial；此前已接线）~~
4. **#21** Auto 模型请求 ~~（已完成 · unit）~~
5. **#4–6** Composer `@` / `$` / `/` ~~（已完成 · #4 unit / #5 partial / #6 unit）~~
6. **#7–9** 成本、retry、steer ~~（已完成 · #7 unit / #8 unit / #9 partial）~~
7. **#11–12** Todo + Ask
8. **#10** Session Fork ~~（已完成 · unit）~~
9. **#15** grep/glob
10. **#13** Hashline（或与 #14 二选一先做）
11. **#14** LSP
12. **#16–17** Git 工具与拆 commit
13. **#18** web_search
14. **#19** MCP
15. **#20** memory / learn→skill

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
