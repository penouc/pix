# DeepSeek Harness 能力借鉴清单

> 来源：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，developer preview）  
> 策略：**不换内核**（继续 `@earendil-works/pi` + Electron），把 dsh 当 harness 设计雷达；能接线的接线，值得学的学交互/算法，重的自建并走 PiX 权限、Checkpoint、Workspace Trust。  
> 对照：[`omp-capability-borrow.md`](./omp-capability-borrow.md)（OMP 功能雷达）、[`product-and-engineering-plan.md`](./product-and-engineering-plan.md) §4 / §9 / §24、[ADR-0006](./decisions/0006-interactive-pty-terminal.md)  
> **进度跟踪（完成状态）：** [`dsh-capability-todo.md`](./dsh-capability-todo.md)

dsh 仍在 developer preview，**禁止 vendor 其包**。借鉴的是机制与产品语义，不是 Cordis 运行时。

---

## 定位差在哪（先定边界）

```text
PiX                         DeepSeek Harness
─────────────────────────   ────────────────────────────────
桌面产品（Electron）         可重组 harness（Cordis 插件树）
Pi SDK = Agent 循环         模型 / 工具 / 循环 / UI 全是插件
Desktop = Trust / 审批 /    口号：Model + Harness = Agent
  Diff / Checkpoint /
  Automations
价值：可见、可控、可审查、   价值：能力可换、每次 run 可追溯
  可恢复
```

- **PiX 是桌面产品**：Pi 负责模型循环；Desktop 负责 Trust / 审批 / Diff / Checkpoint / Automations。用户把真实编码任务交给 Agent，并始终能看见、拦住、审查、回退。
- **dsh 是可重组 harness**：Cordis 内核只做插件挂载与依赖；模型适配、工具注册表、会话日志、沙箱、agent loop、Web UI 都是可替换插件。
- **明确不做：** 引入 Cordis、把 `agent-loop` 换成 dsh、插件 marketplace、Creator / 运行时自改插件（桌面 Main 进程任意代码执行，和 Extension 信任门冲突）。

PiX 已强、dsh 反而弱或不强调的：Checkpoint + 并发修改拒绝覆盖、多文件 Diff Keep/Revert、Workspace Trust、Automations 独立审批、Hashline edit、Usage/Cost 面板、Fake Runtime、打包签名。这些不要为对齐 dsh 而改掉。

---

## 运行时逻辑：五处结构性不同

### 1. 扩展点

dsh：一切走 `ctx.effect()` / waterfall（`agent/pre-step`、`tools/pre-execute` → `tools/execute` → `tools/post-execute`），插件卸载时注册自动回滚。

PiX：能力写死在 [`packages/agent-pi/src/pi-runtime.ts`](../packages/agent-pi/src/pi-runtime.ts) 的 `DEFAULT_SESSION_TOOLS` + 工厂函数；权限在 [`packages/security`](../packages/security) 的 Pipeline。

**可借鉴：** 不是 Cordis，而是「工具执行分 pre / around / post 三层」——超时、spill、重复调用提醒、审批都可以挂在同一管线，而不改 Pi loop。

### 2. 会话真相源

dsh：**Model-visible ⟺ logged**。append-only `SessionEvent` 是模型上下文、Fork/Resume/Replay、Trajectory UI 的唯一来源；系统提示、注入、子代理调度都进日志。

PiX：Pi transcript + SQLite 元数据 + [`event-mapper.ts`](../packages/agent-pi/src/event-mapper.ts) 把 Pi 事件投影成 `DesktopAgentEvent`；compaction / 注入 / 系统提示未必能从桌面事件完整重建。

**可借鉴：** Trajectory / 「模型当时看见了什么」视图；新的模型可见输入必须有对应桌面事件（compact 摘要、steer 注入、skill 加载）。不必重做 JSONL 引擎。

### 3. 能力缝（Capability seam）

dsh：FS / subprocess / sandbox 共用一个 execution world。换远程沙箱时 Bash、PTY、LSP 一起走，不用分叉工具。`ctx.sandbox.confine(argv, policy)` 按调用携带 `read-only` / `workspace-write` / `danger-full-access`；没有后端就 fail-closed，禁止静默裸跑。

