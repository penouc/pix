# ADR-0003：Automations 支持完整无人值守（可写 + 自动审批）

- **状态：** Accepted
- **日期：** 2026-07-26
- **相关：** 总纲 §9（权限与安全模型）、§4.1 A5、§24.2、`docs/TODOS.md` M5

## 背景

`Loam Desktop.dc.html` v2 设计新增 Automations 屏幕：自动化按触发器（定时 / 事件）
自行开启 Agent 任务，每条自动化带一个 approval mode。

总纲 §4.1 A5 的原文契约是「权限判定在 Main Process 完成；Renderer 只负责呈现审批
和提交用户选择」，隐含前提是**每个 elevated 操作都有人做决定**。无人值守运行与该
前提冲突：定时触发时没有人在键盘前。

实现前已向用户明确说明该冲突与三个可选档位（仅手动 Run now / 定时 + 只读 /
完整无人值守）。用户明确选择**完整无人值守（可写 + 自动审批）**。本 ADR 记录这一
决定、它放弃了什么、以及保留了哪些不可协商的底线。

## 决策

每条自动化带 `approvalMode`，取值与语义：

| mode | 行为 |
|------|------|
| `ask` | 每个 elevated 调用都等人决定；无人值守时该 run **会停住**，UI 明确说明 |
| `auto-reads` | 只读工具本来就被 policy engine 判为 safe 自动放行；写/bash 仍等人 → 同样会停住 |
| `read-only` | 调度器对该 run 的所有审批请求**自动 deny** |
| `unattended` | 调度器对该 run 的审批请求**自动 allow-once** |

## 保留的底线（不因 unattended 而放宽）

1. **policy engine 的 `deny` 不受影响。** 受保护路径（`.env`、`.git/**`、`~/.ssh/**`
   等）、越出 workspace 的路径、`git push` 与其它 external-side-effect 类操作，在
   policy engine 阶段就是 `deny`，**根本不会变成审批请求**，因此自动审批看不到它们，
   也无法放行。自动审批只作用于「本来要问人」的那一类。
2. **Workspace Trust 不被绕过。** 自动化启动前检查 `project.trusted`，未信任直接抛错。
3. **每个自动决定都写审计。** `AutomationScheduler.recordAudit` → 结构化日志，含
   automationId、mode、decision、summary；`PermissionPipeline` 自身的 audit 链路不变。
4. **不在启动时补跑。** 调度器 `start()` 不做 catch-up；崩溃循环不会反复触发写操作。
   只有 tick 到点或用户点 Run now 才运行。
5. **Checkpoint 语义不变。** 自动化开的是一个普通 session/run，写前快照、冲突检测、
   Keep/Revert 全部照常，因此无人值守产生的修改**可被精确撤销**。
6. **只有存在已启用自动化时才启动调度器。**

## 放弃了什么

- 「每个 elevated 操作都有人决定」不再全局成立。在 `unattended` 模式下，
  workspace 内的写入与 workspace 内的 bash 会在无人在场时被自动批准。
- 因此 `unattended` 的风险等价于「把一个 CI job 的权限交给模型」：它可以改你的工作
  树、跑你的测试与构建。它**不能**碰受保护路径、不能越界、不能 push。

## 触发器

| trigger | 语义 |
|---------|------|
| `manual` | 只能点 Run now |
| `interval` | 每 N 分钟（最小 5，最大 14 天） |
| `daily` | 每天本地时间某一分钟 |
| `event` (`run-completed`) | **你自己**发起的 run 结束后触发 |

`event` 触发器带强制递归保护：自动化自己开的 run 结束时**不会**再触发 event 自动化
（`runOrigins` 记录 run 归属），否则两条 event 自动化会互相触发形成死循环。

**错过的时间片不补跑。** 超过 1 小时的时间片视为 missed 并跳过：中午唤醒机器不应触发
昨晚 02:00 的自动化。

## 实现中修正的三个缺陷（2026-07-26）

1. **失败启动会留下 stale session claim（安全）。** `claimSession` 在 `sendMessage`
   之前调用；若启动抛错而不释放，该 sessionId 的 claim 会永久残留 —— 之后**用户自己**在
   该 session 里的操作会被这条已死自动化的 mode 自动裁决（`unattended` 下即静默批准用户
   自己的写入）。现在启动失败路径显式释放 claim，并有回归测试。
2. **`running` 释放过早。** 原先在 run *启动*后就释放，导致连点 Run now 或下一个 tick
   会重复启动同一条自动化。现在持有到 run *结束*。
3. **从不记录结果。** `recordRun` 只在启动时写摘要，"Last run" 永远不告诉你成功与否。
   现在 `handleRunFinished` 把 `completed / failed / cancelled` 写回。

## 后续

- 更好的 `read-only` 实现是用 Pi 的 `setActiveToolsByName` + `createReadOnlyTools`
  直接不给写工具，而不是靠自动 deny 兜底（见总纲 §24.2 Plan Mode 的同一机制）。
- 自动化定义目前存 Main 私有 JSON；迁到 SQLite `automations` 表是 §26.2 的 v6。
- 需要补的评测 fixture：`automation-unattended-floor` —— 断言 unattended 模式下受保护
  路径 / 越界 / push 仍被拒绝且写入审计。