PiX：bash、PTY（[ADR-0006](./decisions/0006-interactive-pty-terminal.md)）、文件工具、LSP 各自实现。ADR-0006 已写明 PTY 可 `cd` 出工作区，没有 OS jail。路径约束是策略层（`isPathInsideWorkspace` / protected paths），不是内核 confinement。

**可借鉴：** 给 bash（以及未来 Agent 终端）加一层 `confine(argv, policy)`，而不是给每个工具写一套路径检查。这是安全模型最大缺口。

### 4. 工具契约

dsh：`defineTool` 强制 output schema、`isConcurrencySafe`、纯函数 `presentCall`/`presentResult`（直播和 replay 同一套）、超大结果 **spill** 成文件 + locator。工具 UI 意图（`generic` / `terminal` / `diff`）是工具设计的一部分。

PiX：工具卡片在 Renderer 里按名称特化；超长输出在 mapper 里截断（`MAX_TOOL_PROGRESS_CHUNK = 4000`、`MAX_TOOL_OUTPUT_SUMMARY = 500`），截掉的内容模型再也读不到。

**可借鉴：** spill（预览 + 按需再读）比截断更符合长任务；工具 UI 意图下沉到工具定义，导出/回放才不会丢卡片语义。

### 5. 循环卫生

dsh：`guard/` 重复工具提醒、单次 tool timeout；`jobs/` 把长任务后台化；`goal/` 是可续跑的会话目标，不是 checklist；compaction 可先做无模型的 tool-result 修剪再摘要。

PiX：整 run 墙钟超时（默认 10 分钟）；todo 是清单；Automations 是产品级调度。没有「同一工具连打 N 次就注入提醒」，bash 也没有单次 deadline。

**可借鉴：** 重复调用提醒 + 单工具 timeout 挂在现有 tool hook 上；tool-result 修剪作为自动 compact 的廉价前置。Jobs / Goals / Code Mode 更重，放第二批。

---

## 紧急可选池（8 条）

权威进度在 [`dsh-capability-todo.md`](./dsh-capability-todo.md)；下表勾选与之同步（**0/8**）。

排序按「个人日用紧急度 × 与现有栈契合 × 不换核」。

| # | 能力 | 为什么紧急 | 路径 | 粗估 |
|---|------|------------|------|------|
| 1 | [ ] **Tool-output spill** | 长 grep/test 被截断后 Agent 瞎猜 | 自建 | M |
| 2 | [ ] **循环卫生：重复调用提醒 + 单工具 timeout** | 卡死循环是日用第二常见崩法（仅次于 context） | 自建 | S |
| 3 | [ ] **OS sandbox（bash 先）** | ADR-0006 已承认无 jail；dsh 有 Seatbelt / Landlock / bwrap / Windows ACL | 移植思路 | L |
| 4 | [ ] **Trajectory / 模型可见事件齐全** | 对齐「过程透明」；compact/steer/skill 今天对用户是黑盒 | 接线 Pi + 产品化 | M |
| 5 | [ ] **无模型的 tool-result 修剪** | dsh compaction 先剪工具结果再摘要，更便宜 | 接线 Pi / 自建 | M |
| 6 | [ ] **web_fetch** | 现有只有 DuckDuckGo `web_search`；文档页仍靠 bash curl | 自建 | M |
| 7 | [ ] **用户终端 → 会话上下文** | ADR-0006 终端未进 transcript；dsh 终端是一等能力 | 接线 Pi | S |
| 8 | [ ] **通用 LSP stdio** | 现有仅进程内 TS；dsh 是 stdio LSP seam | 自建 | L |

**路径图例：** 接线 Pi = 官方 SDK 已有或接近，主要做 IPC/UI；自建 = Desktop 工具或服务；移植思路 = 学 dsh 机制，不搬 Cordis / 其 native runner。  
**粗估：** S ≈ 数天；M ≈ 1–2 周；L ≈ 2 周+（#3 需独立 ADR）。

### 批次落地摘要

| Batch | 项 | 落地要点（实现侧） |
|-------|----|--------------------|
| A | #1–2、#5 | spill 替换截断；重复调用提醒 + 单工具 timeout；compact 前修剪旧 tool payload |
| B | #4、#7 | 模型可见事件补齐 + Trajectory 筛选；用户终端一键加入上下文（Agent 不驾驭 PTY） |
| C | #6 | `web_fetch`：`external-side-effect`、SSRF 黑名单、Plan 阻断 |
| D | #3、#8 | bash `confine(argv, policy)` fail-closed；项目级 `lsp.json` 默认关闭 |

细节、验收标准与测试状态见 [`dsh-capability-todo.md`](./dsh-capability-todo.md)。

### 推进顺序

未另行指定时：spill → guard → sandbox。#3 改 bash 威胁模型，必须先有 ADR，不能夹在 spill PR 里。

### 明确不进本轮池（避免分心）

- 引入 Cordis / 把 agent-loop 换成 dsh / vendor `@deepseek-ai/dsh-*`
- Creator mode、运行时自改插件、插件 marketplace
- ACP 当主入口、E2B 远程沙箱当默认
- 把 Plan/Build 换成 dsh preset 引擎
- Code Mode、Jobs、Goals、Subagent（见下方第二批）

---

## 完整能力对照

每项标签：

- **接线 Pi**：官方 Pi 已有或接近，主要产品化
- **自建**：需 `customTools` / Main 服务 / 权限扩展
- **移植思路**：学交互或算法，不搬 Cordis / dsh native
- **低优先 / 跳过**：定位冲突或性价比低

「PiX 现状」相对 OMP 紧急池完成态（v0.4.0+）与后续桌面能力更新。

### A. 编辑与代码修改

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 文件工具 + `str_replace_editor` | 最小评测档只留 bash + 编辑器 | 自定义 hashline `edit` + `write`；Minimal 评测档未产品化 | 移植思路（后；Preset） |
| Code Mode（`run_code`） | 模型写 TS 编排多轮工具调用 | 无；每步仍是独立 tool call | 低优先（第二批） |
| 工具 `presentCall` / `presentResult` | 纯函数，直播与 replay 同一套 | Renderer 按工具名特化卡片 | 移植思路（第二批） |
| `isConcurrencySafe` 并行 tool | 只读调用可并行 | 未接；Pi 循环按会话串行 | 接线 Pi（低，等 SDK 能力） |
| Hashline / stale-anchor | （dsh 不强调） | **已有**：`lineHash` + `oldHash`，坏锚点整批拒绝 | 保持自有 |
| Diff Keep/Revert | （dsh 不强调文件恢复） | **已有**：Checkpoint + 并发修改拒绝覆盖 | 保持自有 |

### B. 搜索、读取与溢出

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| grep / glob / ls 一等工具 | 发现类工具走 FS seam | **已有（OMP #15）**：Pi `grep`/`find`/`ls` | 已做 |
| Tool-output spill | 超大结果落文件 + 短 preview + locator | mapper 截断，模型再也读不到 | **自建（#1）** |
| 无模型 tool-result 修剪 | compact 前丢掉过老 payload | 自动/手动 compact 已有（OMP #1），仍摘要全文 | **接线 Pi / 自建（#5）** |
| Attachment 内容寻址 | 附件有稳定身份与本地 CAS | Composer 可贴图；无独立 attachment store | 低优先 |

### C. 代码智能（LSP）

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 通用 stdio LSP seam | 语言服务器可换，工具消费同一接口 | **仅 TS 进程内**：`lsp_diagnostics` / `lsp_references` / `lsp_rename` | **自建（#8）** |
| LSP 随 execution world 走 | 远程沙箱时 LSP 一起搬 | 与 bash/FS 无统一 seam | 跟 #3；不单开 |

### D. 运行时与执行

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| `ctx.sandbox.confine` | 按调用包装 argv；Seatbelt / Landlock / bwrap / Windows ACL | 策略层路径检查；PTY 无 jail（ADR-0006） | **移植思路（#3）** |
| Persistent PTY 工具 | Agent 可驾驭持久终端 | 用户 Dock PTY 已有；Agent bash 仍是一次性 | 用户上下文走 #7；Agent 驾驭 PTY 低优先 |
| 用户终端 → 会话上下文 | 用户命令进 transcript | 终端未进 agent | **接线 Pi（#7）** |
| Subprocess process-tree | 统一杀进程树 | **已有**：macOS/Windows 进程树终止 | 保持自有 |
| Jobs 后台化 | 长工具可观察、取消、完成通知 | 整 run 超时；无 job 协议 | 自建（第二批） |
| output-guard | 防输出撑爆上下文 | 事件层截断 | 被 #1 spill 取代 |

### E. 上下文与会话

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Model-visible ⟺ logged | 模型看见的都必须能从日志重建 | Pi transcript + 桌面事件投影；注入/compact 不全 | **接线 Pi + 产品化（#4）** |
| Trajectory 按来源查看 | user / tool / inject / compact 可筛 | Chat 时间线；无来源筛选 | **产品化（#4）** |
| 自动/手动 compaction | 长会话不撞墙 | **已有（OMP #1）** | 已做；#5 补修剪 |
| Session fork | 从边界分叉，日志派生 | **已有（OMP #10）** | 已做 |
| Session-query / 事件 FTS | 按事件关系与语义检索 transcript | 工作区 FTS + session 搜索；事件关系弱 | 自建（第二批） |
| steer / followUp | 跑着插话 | **已有（OMP #9）** | 已做 |

### F. 规划与人机协作

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Plan mode（logged state） | 只读协作，审查后退出 | **已有（OMP #3）**：Plan/Build 工具集 + fail-closed | 保持自有；不换 preset 引擎 |
| todo_write | 步骤清单 | **已有（OMP #11）** | 已做 |
| ask-user | 结构化追问 | **已有（OMP #12）** | 已做 |
| Goals 续跑 | 同会话目标，驱动继续跑 | todo 不续跑；Automations 是产品调度 | 自建（第二批） |
| 审批 waterfall | `tools/pre-execute` → `ctx.approval` | Main PermissionPipeline；Renderer 只展示 | **保持自有模型** |

### G. 多 Agent / 并行 / 编排

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Subagent provider seam | 子代理可换实现（新 agent / 委托回合） | 非 MVP / M13；需 worktree | 自建（后置） |
| Workflow / ralph | worker-thread 工作流工具 | 无 | 低优先 |
| Preset（Minimal / Standard / Code / Creator） | 配置叠层换整套能力 | Plan/Build 工具白名单；无评测档产品开关 | 移植思路（第二批；先 Minimal） |
| Code Mode | 见 A | 无 | 低优先 |

### H. 记忆、Skills、Hooks

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Skill catalog / loader | 技能注册表 + 模型面工具 | Pi 全局/项目 Skill + Composer `$` | 已做 |
| Hooks（Claude Code / Codex 桥） | pre/post 工具钩子 | Checkpoint 的 before/after write | 移植思路（第二批；通用化现有 hook） |
| 跨会话 memory | （dsh 不强调桌面 memory） | **已有（OMP #20）** | 已做 |
| 运行时自改插件 | 模型挂载/卸载自己的插件 | 无；Extension 信任门计划中 | **跳过** |

### I. 外部世界

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| web_search 多后端 | Exa / Perplexity / DeepSeek | DuckDuckGo HTML 单 provider | 保持单 provider；不追多后端 |
| web_fetch | HTTP(S) 拉页面进上下文 | 无；靠 bash curl | **自建（#6）** |
| MCP | 接 MCP servers | **已有（OMP #19）**：`.pi-desktop/mcp.json` | 已做 |
| browser | （dsh 有 web 能力，非 CDP 桌面） | P1 预览宿主；Agent 工具仍无（C8） | 自建（高风险；P2） |
| E2B 远程沙箱 | 整套 FS/subprocess 换远程 | 本地执行是产品承诺 | **跳过（不当默认）** |

### J. 模型与循环

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| LLM adapter seam | 换模型适配不改 loop | 交给 Pi；Desktop 管登录与展示 | 保持交给 Pi |
| 重复工具提醒 | 连打同类调用则注入 additionalContext | 无 | **自建（#2）** |
| 单工具 timeout | `timeoutMs` + execute waterfall | 仅整 run 10 分钟墙钟 | **自建（#2）** |
| Auto 模型 / fallback | （dsh 不强调产品 Auto） | **已有（OMP #21）** | 已做 |

### K. Git 与恢复

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 结构化 git | （dsh 多靠 shell） | **已有（OMP #16–17）** | 保持自有 |
| Checkpoint / Keep/Revert | （dsh 不强调） | **已有**：任务前基线 + 写入前快照 | 保持自有 |

### L. 宿主与分发

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Web UI profile | `dsh web` | Electron 桌面 | 跳过 |
| Headless / ACP / JSON-RPC SDK | 外进程驾驭 | in-process Main；Automations 是产品入口 | 低优先（ACP 不当主入口） |
| Creator mode | 内存里试插件、组 preset | 无 | **跳过** |
| 插件 marketplace | `dsh-plugin` 生态 | Extension 信任门未成熟 | **跳过** |
| Automations | （dsh 有 schedule follow-up） | **已有**：手动/间隔/每日/任务完成 + 独立审批 | 保持自有 |

### M. 安全（对照学，不照搬）

| dsh 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| SandboxMode | `read-only` / `workspace-write` / `danger-full-access` | Ask / Auto reads / Read-only + Plan fail-closed | **移植思路（#3）**；产品文案继续用 PiX 审批模式，不引入第三套「Auto」 |
| 审批 fail-closed | 无人应答则 deny | PermissionPipeline + Automations 底线 | **保持自有模型** |
| Workspace Trust | （dsh 较弱） | 打开项目必须确认信任 | 保持自有 |
| 静默裸跑 | dsh 明确禁止 | 无后端时 bash 仍跑 | #3 必须 fail-closed |

---

## 第二批（有价值但更重，不进紧急池）

对照表「建议路径」仍为雷达，**不是**承诺排期。

| 能力 | 一句话 | 为何后置 |
|------|--------|----------|
| Code Mode | `run_code` 编排多工具 | 安全面大；和现有 tool card / 审批模型要重做 |
| Jobs 后台化 | 长 bash/test 可观察取消 | 需先有 spill 与单工具 timeout |
| Goals 续跑 | 目标驱动同一会话继续 | 与 todo / Automations 语义易撞；先分清产品名 |
| Subagent | 父会话只收摘要 | 依赖 worktree（M13） |
| Session 事件 FTS | transcript 按事件关系搜 | 现有 session 搜索够用一阵 |
| 工具 `presentCall` 契约 | 卡片可 replay/导出 | 先把 Trajectory 事件补齐 |
| Preset（Minimal/Standard） | 评测档 vs 全日用档 | 先有 sandbox，Minimal 才有意义 |
| Hooks 通用化 | 不限 write 的 pre/post | 现有 Checkpoint hook 先够用 |

---

## 与「换内核」的关系

全量 Pi → dsh / Cordis **不划算**：Electron 桌面壳、Pi 多 Provider、Checkpoint 语义、权限管线、打包签名都要重写；dsh 仍在 preview，兼容性无承诺。默认策略是留在官方 Pi，按本清单勾选借鉴。紧急池未开始；后续仍按「接线 / 自建 / 移植思路」增量挑选，不换核。

与 OMP 清单的分工：OMP 是**功能雷达**（todo、hashline、MCP、Auto 模型等，紧急池已 21/21）；dsh 是 **harness 机制雷达**（spill、循环卫生、OS sandbox、Trajectory、能力缝）。重叠项（Plan、compact、LSP、web、终端）以 PiX 已落地为准，dsh 只补机制缺口。

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-17 | 初版：五处结构对照 + 完整能力表 + 紧急池 8 条（全未开始） |
