# Pi Agent Desktop

> 本地桌面 Coding Agent 产品与工程开发总计划
>
> PRODUCT & ENGINEERING PLAN · Version 1.2 · 2026-07-26
>
> v1.1 变更：新增 §21–§28（第一版收口清单、Pi SDK 能力盘点、M8.5–M13 增强路线与方案设计、功能候选清单、协议与数据模型演进、增强阶段测试与风险、ADR 队列）。§1–§20 的范围与契约未变。
>
> v1.2 变更（**一轮 v2 设计落地之后**回写）：新增 §29–§34（实现期教训与反模式清单、设计稿保真契约、诚实呈现契约、状态存放清单、可访问性与本地化基线、构建环境不变量）；补 §9.3 审批模式与 §9.4 无人值守执行（并说明它与 §4.1 A5 的关系）；补 §14.1.1 已生效的具体数值。前二十节是开工前写的，这一批是**实现后才知道的事**。

> **核心目标：** 以 Pi Agent SDK 作为 Agent Runtime，构建一个在本地项目中完成“理解任务、修改代码、执行验证、审查 Diff、接受或撤销变更”的桌面应用。


| **项目属性** | **当前决策**                                              |
|--------------|-----------------------------------------------------------|
| 目标用户     | 首先服务于个人开发者和项目作者本人                        |
| 首发平台     | macOS 优先，架构不锁死其他桌面平台                        |
| 桌面技术     | Electron + React + TypeScript                             |
| Agent 内核   | Pi Agent SDK，通过 AgentRuntime 适配层接入                |
| 核心 UI      | shadcn/ui + Tailwind CSS                                  |
| 异步状态     | @tanstack/react-query；流式运行状态使用事件总线与 Zustand |
| Diff         | @pierre/diffs，优先使用稳定版本与 CodeView 能力           |
| 计划方法     | 以里程碑和验收门槛推进，不绑定固定时间                    |

# 0. 文档定位与使用方式

这份文档是项目总纲，不是一次性的产品设想。它同时承担产品范围、架构约束、工程契约、安全基线、行动清单和验收标准的作用。开发过程中出现重大决策时，应更新本文件或拆分到仓库 docs/ 下，并在决策记录中保留原因。

> **推进原则：** 每个阶段只有在对应验收标准通过后才进入下一阶段；任何不影响第一条完整用户路径的功能，都不能阻塞 MVP。


## 0.1 文档导航

| **章节** | **回答的问题**                                  |
|----------|-------------------------------------------------|
| 1-3      | 产品是什么、为谁解决什么问题、第一版做什么      |
| 4-6      | 系统如何分层、使用哪些技术、仓库如何组织        |
| 7-11     | Runtime、事件、状态机、权限、数据与恢复如何定义 |
| 12-15    | 各里程碑的行动项、测试、可观测性与发布门槛      |
| 16-18    | 风险、决策记录、启动开发的首批 Backlog          |
| 19-20    | MVP 最终验收剧本与技术依据                      |
| 21-22    | 第一版还差什么、Pi SDK 还有哪些能力没被产品使用 |
| 23-25    | MVP 之后做什么：增强路线、方案设计、功能优先级  |
| 26-28    | 增强阶段的协议/数据演进、测试与风险、ADR 队列   |
| 29-31    | 实现后回写：反模式清单、设计稿保真、诚实呈现契约 |
| 32-34    | 状态存放全表、可访问性与本地化、构建环境不变量  |

# 1. 产品愿景与成功定义

产品愿景：让开发者在一个可信、可审查、可恢复的本地桌面工作台中，把真实编码任务交给不同 Provider 和 Model 驱动的 Pi Agent 完成。

## 1.1 核心价值
- 本地执行：项目文件、Git 和 Shell 默认在用户机器上运行。
- 模型自由：使用 Pi 已有的多 Provider、多 Model 能力，不自建重复的模型适配层。
- 过程透明：用户能看到 Agent 正在读取什么、执行什么、修改什么。
- 安全可控：敏感或高风险操作经过统一权限策略和明确授权。
- 结果可审查：所有代码修改通过高性能 Diff 界面集中评审。
- 工作可恢复：崩溃、取消、拒绝修改都不会破坏用户任务前已有工作。

## 1.2 第一版成功标准
- [ ] 用户可以打开一个本地 Git 项目并建立可信 Workspace。
- [ ] 用户可以选择一个已配置的 Provider 和 Model。
- [ ] Agent 可以读取、搜索、修改代码并运行验证命令。
- [ ] 用户可以实时理解 Agent 的运行状态和工具调用。
- [ ] 危险操作会被拦截并要求授权。
- [ ] 用户可以查看多文件 Diff，继续要求修改或保留结果。
- [ ] 用户可以撤销本轮 Agent 产生的修改，且不损坏任务前已有修改。
- [ ] 关闭应用后可以恢复项目、会话和运行记录。

## 1.3 非目标
- 第一版不是完整 IDE，不提供 VS Code 级代码编辑能力。
- 第一版不追求多 Agent 编排、团队协作、云同步和插件市场。
- 第一版不把本地模型作为启动前提；本地 Agent 与本地 Model 是两个独立能力。
- 第一版不承诺无确认地执行任意系统命令，也不以“全自动”为卖点。

# 2. MVP 用户主路径

1.  启动应用，选择或恢复一个本地 Git 项目。

2.  确认项目信任状态，创建新的 Agent Session。

3.  选择 Provider、Model 和 Thinking Level。

4.  输入一个真实编码任务，可引用项目文件。

5.  Agent 分析项目并流式展示消息、工具调用和运行状态。

6.  普通 Workspace 内读取和写入按策略执行；敏感操作触发审批。

7.  Agent 完成代码修改，并运行 lint、test 或 build。

8.  桌面端展示多文件 Diff、测试结果和任务摘要。

9.  用户选择继续修改、保留修改或撤销本轮 Agent 修改。

10. 应用保存 Session、Run、Approval、FileChange 和 Checkpoint 信息。

> **MVP 冻结规则：** Plan Mode、Session Fork、多 Agent、远程 Workspace、本地 4090 推理、MCP、自动更新和多窗口全部进入后续路线，不阻塞上述主路径。


# 3. 产品功能范围

| **模块** | **MVP**                                | **后续增强**                  |
|----------|----------------------------------------|-------------------------------|
| Project  | 选择目录、最近项目、Git 检测、项目信任 | 项目分组、远程 Workspace      |
| Session  | 创建、恢复、重命名、归档               | Fork、树状导航、分享          |
| Agent    | 流式执行、Stop、Follow-up              | Plan Mode、多 Agent、后台并行 |
| Provider | 至少一个 Provider 完整登录与模型切换   | 本地模型、Provider 健康检查   |
| Tool     | read/write/edit/bash 与审批            | Browser、MCP、SSH             |
| Diff     | 多文件 Review、Keep/Revert             | 行级指令、评论、合并冲突处理  |
| Recovery | 任务前快照、文件级/整轮恢复            | 跨设备恢复、历史版本浏览      |
| 发布     | macOS 本地安装包                       | 签名、Notarization、自动更新  |

# 4. 技术架构

```text
React Renderer
├─ Chat / Tool Calls / Approval / Diff / Settings
├─ TanStack Query（查询与持久异步状态）
└─ Zustand + Event Bus（流式与临时 UI 状态）
│ Typed IPC + Zod
Electron Main
├─ AgentRuntime / PiAgentRuntime
├─ Workspace / Git / Shell / Checkpoint
├─ Approval Policy / Audit
├─ Session Repository / SQLite
└─ Provider Credentials / Keychain
│
Pi Agent SDK → Provider / Model
│
Local Workspace / Git / Child Processes
```

## 4.1 架构原则
- Renderer 不启用 Node Integration，不直接访问文件系统、Shell、密钥或数据库。
- 所有跨进程输入、输出和事件都经过 Zod runtime validation。
- Pi SDK 只出现在 agent-pi 适配层，业务与 UI 不导入 Pi 内部类型。
- 所有 Agent Event 都带 projectId、sessionId、runId、sequence 和 timestamp。
- 权限判定在 Main Process 完成；Renderer 只负责呈现审批和提交用户选择。
- Git Diff 是展示来源，Checkpoint 快照才是可靠恢复来源。
- Provider 和 Model 交给 Pi；桌面应用负责登录体验、密钥保护和状态展示。

# 5. 技术选型与约束

| **领域**        | **选择**                      | **约束或原因**                                             |
|-----------------|-------------------------------|------------------------------------------------------------|
| Desktop         | Electron                      | Pi 为 TypeScript/Node 生态，避免首版 sidecar 与 RPC 复杂度 |
| UI              | React + TypeScript            | 与现有经验一致，便于快速构建复杂工作台                     |
| Server State    | @tanstack/react-query         | 管理项目、会话、Diff、Provider 等异步查询                  |
| Streaming State | Event Bus + Zustand           | 避免每个 token 更新 Query Cache                            |
| Components      | shadcn/ui + Tailwind          | 组件源码可控，适合产品化定制                               |
| Diff            | @pierre/diffs                 | 面向 Code Review，支持 Shiki 和高性能虚拟化                |
| Validation      | Zod                           | IPC、数据库边界和持久化数据统一校验                        |
| Database        | SQLite                        | 只在 Main Process 使用；Repository 隔离具体驱动            |
| Credentials     | Keychain / safeStorage        | 明文密钥不进入 Renderer、日志或项目目录                    |
| Testing         | Vitest + Playwright           | 单元、契约、集成和端到端覆盖                               |
| Packaging       | Electron Builder/Forge 二选一 | 在技术验证阶段完成 packaged build，不拖到发布前            |

> **版本策略：** Electron、Pi SDK、@pierre/diffs 和 SQLite 驱动必须锁定具体版本；MVP 阶段不使用自动跟随最新版的范围符号。依赖升级必须跑固定评测集。


# 6. 推荐仓库结构

```text
pi-desktop/
├─ apps/desktop/src/
│ ├─ main/
│ │ ├─ agent/ approvals/ providers/
│ │ ├─ workspace/ git/ checkpoints/
│ │ ├─ sessions/ storage/ ipc/
│ │ └─ observability/
│ ├─ preload/
│ └─ renderer/
│ ├─ app/ components/ stores/
│ └─ features/
│ ├─ agent/ chat/ approvals/ diff/
│ ├─ projects/ sessions/ models/ settings/
├─ packages/
│ ├─ agent-domain/ agent-pi/ protocol/
│ ├─ database/ git/ security/ ui/
├─ fixtures/test-repositories/
├─ tests/integration/ tests/e2e/
└─ docs/
```

## 6.1 仓库文档

| **文件**                  | **内容**                                           |
|---------------------------|----------------------------------------------------|
| product-scope.md          | MVP 范围、非目标、核心用户路径                     |
| architecture.md           | 进程边界、模块职责、依赖方向                       |
| agent-runtime-contract.md | Runtime 接口、事件协议、错误类型                   |
| ipc-protocol.md           | Commands、Queries、Events 和 Zod Schema            |
| security-model.md         | 威胁、权限等级、审批和审计策略                     |
| data-model.md             | 实体、所有权、迁移和生命周期                       |
| checkpoint-semantics.md   | 快照、冲突、Keep/Revert 的精确定义                 |
| acceptance-tests.md       | 固定测试仓库、任务集和通过标准                     |
| decisions/                | 关键 ADR：为什么选择 Electron、Pi、Pierre Diffs 等 |

# 7. AgentRuntime 契约

```text
interface AgentRuntime {
createSession(options: CreateSessionOptions): Promise<AgentSession>;
resumeSession(sessionId: string): Promise<AgentSession>;
sendMessage(sessionId: string, input: AgentInput): Promise<RunRef>;
steer(runId: string, input: AgentInput): Promise<void>;
followUp(sessionId: string, input: AgentInput): Promise<void>;
abort(runId: string): Promise<void>;
setModel(sessionId: string, model: ModelRef): Promise<void>;
approve(requestId: string, decision: ApprovalDecision): Promise<void>;
subscribe(listener: AgentEventListener): () => void;
dispose(): Promise<void>;
}
```

## 7.1 适配层职责
- 创建、恢复和销毁 Pi Session。
- 把 Pi 消息、Tool Call、Tool Result 和 Usage 转换为 DesktopAgentEvent。
- 把 Pi Provider/Model 数据转换为稳定的桌面领域模型。
- 归一化 Abort、超时、Provider 错误和工具错误。
- 隔离 Pi SDK 版本变化，避免修改 Renderer 和数据库结构。
- 提供 FakeAgentRuntime，使 UI 与 E2E 测试不依赖真实模型费用。

## 7.2 Pi 技术验证清单
- [ ] Pi SDK 能在 Electron Main dev mode 中加载和运行。
- [ ] Pi SDK 能在 packaged Electron 中加载和运行。
- [ ] ESM/CJS、动态依赖和资源发现无打包冲突。
- [ ] Session 存储路径可以受控，且恢复行为稳定。
- [ ] Tool Event 能提供权限判断所需的输入信息。
- [ ] Abort 会终止正在运行的 Bash 及其子进程树。
- [ ] 关闭应用不会遗留 Agent 或 Shell 进程。
- [ ] 至少一个 Provider 的登录、模型列表和真实调用闭环通过。
- [ ] Pi SDK 版本已锁定，并记录升级回归步骤。

# 8. 事件协议与状态机

```text
type AgentRunState =
| { status: "idle" }
| { status: "starting"; runId: string }
| { status: "running"; runId: string }
| { status: "waiting_for_approval"; runId: string; requestId: string }
| { status: "stopping"; runId: string }
| { status: "completed"; runId: string }
| { status: "failed"; runId: string; error: AgentError }
| { status: "cancelled"; runId: string };
```

| **事件族** | **示例**                              | **UI 行为**                    |
|------------|---------------------------------------|--------------------------------|
| 生命周期   | run.started / completed / failed      | 更新状态机和运行摘要           |
| 消息       | message.delta / completed             | 批量刷新流式文本，完成后持久化 |
| 工具       | tool.requested / progress / completed | 显示工具卡片和可折叠输出       |
| 审批       | approval.requested / resolved         | 暂停运行并显示权限对话框       |
| 文件       | files.changed                         | 刷新变更列表和 Diff Query      |
| 用量       | usage.updated                         | 显示 Token、成本和上下文使用量 |

> **乱序防护：** Renderer 只接受当前 projectId/sessionId/runId 的事件；sequence 小于等于已处理序号的迟到或重复事件必须丢弃。


# 9. 权限与安全模型

Pi 提供工具与扩展能力，但桌面产品必须把权限控制作为自己的核心能力。Workspace 边界只能限制文件路径，不能自动约束项目脚本、测试命令或依赖安装产生的系统副作用。

## 9.1 风险等级

| **等级**             | **典型操作**                                 | **默认策略**             |
|----------------------|----------------------------------------------|--------------------------|
| safe                 | Workspace 内读取、git status、明确的只读检查 | 自动允许并审计           |
| workspace-write      | 修改普通源码、创建测试文件                   | 按项目模式允许，保留快照 |
| sensitive            | 读取 .env、安装依赖、网络请求                | 每次确认或默认禁止       |
| destructive          | 删除、覆盖大量文件、修改 Git 历史            | 始终确认，限制记忆授权   |
| external-side-effect | git push、发布、部署、外部写操作             | 始终确认，不允许模糊授权 |

## 9.2 审批协议

```text
type ApprovalDecision =
| "allow-once"
| "allow-session"
| "allow-project"
| "deny";

interface ApprovalRequest {
id: string;
runId: string;
toolName: string;
summary: string;
command?: string;
affectedPaths: string[];
riskLevel: RiskLevel;
reasons: string[];
rememberable: boolean;
}
```

## 9.3 审批模式（v1.2 补充，已实现）

§9.2 只定义了「单次请求怎么问」，没有定义「这个 Session 整体允许到什么程度」。
`PolicyEngine` 现有三档模式，可设为全局默认或按 Session 覆盖：

| mode | 语义 | workspace-write | bash / sensitive+ |
|------|------|-----------------|-------------------|
| `ask` | 每个改动都等人决定 | 需审批 | 需审批 |
| `auto-reads` | 读自由、workspace 内写自由（历史默认值） | 自动允许 | 需审批 |
| `read-only` | 什么都不写、什么都不跑 | **拒绝** | **拒绝** |

两条必须保留的实现约束：

1. **`read-only` 是「拒绝」而不是「排队等审批」。** 若它只是弹窗，那就等于 `ask`，
   模式本身失去意义 —— 点一下 Allow 就能写入。
2. **`read-only` 的判定必须在「记忆规则查表」之前。** 否则先前在宽松模式下授予的
   `allow-project` 会绕过只读。已有回归测试覆盖。

模式同时作用于 **Terminal 面板**：只读必须真的全局只读，否则用户可以从终端绕过。

## 9.4 无人值守执行（v1.2 补充，与 §4.1 A5 的关系）

§4.1 A5 原文是「权限判定在 Main Process 完成；Renderer 只负责呈现审批和提交用户选择」，
隐含前提是**每个 elevated 操作都有人做决定**。Automations 的 `unattended` 模式打破了
这个前提：定时触发时没有人在键盘前。

**该偏离是显式决策，记录在 `docs/decisions/0003-unattended-automations.md`。**
A5 现应读作：权限判定始终在 Main；决策者可以是人，也可以是一条用户明确配置为
`unattended` 的自动化规则。

不因 `unattended` 放宽的底线（写进代码，且有 fixture 断言）：

- policy engine 的 `deny`（受保护路径、越出 workspace、`git push` 等 external-side-effect）
  **根本不会变成审批请求**，因此自动审批看不到、也无法放行。
- Workspace Trust 不被绕过。
- 每个自动决定写审计，含 automationId 与 mode。
- 调度器启动时不补跑错过的时间片（崩溃循环不会反复触发写入）。
- Checkpoint 语义不变：无人值守产生的修改可被精确撤销。

## 9.5 必须覆盖的威胁
- 恶意仓库、AGENTS.md 或源文件中的 Prompt Injection。
- 符号链接、相对路径和大小写差异导致的 Workspace 越界。
- npm/pnpm 安装脚本、测试脚本和构建脚本访问系统或网络。
- 读取 SSH、云平台、Git、浏览器和本地模型凭据。
- Agent 启动后台进程、监听端口或留下孤儿进程。
- Renderer XSS 后调用高风险 IPC。
- Shell 输出、异常堆栈和日志泄露 Token 或敏感路径。
- 未经确认执行 git push、发布、部署或外部服务写操作。

**安全基线检查**
- [ ] contextIsolation 开启，nodeIntegration 关闭。
- [ ] Preload 只暴露白名单 API，不暴露通用 invoke。
- [ ] 所有 IPC 输入、输出和事件均通过 Zod 校验。
- [ ] 真实路径 canonicalize 后再做 Workspace 边界判断。
- [ ] 敏感目录和文件有独立 protected-path 规则。
- [ ] 审批、拒绝和实际执行结果全部写入 Audit Log。
- [ ] 日志脱敏覆盖 API Key、Authorization、Cookie 和常见凭据格式。

# 10. 数据模型与所有权

| **数据**                      | **所有者** | **说明**                               |
|-------------------------------|------------|----------------------------------------|
| Pi Session/Message/Compaction | Pi         | 保持 Pi 原生语义，不复制模型上下文实现 |
| Project                       | Desktop    | 路径、信任状态、默认模型和权限         |
| Session Metadata              | Desktop    | 项目关联、名称、归档与 UI 信息         |
| AgentRun                      | Desktop    | 一次任务运行、状态、耗时、模型与结果   |
| Approval                      | Desktop    | 请求、风险、用户决策与审计             |
| FileChange                    | Desktop    | 路径、before/after hash、runId、状态   |
| Checkpoint                    | Desktop    | 恢复所需的内容引用与生命周期           |
| ProviderProfile               | Desktop/Pi | Desktop 保存显示配置；凭据交给安全存储 |
| UI Settings                   | Desktop    | 布局、主题、最近项目等                 |

## 10.1 SQLite 约束
- 数据库只允许 Electron Main Process 访问。
- 业务层依赖 Repository 接口，不直接依赖 SQLite 驱动。
- 迁移脚本必须版本化、可重复执行并有备份策略。
- 采用原生 SQLite 驱动时，技术验证必须包含 macOS ARM64 packaged build。
- Agent Run 开始时持久化 running，崩溃恢复时转为 interrupted。
- 删除项目、删除 Session 和删除 Checkpoint 的级联语义必须明确。

# 11. Diff、Checkpoint 与恢复语义

> **关键定义：** Agent 已直接修改工作目录，因此 Diff 页面中的 Keep changes 表示保留当前修改；Revert 表示恢复本轮 Agent 修改，不等同于 GitHub 上的 Accept/Reject。


## 11.1 修改前基线
- 每次 Run 开始前记录 Git 状态、文件内容 hash 和任务前已有修改。
- Agent 首次写入某文件前保存内容快照；新增文件保存“不存在”状态。
- Git Diff 用于显示，快照与 hash 用于精确恢复。
- Agent 运行期间用户手动修改同一文件时，标记冲突并禁止静默覆盖。
- 非 Git 项目仍可使用文件快照，但不进入首个 MVP 验收路径。

## 11.2 用户操作语义

| **操作**                 | **语义**                          | **保护条件**                   |
|--------------------------|-----------------------------------|--------------------------------|
| Keep changes             | 保留当前工作树状态并结束 Review   | 保存运行摘要和变更记录         |
| Continue editing         | 把反馈发送给同一 Session 继续修改 | 创建新的 Run 与 Checkpoint     |
| Revert file              | 只恢复该 Run 对指定文件的修改     | 若检测到并发修改则要求处理冲突 |
| Revert all agent changes | 恢复该 Run 修改的所有文件         | 绝不破坏任务前已有未提交修改   |
| Review later             | 保留工作树，Session 标记待审查    | 再次打开时重新校验 hash        |

# 12. 里程碑与行动项

以下阶段不绑定固定时间。每个阶段以产出物和验收门槛作为完成条件；可以并行探索，但不能绕过依赖关系和安全门槛。

## M0：范围冻结与项目基线
- [x] 确认 macOS 优先、单 Agent、Git 项目优先。
- [x] 冻结 MVP 主路径和非目标清单。
- [x] 创建仓库、pnpm workspace、代码规范与 CI 基线。
- [ ] 建立 docs/、ADR、fixtures/test-repositories。（骨架有，§6.1 文档集与 fixtures 未齐）
- [ ] 准备固定的真实任务评测集。

> **完成门槛：** 仓库具备明确范围、可运行的空壳工程和可重复的验收输入。
>
> **进度台账：** 见 [`docs/TODOS.md`](./docs/TODOS.md)。M0 **未关闭**。


## M1：Pi SDK + Electron 技术验证
- [x] 初始化 Electron、React、TypeScript、Vite。
- [ ] 在 Main Process 中创建 Pi Session。（适配层与 smoke 已通；GUI + 鉴权闭环待确认）
- [ ] 打通 Renderer → Typed IPC → Pi → Event Stream。（已接线；真流依赖 Provider 登录）
- [ ] 支持发送消息、展示流式文本、Tool Event 和 Stop。
- [ ] 完成 dev 与 packaged build 验证。
- [x] 在测试仓库中完成一次真实代码修改和测试运行。（headless `pnpm eval:fixture` + OpenCode Go PASS）

> **完成门槛：** 不打开 Pi TUI，也能从桌面窗口完成一次真实编码任务。
>
> **进度台账：** 见 [`docs/TODOS.md`](./docs/TODOS.md)。SDK 真改码证据已齐；GUI 手测仍建议但非阻塞 headless 证据。


## M2：领域契约与状态机
- [ ] 完成 AgentRuntime、PiAgentRuntime 和 FakeAgentRuntime。
- [x] 定义 AgentRunState、DesktopAgentEvent 和 AgentError。
- [ ] 事件带齐作用域与顺序字段，处理重复和迟到事件。（缺 project/session/run 过滤）
- [ ] 完成 Runtime、IPC 和状态机契约测试。（仅有基础测试）

> **完成门槛：** Renderer 不导入 Pi 类型；乱序、取消和失败状态可以确定性复现。
>
> **进度台账：** 见 [`docs/TODOS.md`](./docs/TODOS.md)。


## M3：Project、Session 与 Provider
- [ ] 实现选择项目、最近项目、Git 检测和项目信任。
- [ ] 实现 Session 创建、恢复、重命名和归档。
- [ ] 读取 Pi Provider/Model，完成至少一个真实登录闭环。
- [ ] 密钥不进入 Renderer、数据库明文或日志。

> **完成门槛：** 用户重启应用后可恢复项目与 Session，并再次调用已配置模型。


## M4：Agent Chat 工作台
- [ ] 完成 Chat、Composer、流式消息和 Tool Call 卡片。
- [ ] 支持 Stop、Retry、Follow-up Queue 和错误恢复。
- [ ] 接入 TanStack Query、Zustand 和事件批处理。
- [ ] 显示模型、上下文、Token、成本与运行状态。

> **完成门槛：** 长任务中用户能理解 Agent 当前步骤、工具、输出和是否需要介入。


## M5：权限与安全基线
- [ ] 建立 Tool Normalizer、Risk Classifier、Policy Engine。
- [ ] 实现审批对话框、allow-once/session/project 与 deny。
- [ ] 完成 protected paths、路径 canonicalization 和审计日志。
- [ ] 覆盖 Shell、网络、依赖安装、Git push、删除和外部副作用。
- [ ] 建立安全攻击测试仓库。

> **完成门槛：** Agent 无法在未经授权时访问敏感路径、推送代码或执行高风险副作用。


## M6：Diff Review
- [ ] 接入 @pierre/diffs 稳定版和 CodeView。
- [ ] 支持多文件、unified/split、折叠未修改行和文件导航。
- [ ] 展示新增、修改、删除、重命名和二进制提示。
- [ ] 完成大 Diff 性能基准与主题同步。

> **完成门槛：** 大型多文件变更仍能流畅打开、滚动、切换和定位。


## M7：Checkpoint 与精确恢复
- [ ] 任务前记录 Git 状态与文件基线。
- [ ] 首次写入前保存快照和 hash。
- [ ] 实现 Keep、Continue、Revert file、Revert all。
- [ ] 处理用户并发修改与冲突。
- [ ] 完成崩溃后恢复和 Checkpoint 清理。

> **完成门槛：** 撤销 Agent 任务不会破坏任务前已有的未提交工作。


## M8：稳定性、评测与可安装版本
- [ ] 完成长输出截断、背压、超时和子进程树终止。
- [ ] 完成结构化日志、脱敏、Run 指标和诊断导出。
- [ ] 运行固定 Agent 评测集和 Electron E2E。
- [ ] 完成 macOS packaged build、安装和卸载验证。

> **完成门槛：** 应用可作为个人日常开发工具连续运行，并有明确故障诊断手段。


## M9：后续能力路线
- [ ] Plan Mode、Todo、Session Fork。
- [ ] 本地 llama.cpp/OpenAI-compatible Provider。
- [ ] Mac Desktop + 4090 PC 推理节点。
- [ ] 远程 Workspace、SSH、MCP、多 Agent。
- [ ] 签名、Notarization、自动更新与产品化分发。

> **完成门槛：** 每项增强有独立 ADR、评测与安全审查，不回侵 MVP 核心。
>
> **拆分说明（v1.1）：** M9 原为一行占位。自 v1.1 起，MVP 之后的规划拆分为 **M8.5（收口）+ M9–M13**，详见 §21–§26。本节保留作为历史锚点，执行状态仍以 `docs/TODOS.md` 为准。


# 13. 测试与 Agent 质量评测

## 13.1 测试分层

| **层级**         | **覆盖重点**                                         |
|------------------|------------------------------------------------------|
| Unit             | 状态机、风险分类、路径判断、数据转换、Repository     |
| Contract         | AgentRuntime、IPC Schema、Event Protocol、Pi Adapter |
| Integration      | Pi Session、Git、Checkpoint、SQLite、Keychain        |
| E2E              | 从打开项目到 Review/Keep/Revert 的完整路径           |
| Security         | 路径越界、恶意脚本、敏感文件、危险命令、XSS/IPC      |
| Performance      | 超长会话、Tool Output、大 Diff、事件吞吐、内存       |
| Agent Evaluation | 任务成功率、无关修改、测试行为、成本与安全           |

## 13.2 固定评测任务
- 修改一个按钮文案并更新测试。
- 修复 TypeScript 类型错误。
- 添加 TanStack Query 请求和 loading/error 状态。
- 修改表单校验并补充测试。
- 定位并修复一个失败测试。
- 完成跨多个文件的小型重构。
- 需求含糊时先提问，不擅自扩大范围。
- 遇到 Workspace 外读取请求时触发拒绝或审批。
- 危险命令触发正确风险等级。
- 取消长任务并确认子进程已终止。
- 在项目已有未提交修改时精确撤销 Agent 修改。

## 13.3 评测指标

| **维度** | **指标**                                    |
|----------|---------------------------------------------|
| 正确性   | 任务是否完成、测试是否通过、是否引入回归    |
| 克制性   | 是否产生无关修改、是否擅自扩大任务          |
| 透明度   | 用户是否能理解工具、状态和失败原因          |
| 安全性   | 权限是否正确触发，是否存在绕过              |
| 恢复性   | 取消、崩溃、Revert 后状态是否一致           |
| 性能     | 首 Token、总耗时、Diff 打开与滚动、内存峰值 |
| 成本     | 输入/输出 Token、缓存、模型费用             |

# 14. 可观测性与运行保护
- 每个 Run 记录 Provider、Model、Thinking Level、起止时间和最终状态。
- 记录首 Token 延迟、Tool Call 数量、每个 Tool 耗时和审批等待时间。
- 记录 Input/Output Token、上下文占用、缓存与可用成本信息。
- 记录修改文件数量、测试命令和测试结果。
- 日志按 projectId/sessionId/runId 查询，默认本地保存，不自动上传。
- 日志脱敏后才能导出；原始 Shell 输出采用独立文件和保留策略。

## 14.1 背压与资源上限

| **对象**      | **策略**                                       |
|---------------|------------------------------------------------|
| Token Delta   | 按动画帧或短批次合并更新，消息完成后再写持久层 |
| Shell Output  | UI 保留尾部窗口；完整日志写文件；设置内存上限  |
| Tool Result   | 对模型回传可控截断与摘要，保留截断提示         |
| Diff          | 虚拟化渲染；二进制和超大文件使用降级展示       |
| Child Process | 超时、取消、应用退出时终止整个进程树           |
| Event Queue   | 有界队列、批处理、丢弃可重建的旧进度事件       |

### 14.1.1 已生效的具体数值（v1.2 补充）

上表是策略，下表是**代码里真正在执行的常量**。任何一处改动都应同步这张表，否则
Settings 里展示的数字与实际行为会漂移（这是 §31 诚实契约的一部分）。

| 限制 | 值 | 常量位置 |
|------|----|----------|
| message.delta 合批间隔 | 16 ms | `DELTA_FLUSH_INTERVAL_MS`（main/index.ts） |
| delta 缓冲上限 | 500 条 | `MAX_BUFFERED_DELTAS`（同上） |
| Run 超时 | 10 min（可由 `RUN_TIMEOUT_MS` 覆盖） | agent-pi |
| 终端单命令超时 | 120 s | `DEFAULT_TIMEOUT_MS`（main/terminal） |
| 终端输出上限 | 256 KB（保留尾部 + 截断提示） | `MAX_OUTPUT_BYTES`（同上） |
| 已解决 Checkpoint 保留 | 30 天（未解决的**永不**清理） | `RESOLVED_CHECKPOINT_RETENTION_MS` |
| 文件搜索缓冲 | 8 MB | main/git/file-search-service |
| 自动化调度 tick | 30 s | `TICK_MS`（main/automations） |
| 错过时间片宽限 | 60 min（超过即跳过，不补跑） | `MISSED_SLOT_GRACE_MS` |

> 这些值通过 `app.getInfo` 的 `policy` 字段回传给 Settings，界面不再硬编码文案。

# 15. 发布门槛
- [ ] MVP 主路径 E2E 全部通过。
- [ ] 固定 Agent 评测任务达到可接受成功率，且无严重安全退化。
- [ ] packaged build 中 Pi、SQLite、Keychain 和 @pierre/diffs 正常工作。
- [ ] 应用退出、Abort 和崩溃恢复不会遗留子进程或损坏数据库。
- [ ] Workspace 越界、敏感路径、危险 Shell 和外部副作用测试通过。
- [ ] Keep/Revert 不会破坏任务前已有未提交修改。
- [ ] 日志中不包含明文 API Key、Authorization 或敏感凭据。
- [ ] 大型会话和 Diff 的性能达到个人日常使用要求。
- [ ] 已提供数据位置、清理、导出和卸载说明。

# 16. 风险登记册

| **风险**            | **影响**               | **缓解措施**                                 |
|---------------------|------------------------|----------------------------------------------|
| Pi SDK API 变化     | Runtime 和会话行为回归 | 版本锁定、Adapter 隔离、契约测试、升级评测   |
| Electron 权限面过大 | 本地数据或系统风险     | Main 权限管线、最小 Preload、未来 OS Sandbox |
| Checkpoint 语义错误 | 破坏用户已有修改       | 写前快照、hash、并发冲突检测、恢复测试       |
| SQLite 原生打包     | dev 可用但安装包失败   | 最早阶段验证 packaged ARM64 build            |
| 流式事件过密        | 卡顿、内存增长         | 批处理、虚拟化、有界队列、日志落盘           |
| 大 Diff 性能        | Review 不可用          | Pierre CodeView、基准测试、降级策略          |
| Provider/OAuth 差异 | 登录体验不稳定         | 先完整支持一个 Provider，再逐个扩展          |
| 模型能力差异        | 任务成功率波动         | 固定评测集、能力标签、明确模型切换           |
| 范围膨胀            | 迟迟没有可用版本       | MVP 冻结、非目标清单、完成门槛               |

# 17. 关键决策记录

| **决策**   | **当前选择**     | **理由**                                             |
|------------|------------------|------------------------------------------------------|
| 桌面框架   | Electron         | 与 Pi Node/TS SDK 直接整合，降低首版复杂度           |
| Agent 内核 | Pi SDK           | 复用 Provider、Model、Session、Tools 和 Extensions   |
| 模型抽象   | 使用 Pi          | 不重复维护多 Provider 接口，只保留 AgentRuntime 边界 |
| UI 系统    | shadcn/ui        | 轻量、可控、适合定制 Agent 工作台                    |
| 异步状态   | TanStack Query   | 管理查询和 mutation；流式事件不进入 Query Cache      |
| Diff       | @pierre/diffs    | 更贴合大型 Code Review，不引入完整 Monaco            |
| 恢复       | 快照 + hash      | Git Diff 只适合展示，不能精确区分修改来源            |
| 首发范围   | macOS + Git 项目 | 先服务真实个人工作流，减少平台和恢复分支             |

# 18. 启动开发 Backlog

以下顺序是项目启动后的第一批可执行工作。目标是尽快获得技术证据，而不是先完成完整视觉设计。

**第一批任务**
- [x] 创建 pi-desktop 仓库和 pnpm workspace。
- [x] 配置 TypeScript、ESLint、Prettier、Vitest 和基础 CI。
- [x] 创建 Electron Main、Preload、React Renderer 最小工程。
- [ ] 安装 shadcn/ui，建立基础主题 Token 和三栏工作台骨架。（仅有最小组件，非完整 shadcn 体系）
- [x] 锁定 Pi SDK 版本并创建 agent-pi package。（`@earendil-works/*@0.82.0`，见 ADR-0002）
- [x] 定义 AgentRuntime、DesktopAgentEvent、AgentRunState 和 AgentError。
- [x] 定义 protocol package，建立 Typed IPC + Zod。
- [x] 在 Main Process 创建 Pi Session 并发送第一条消息。（含 OpenCode Go 真模型）
- [x] 把 message delta 和 tool events 显示到 Renderer。（真流已在 eval 验证）
- [ ] 实现 Stop，并验证 Bash 子进程树被终止。（abort API + 单测有；端到端待补）
- [x] 准备测试 React 项目，要求 Agent 修改组件并运行测试。（`pnpm eval:fixture` PASS）
- [~] 生成 packaged macOS build，验证 Pi SDK 仍能运行。（dir 包 + asar smoke 过）
- [x] 记录技术验证结果，决定是否继续 SDK 路线或切换 Pi RPC 备用路线。（继续 SDK）

> **执行台账：** 全部勾选状态以 [`docs/TODOS.md`](./docs/TODOS.md) 为准。

## 18.1 技术验证通过后的下一批任务
- [x] 实现 Project、Workspace Trust 和最近项目。（SQLite projects + Trust UI）
- [x] 实现 Session Repository 与 SQLite migration。（`@pi-desktop/database`）
- [~] 实现 Provider/Model 选择和安全凭据存储。（OpenCode Go + 下拉；Keychain 未做）
- [~] 实现完整 Agent Chat、Tool Cards 和 Event Batching。
- [ ] 实现 Permission Pipeline 和 Approval Dialog。
- [ ] 接入 @pierre/diffs，完成多文件 Review。
- [ ] 实现 Checkpoint、Keep、Revert file 和 Revert all。
- [ ] 完成固定评测集、E2E、安全和性能测试。

# 19. MVP 最终验收剧本

1.  打开应用并选择一个已有未提交修改的 React Git 项目。

2.  确认 Workspace Trust，创建 Session，选择 Provider 和 Model。

3.  要求 Agent 实现一个跨多个文件的小功能并补充测试。

4.  观察 Agent 读取文件、搜索代码、修改文件和运行测试。

5.  触发一次需要审批的命令，确认 UI 展示风险、路径和影响。

6.  在 Agent 运行期间发送 Follow-up，确认消息进入正确 Session。

7.  任务完成后打开多文件 Diff，切换 unified/split 并查看测试结果。

8.  要求 Agent 再修改一处细节，形成第二个 Run 和 Checkpoint。

9.  Revert 第二个 Run，确认第一个 Run 的修改仍保留。

10. Revert 全部 Agent 修改，确认任务开始前的用户修改仍完整存在。

11. 关闭并重启应用，确认 Project、Session、Run 和审计记录可以恢复。

> **产品成立的判断：** 当上述剧本稳定通过，并且你愿意在真实日常项目中连续使用它时，第一版才算完成。之后再决定优先投入本地模型、多 Agent，还是把它发展成可销售的桌面产品。


# 20. 技术依据与参考
- Pi SDK：支持把 Pi 嵌入自定义 Web、Desktop 和自动化应用。https://pi.dev/docs/latest/sdk
- Pi Extensions：工具拦截、权限门、路径保护、状态与自定义工具。https://pi.dev/docs/latest/extensions
- Pi Coding Agent：Provider、Model、Session 与程序化用法。https://github.com/earendil-works/pi
- Pierre Diffs：基于 Shiki 的 Diff/Code Rendering。https://diffs.com/
- Pierre CodeView 技术说明：Virtualization-first 的大型 Diff 渲染。https://pierre.computer/writing/on-rendering-diffs


# 21. 第一版收口（M8.5）

> **本节存在的理由：** M0–M8 的 todo 已基本勾满，但 §15 发布门槛与 §19 验收剧本**尚未逐条通过**。在开新功能之前，先关闭这些缺口，否则后续增强建立在未验证的地基上。M8.5 不是新功能阶段，是**证据补齐阶段**。

## 21.1 已闭环的能力（截至 2026-07-26）

| 能力 | 证据 |
|------|------|
| Electron 安全基线 | contextIsolation + 关 nodeIntegration + 白名单 preload，无通用 invoke |
| Typed IPC | `packages/protocol` Zod discriminated union，30 个 method |
| Pi 适配层 | `PiAgentRuntime`（createSession / prompt / steer / followUp / abort / setModel / listModels / dispose）+ 事件映射 |
| 权限管线 | tool-normalizer → risk-classifier → policy-engine → 审批四态 + 审计日志（Main-only） |
| Diff Review | `@pierre/diffs@1.2.12`，多文件 / unified-split / 折叠 / 大 Diff 基准 |
| Checkpoint | SQLite v5：写前 BLOB 快照 + hash + 并发冲突检测 + Keep/Continue/Revert file/Revert all + 崩溃恢复 |
| 可观测性 | NDJSON 轮转日志 + 脱敏 + RunMetrics + `diagnostics.export` |
| 打包 | electron-builder mac-arm64 dir + DMG，`verify:packaged` 校验 asar / native / DMG |
| 测试 | 25 文件 / 73 用例通过；11 个 fixture 完整性验证；Playwright happy-path E2E |

## 21.2 必须在 M8.5 关闭的缺口

| ID | 缺口 | 为什么必须先关 | 完成定义 |
|----|------|----------------|----------|
| M8.5-1 | **M1 门槛未闭环**：没有「packaged 应用内、真实 Provider 鉴权、真实编码任务」的端到端证据 | 这是整个技术路线的立论前提；只有离线 integration 和 CLI 侧 fixture eval | 在 packaged app 内跑通 §19 剧本 1–11，截图/日志落 `docs/eval-reports/` |
| M8.5-2 | **缺 2 份契约文档**：`security-model.md`、`checkpoint-semantics.md` | 权限与恢复是本产品最高风险面，实现已存在但语义未成文，后续改动无参照 | 文档描述与代码一致，且每条语义有对应测试链接 |
| M8.5-3 | **仓库结构与 §6 不符**：无 `packages/git`、`packages/ui`（git 服务在 `apps/desktop/src/main/git`，UI 组件散在 renderer） | 契约文档与现实不符会持续误导 | 二选一并落 ADR：抽包，或修改 §6 承认现结构 |
| M8.5-4 | **评测集只有 baseline，没有成功率** | §13.3 的正确性/克制性/安全性指标目前是空的，无法判断模型或依赖升级是否退化 | 11 个 fixture 跑至少 2 个模型 × 3 次，记录成功率与无关修改率 |
| M8.5-5 | **性能基准只覆盖 Diff 解析** | §15 要求「大型会话」性能，长会话事件吞吐与内存未测 | 增加长会话（≥2000 事件）与超长 tool output 基准 |
| M8.5-6 | **API Key 仍短暂经过 Renderer** | 违反 §4.1「密钥不进 Renderer」的精神（M3-4 标记为 `[~]`） | 改为 Main 侧输入（native prompt / 独立 BrowserWindow），或落 ADR 明确接受该风险及理由 |
| M8.5-7 | **依赖版本仍大量 `^`** | §5 版本策略要求 MVP 不使用自动跟随最新 | 关键依赖钉版；其余记录例外清单 |
| M8.5-8 | **卸载 / 数据位置 / 导出说明缺失** | §15 最后一条门槛 | `docs/data-lifecycle.md`：数据位置、清理、导出、卸载 |
| M8.5-9 | **未提交的 UI 重设计**（浅色主题 + `hiddenInset` 标题栏，8 文件 843 行改动） | 长期停在工作树里会与后续功能冲突 | 收敛为 design token 文档 + 提交；或明确回退 |
| M8.5-10 | **Composer 已承诺但未实现的能力**：placeholder 写着 `@ for files, / for commands, $ for skills`，三者都没实现 | UI 承诺不存在的功能，属于产品欺骗性缺陷 | 要么实现（见 §24.4），要么先改 placeholder |

> **M8.5 完成门槛：** §15 九条发布门槛逐条有可复现证据；§19 剧本在 packaged 应用内通过一次；本节 10 项全部 `[x]` 或有 ADR 说明为什么不做。

## 21.3 M8.5 之后才允许开新功能

理由是本项目已经出现过一次「Fake runtime 被误标为真实 Pi 打通」的进度失真（见 `docs/TODOS.md` §7）。增强阶段的每个阶段沿用同一约束：**先证据，后功能**。


# 22. Pi SDK 能力盘点（0.82.0）与未使用能力映射

> **本节存在的理由：** 规划「还能加什么功能」时，最低成本的来源不是发明新架构，而是**把已经付费引入、已经在进程内、但产品还没暴露的 SDK 能力接出来**。下表基于 `@earendil-works/pi-coding-agent@0.82.0` 的实际 d.ts surface 盘点。

## 22.1 AgentSession 能力 → 产品状态

| Pi SDK API | 可支撑的产品能力 | Desktop 现状 |
|------------|------------------|--------------|
| `prompt` / `abort` / `setModel` / `listModels` | 基础对话与模型切换 | **已接** |
| `steer` / `followUp` + `steeringMode` / `followUpMode` / `clearQueue` / `pendingMessageCount` | 运行中插话、排队策略、队列可视化与清空 | 部分接（IPC 有 steer/followUp，无模式与队列 UI） |
| `getContextUsage` / `getSessionStats` / `usage-totals` / `cache-stats` / `provider-attribution` | 上下文占用、Token、缓存命中、成本归因面板 | **未接**（UI 只显示 Pi 报告的粗粒度值） |
| `compact` / `abortCompaction` / `setAutoCompactionEnabled` / `SessionBeforeCompactEvent` | 长会话自动/手动压缩、压缩摘要卡片 | **未接**（长任务会直接撞上下文上限） |
| `setThinkingLevel` / `getAvailableThinkingLevels` / `supportsThinking` / `cycleThinkingLevel` | Thinking 档位控制（§2 主路径第 3 步明确要求，但未实现） | **未接** |
| `scopedModels` / `setScopedModels` / `cycleModel` | 模型编排：计划用强模型、执行用快模型、一键切换 | **未接** |
| `setActiveToolsByName` / `getAllTools` / `createReadOnlyTools` / `noTools` / `excludeTools` | **Plan Mode**、工具白名单、per-session 工具策略 | **未接** |
| `customTools` / `defineTool` | 注册桌面原生工具（todo、询问用户、MCP 桥、浏览器） | **未接** |
| `navigateTree` / `getUserMessagesForForking` / `SessionBeforeForkEvent` / `SessionTreeEvent` | Session Fork 与树状历史导航 | **未接** |
| `exportToHtml` / `exportToJsonl` | 会话导出、分享、issue 附件 | **未接** |
| `sendUserMessage([TextContent \| ImageContent])`，`steer/followUp(text, images)` | 图片输入：截图粘贴、UI 缺陷复现 | **未接** |
| `resourceLoader` / `promptTemplates` / `loadSkillsFromDir` / `BUILTIN_SLASH_COMMANDS` | `@` 文件引用、`/` 命令、`$` skills（Composer 已承诺） | **未接** |
| `bindExtensions` / `ExtensionRunner` / extension hooks（tool_call、tool_result、project_trust、resources_discover、session_*） | Extension Host：项目级自定义工具与钩子 | 仅用了 tool_call / tool_result 两个钩子做权限与快照 |
| `executeBash` / `recordBashResult` / `output-guard` | 用户自己跑命令且结果进入会话上下文（终端面板） | **未接** |
| `setAutoRetryEnabled` / `isRetrying` / `retryAttempt` / `abortRetry` | Provider 抖动自动重试与可见状态 | **未接** |
| `extensions/llama`（llama.cpp + HuggingFace） | 本地模型 Provider（M9-2 的现成实现） | **未接** |
| `setSessionName` / `sessionFile` / `reload` | 会话命名、外部编辑后重载 | 部分（rename 走 SQLite，未同步 Pi 会话名） |

## 22.2 SDK 明确**不提供**、需要自建的能力

| 能力 | 0.82.0 现状 | 自建方案 |
|------|-------------|----------|
| MCP | **无 MCP 支持**（全仓仅在 vendor 高亮库中命中字符串） | Desktop 侧实现 MCP client，把 MCP tool 适配成 Pi `customTools`（§24.5） |
| Todo / 任务清单工具 | 无内建 todo 工具 | 用 `defineTool` 注册 `desktop_todo_write`（§24.2） |
| Sub-agent / 多 Agent 编排 | 无 spawn-agent 工具 | Main 侧多 Session + `customTool` 触发子 Session（§24.7） |
| 文件级并行隔离 | Session 共享一个 cwd | `git worktree` per session（§24.7） |
| 远程 Workspace / SSH | 无 | Main 侧远程 FS/exec 抽象，工作量大，排到 M13 |

> **规划结论：** §24 中 Tier A 的绝大多数功能，成本集中在 **IPC + UI + 持久化**，Runtime 侧只是把已存在的 SDK 调用接出来。这是 MVP 之后性价比最高的一批工作。


# 23. 增强路线总览（M8.5 → M13）

| 阶段 | 主题 | 核心问题 | 完成门槛 |
|------|------|----------|----------|
| **M8.5** | 第一版收口 | 发布门槛没有逐条证据 | §21.2 十项关闭 |
| **M9** | 上下文与成本经济学 | 长任务撞上下文上限即失败，且成本不可见 | 单会话连续工作 ≥2 小时不因上下文中断；成本与上下文实时可见且与 Provider 账单量级一致 |
| **M10** | 计划与控制 | 用户无法在 Agent 动手前干预方向 | Plan → Approve → Build 全流程；Plan Mode 下零写操作（安全测试断言）；Fork 不损坏任何 Checkpoint |
| **M11** | 能力扩展 | Agent 只有 read/write/edit/bash 四把工具 | Skills / Slash / `@` 引用可用；Extension 与 MCP 工具全部经过既有权限管线；供应链风险有 trust 门 |
| **M12** | Provider 与本地推理 | 只依赖云 Provider，离线不可用、隐私不可控 | 本地模型完成 fixture 评测；Provider 健康状态可诊断；凭据不出本机 |
| **M13** | 工作流与分发 | 结果留在工作树里，且应用无法交付给他人 | Git 工作流闭环（stage/commit/branch/worktree）；签名 + Notarization + 自动更新；跨平台决策成文 |

> **阶段间约束（延续 §0 推进原则）：** 每个阶段独立 ADR + 评测 + 安全审查；任何阶段不得回侵 §7–§11 的四条硬契约——Renderer 无特权、权限判定在 Main、Checkpoint 是唯一可靠恢复源、Pi 类型不出 `agent-pi`。


# 24. 增强阶段方案设计

## 24.1 M9：上下文与成本经济学

**问题：** 当前一个长任务撞到模型上下文上限就直接失败，用户看不到「还剩多少上下文」，也看不到这次任务花了多少钱。这是目前最容易让产品在真实使用中崩掉的一环。

**方案：**

| 子项 | 设计 |
|------|------|
| 上下文仪表 | `session.getContextUsage()` 轮询 + `SessionBeforeCompactEvent` 推送 → 新事件 `context.updated`；UI 在 Composer 上方显示占用环（绿/黄/红三档） |
| 自动压缩 | `setAutoCompactionEnabled(true)` + 阈值写入 settings；压缩期间 UI 进入 `compacting` 状态（`AgentRunState` 需扩一个态） |
| 手动压缩 | `/compact [instructions]` → `agent.compact` IPC；支持自定义压缩指令（如「只保留与 auth 模块相关的上下文」） |
| 压缩摘要卡片 | `CompactionResult`（summary / tokensBefore / estimatedTokensAfter / usage）落 `compactions` 表；Chat 中渲染为可折叠特殊消息 |
| 成本归因 | `usage-totals` + `provider-attribution` + `cache-stats` → run / session / project 三级成本；缓存命中率单列（对 Anthropic 类 Provider 影响巨大） |
| 自动重试可见化 | `setAutoRetryEnabled` + `retryAttempt` → 事件 `run.retrying`，UI 显示「第 N 次重试」而不是假死 |

**安全影响：** 压缩摘要由模型生成，可能包含敏感文件片段；写入 SQLite 前走 `redactSecrets`，导出时同样脱敏。

**验收：** 构造一个必然超上下文的 fixture（大仓库全量 grep + 多轮修改），验证自动压缩后任务仍能完成，且压缩前后 Checkpoint 语义不变。

## 24.2 M10-a：Plan Mode 与 Todo

**问题：** §1.3 把 Plan Mode 列为 MVP 冻结项，理由是不阻塞主路径。但真实使用中「Agent 直接动手改错方向」是最贵的失败模式。M10 是解冻它的正确位置。

**Plan Mode 方案（SDK 已完全支持，无需 hack）：**

```text
SessionMode = 'build' | 'plan'

进入 plan：session.setActiveToolsByName(readOnlyToolNames)   // read / grep / find / ls
           + 计划专用 system prompt 片段
退出 plan：session.setActiveToolsByName(codingToolNames)     // + edit / write / bash
```

- 每个 Run 记录 `mode`；`agent_runs` 表加 `mode` 列。
- 计划产出以 Markdown checklist 形式落 `plans` 表；UI 提供「Approve plan」→ 把计划作为首条消息注入一个新的 build Run，并把 plan id 关联到该 Run。
- **权限管线仍然生效**：Plan Mode 下若出现 write/edit/bash 请求，视为契约违规 → 拒绝 + 审计 + UI 明确告警（这同时是一条安全测试断言）。
- 与 Checkpoint 的关系：plan run 不产生文件修改，因此不创建快照，但仍创建 `agent_runs` 记录以保留成本与耗时。

**Todo 方案（SDK 无内建，需自建）：**

- 用 `defineTool` 注册 `desktop_todo_write`（入参：`items: {id, text, status}[]`），Main 持久化到 `todos` 表并广播 `todo.updated`。
- UI 在 Chat 侧栏显示实时步骤清单；步骤与 tool call 时间轴对齐（复用 M8-2 的 RunMetrics）。
- 该工具风险等级 `safe`，不进审批队列。

## 24.3 M10-b：Session Fork 与树状历史

**方案：** `getUserMessagesForForking()` 列出可分叉点 → `navigateTree(targetId)` 切换；SDK 提供 `SessionBeforeForkEvent` / `SessionTreeEvent` 钩子供 Main 记账。

**数据模型：** `sessions` 增 `parent_session_id`、`fork_from_entry_id`。

**关键语义（必须写进 `checkpoint-semantics.md`）：**

> **Fork 只分叉对话历史，不分叉工作树。** 两个分支共享同一份文件系统状态。Checkpoint 归属 Run，fork 时**不复制**快照 BLOB，只保留引用；因此在 fork 分支上 Revert 一个 Run 时，必须校验当前文件 hash 是否仍与该 Run 的预期状态一致（M7-4 的冲突检测已提供此能力），不一致则拒绝自动覆盖。

文件级真正分叉需要 `git worktree`，属于 M13（§24.7）。

## 24.4 M11-a：Composer 能力补齐（`@` / `/` / `$`）

**问题：** placeholder 已经承诺，实现为零（§21.2 M8.5-10）。

| 触发符 | 数据来源 | 安全约束 |
|--------|----------|----------|
| `@file` / `@dir` | Main 侧 `resources.search` IPC，基于 workspace 内 ripgrep/fd | 只允许 workspace 内路径；遵守 protected paths；结果路径经 canonicalize |
| `@symbol` | ripgrep + 语言无关正则（首版不引入 LSP） | 同上 |
| `/command` | `BUILTIN_SLASH_COMMANDS` + `session.promptTemplates` | 内建命令走 Main 白名单分派，不允许任意字符串直通 |
| `$skill` | `loadSkillsFromDir`（`~/.pi/skills` + 项目 `.pi/skills`） | **项目内 skill 是代码级供应链风险**：必须在 Workspace Trust 之外再给一次显式启用确认，且列出 skill 来源路径 |

## 24.5 M11-b：Extension Host 与 MCP 桥

**Extension Host：** Pi 的 extension 是**在 Main 进程内执行的任意代码**。因此：

- 默认不加载项目内 extension；需要用户在 Trust 之后显式勾选启用清单（per-project，落 SQLite）。
- 加载结果、诊断与每次 hook 调用写审计日志。
- Extension 注册的工具**不绕过**权限管线：`getAllTools()` 得到的工具名统一进 tool-normalizer，未知工具默认风险等级取 `external-side-effect`（fail-closed）。

**MCP 桥（SDK 无 MCP，自建）：**

```text
MCP Server (stdio / http)
  ↓ Desktop MCP Client（Main 进程，独立子进程，超时/输出上限）
  ↓ tools/list → defineTool() 包装
Pi customTools → tool_call 钩子 → tool-normalizer → risk-classifier → policy-engine
```

- MCP 工具默认风险 `external-side-effect`，首次调用必须审批，支持 allow-session / allow-project 记忆。
- MCP server 进程纳入 M8-1 的进程树终止逻辑（退出/Abort 不留残留）。
- 需独立 ADR：为什么在 SDK 无 MCP 时自建桥、以及升级 SDK 后如何迁移。

## 24.6 M12：Provider 与本地推理

| 子项 | 设计 |
|------|------|
| 本地 llama.cpp | 直接复用 `@earendil-works/pi-coding-agent/dist/extensions/llama`（含 HuggingFace 模型拉取与 provider 实现）；UI 提供模型下载进度与本地端口配置 |
| OpenAI-compatible | 自定义 base URL + key 的 Provider 条目（覆盖 vLLM / LM Studio / Ollama / 自建网关） |
| Provider 健康检查 | 启动与切换时探测：凭据有效性、模型列表可达性、限流状态；结果缓存并在 Auth 行显示（现有 `agent.authStatus` 扩展） |
| 模型能力标签 | 来自 `model-registry` / `model-config`：context window、vision、thinking、tool use；UI 在模型下拉中显示，避免选到不支持工具调用的模型 |
| Mac + 4090 节点 | 4090 侧跑 OpenAI-compatible server，Mac 侧作为客户端；**Workspace 与文件永不出本机**，只有 prompt/completion 过网；链路走 Tailscale 或 SSH 隧道，需 ADR + 安全审查（明确 prompt 中会包含源码片段这一事实） |

## 24.7 M13：Git 工作流、并行与分发

| 子项 | 设计 | 风险等级 |
|------|------|----------|
| Stage / Unstage（含 hunk 级） | Main 侧 git 服务扩写操作，复用 Pierre diff 的 hunk 结构 | 需审批（写操作） |
| Commit message 生成 | 用当前会话模型 + 暂存区 diff 生成候选，用户可编辑；**不自动提交** | commit 高风险，必须审批 |
| Branch / `git worktree` 隔离 | 每个 Session 可选绑定独立 worktree → 真正的并行运行基础；Checkpoint 作用域随之绑定到 worktree 路径 | 高风险 |
| Push | **默认拒绝**，仅显式审批放行，且不提供「记住此决定」 | external-side-effect |
| 终端面板 | `executeBash` + `recordBashResult` + `output-guard`：用户自己跑命令，结果进入会话上下文，省掉 Agent 重复探索 | 用户主动执行，仍记审计 |
| 会话导出 | `exportToHtml` / `exportToJsonl` + 导出前脱敏 | — |
| 并行多 Agent | 前提是 worktree 隔离 + 事件路由（已有 projectId/sessionId/runId 作用域）；子 Agent 通过 `customTool` 触发新 Session，父会话只拿摘要 | 需 ADR |
| 签名 / Notarization / 自动更新 | Developer ID 签名 + notarytool + electron-updater；更新源与签名校验策略成文 | 需 ADR |
| 跨平台 | Windows/Linux 需重做：`node:sqlite` 可用性、Keychain → `safeStorage`、进程树终止（`taskkill /T` vs pgid）、路径大小写与符号链接语义 | 需 ADR |


# 25. 功能候选清单与优先级

> 排序依据：**对「个人日常连续使用」的边际收益 ÷ 实现成本**，并优先选择 SDK 已支持、只差 IPC/UI 的项。

## 25.1 Tier A — 直接决定日常可用性（建议 M9–M11 内完成）

| # | 功能 | 依据 | 成本 | 说明 |
|---|------|------|------|------|
| A1 | 上下文占用仪表 + 自动/手动压缩 | §24.1 | 中 | **最高优先**：不做这个，长任务必然中断 |
| A2 | Thinking Level 选择器 | §22.1 | 低 | §2 主路径第 3 步已要求，却一直没实现 |
| A3 | Token / 成本 / 缓存命中面板 | §24.1 | 中 | 成本不可见 = 不敢长时间用 |
| A4 | `@` 文件引用 + `/` 命令 + `$` skills | §24.4 | 中 | UI 已承诺，属于必须兑现 |
| A5 | Plan Mode（Plan → Approve → Build） | §24.2 | 中 | 最贵失败模式（方向跑偏）的直接解药 |
| A6 | Todo / 步骤清单 | §24.2 | 低 | 长任务的可理解性，对齐 §13.3「透明度」 |
| A7 | 图片输入（截图粘贴 / 拖拽） | §22.1 | 低 | UI 类任务的输入效率提升极大 |
| A8 | 跟进队列可视化 + 清空 + 排队模式 | §22.1 | 低 | `clearQueue` / `pendingMessageCount` 已存在，纯 UI |
| A9 | 全局命令面板 + 键盘快捷键 | — | 低 | 桌面应用的基本素养，当前全靠鼠标 |
| A10 | 跨会话搜索（消息 / tool / 文件） | — | 中 | SQLite FTS5；会话变多后没有搜索等于数据坟场 |
| A11 | 自动重试状态可见化 | §24.1 | 低 | 把「假死」变成「重试中」 |
| A12 | 会话导出（HTML / JSONL，脱敏） | §24.7 | 低 | SDK 一行调用 |
| A13 | 模型能力标签 + 模型编排（scopedModels） | §24.6 | 中 | 避免选到不支持 tool use 的模型 |

## 25.2 Tier B — 结构性能力（M11–M13）

| # | 功能 | 依据 | 成本 |
|---|------|------|------|
| B1 | Session Fork + 树状历史 | §24.3 | 中 |
| B2 | Extension Host（显式启用 + 审计） | §24.5 | 中 |
| B3 | MCP 客户端桥 | §24.5 | 高 |
| B4 | 终端面板（用户命令进上下文） | §24.7 | 中 |
| B5 | Git stage / commit + message 生成 | §24.7 | 中 |
| B6 | `git worktree` 隔离与并行 Session | §24.7 | 高 |
| B7 | 本地 llama.cpp Provider | §24.6 | 中 |
| B8 | OpenAI-compatible 自定义 Provider | §24.6 | 低 |
| B9 | Provider 健康检查与诊断 | §24.6 | 中 |
| B10 | Diff 行级评论 / 行级指令（选中行 → 让 Agent 改这里） | §3 后续增强 | 中 |
| B11 | 项目分组与工作区收藏 | §3 后续增强 | 低 |
| B12 | 会话模板 / 项目级 prompt 预设 | `promptTemplates` | 低 |

## 25.3 Tier C — 产品化与生态（M13+，需先有稳定用户价值）

| # | 功能 | 成本 | 前置条件 |
|---|------|------|----------|
| C1 | 签名 + Notarization + 自动更新 | 中 | 要对外分发才有意义 |
| C2 | Windows / Linux 支持 | 高 | ADR 先定平台抽象边界 |
| C3 | Mac + 4090 远程推理节点 | 中 | §24.6 安全审查 |
| C4 | 远程 Workspace / SSH | 高 | Main 侧 FS/exec 抽象重构 |
| C5 | 多 Agent 编排（父子任务分解） | 高 | B6 worktree 隔离 |
| C6 | 会话分享 / 团队协作 | 高 | 涉及服务端，超出「本地优先」定位，需先决定产品形态 |
| C7 | 崩溃上报与匿名遥测（默认关闭） | 低 | 隐私策略成文 |
| C8 | 浏览器工具（截图 / DOM 检查） | 高 | 权限面显著扩大，需独立安全审查 |

## 25.4 明确不做（延续 §1.3 精神）

- 云端会话同步与账号体系：与「本地优先、数据不外传」定位冲突。
- 自建多 Provider 抽象层：§17 已决策交给 Pi。
- 内置完整编辑器（Monaco/LSP）：本产品是 Agent 工作台，不是 IDE；行级编辑交回用户的编辑器。
- 插件市场：在 Extension 安全模型成熟前不做分发。


# 26. 协议与数据模型演进

## 26.1 IPC 增量（保持 §4.1 「全部 Zod 校验」）

| 阶段 | 新增 method | 新增事件 |
|------|-------------|----------|
| M9 | `agent.compact`、`agent.setAutoCompaction`、`agent.getContextUsage`、`agent.setThinkingLevel`、`session.getStats` | `context.updated`、`compaction.completed`、`run.retrying` |
| M10 | `agent.setMode`、`plan.approve`、`plan.list`、`session.fork`、`session.navigateTree`、`session.listForkPoints` | `todo.updated`、`plan.updated`、`mode.changed` |
| M11 | `resources.search`、`skills.list`、`skills.setEnabled`、`commands.list`、`extensions.list`、`extensions.setEnabled`、`mcp.addServer`、`mcp.listTools` | `extension.diagnostic`、`mcp.serverState` |
| M12 | `provider.testConnection`、`provider.addCustomEndpoint`、`localModel.download`、`localModel.status` | `provider.health`、`localModel.progress` |
| M13 | `git.stage`、`git.unstage`、`git.commit`、`git.generateCommitMessage`、`git.createWorktree`、`terminal.exec`、`session.export` | `terminal.output`、`worktree.changed` |

**约束：** 新增 method 一律走 `IpcCommandSchema` discriminated union；事件一律带 `projectId/sessionId/runId/sequence/timestamp`（§4.1 A4）；Renderer 仍无通用 invoke。

## 26.2 SQLite 迁移路线（当前 v10）

**已落地**（`packages/database/src/migrations.ts` 是唯一事实来源）：

| 版本 | 名称 | 内容 |
|------|------|------|
| v1–v3 | `sessions_and_schema_meta` / `projects` / `checkpoints_agent_runs_and_baseline_files` | 基础表 |
| v4–v5 | `checkpoint_write_snapshots` / `checkpoint_review_outcomes` | 写前快照 BLOB 与 Keep/Continue/Revert 结果 |
| v6 | `checkpoint_write_snapshot_expected_states` | 快照期望态（exists/sha256/size），Revert 前的冲突检测依据 |
| v7 | `checkpoint_recovery_conflicts` | 恢复冲突记录 |
| v8 | `sessions_soft_delete` | `sessions.deleted_at`，软删除 |
| v9 | `run_metrics` | 每次 run 的 token/成本/时长/结果，Usage 页面的数据源；此前指标只在内存里，重启即清零 |
| v10 | `workspace_index` | `index_files` + FTS5 `index_content` + `index_state`，跨项目搜索索引 |

**规划中**（版本号顺延，不复用上表）：

| 版本 | 阶段 | 内容 |
|------|------|------|
| v11 | M9 | `compactions`（session_id, run_id, summary, tokens_before, tokens_after, usage_json）；`agent_runs` 增 `cache_read_tokens`、`cache_write_tokens`、`retry_count` |
| v12 | M10 | `plans`（id, session_id, run_id, markdown, approved_at）；`todos`（id, session_id, run_id, text, status, ordinal）；`agent_runs` 增 `mode`；`sessions` 增 `parent_session_id`、`fork_from_entry_id` |
| v13 | M11 | `project_extensions`（project_id, source_path, enabled, enabled_at）；`mcp_servers`（id, name, transport, command_json, enabled）；`skill_grants`（project_id, skill_path, granted_at） |
| v14 | M12 | `provider_endpoints`（id, kind, base_url, model_ids_json）；`provider_health`（provider_id, checked_at, status, detail） |
| v15 | M13 | `worktrees`（session_id, path, branch, created_at）；`terminal_runs`（session_id, command, exit_code, output_path） |

**索引与信任的关系（§9 的延伸）：** 索引是文件内容的持久副本，因此只索引 trusted 项目；撤销信任时同步删除该项目的全部索引行（`IndexService.refresh` 在 untrusted 分支先 `deleteProject`），且搜索阶段再次按 trusted 过滤，防止残留行被读出。

**迁移约束（延续 §10.1）：** 每次迁移可前向、有备份、有回滚说明；快照 BLOB 表结构不做破坏性修改；含未解决 Checkpoint 时禁止执行破坏性迁移。


# 27. 增强阶段的测试、评测与风险追加

## 27.1 固定评测集扩展（在现有 11 个 fixture 之上）

| 新 fixture | 验证的能力 | 对应阶段 |
|------------|------------|----------|
| `context-overflow` | 必然超上下文的任务，自动压缩后仍完成 | M9 |
| `plan-then-build` | Plan Mode 只读、Approve 后按计划执行、无范围外修改 | M10 |
| `plan-mode-violation` | Plan Mode 下模型尝试写文件 → 必须被拒绝并审计 | M10（安全） |
| `fork-revert-safety` | Fork 分支上 Revert 不破坏另一分支与用户未提交修改 | M10（恢复性） |
| `skill-supply-chain` | 项目内恶意 skill / extension 未经启用不得执行 | M11（安全） |
| `mcp-tool-approval` | MCP 工具首次调用必须审批，且 deny 后不执行 | M11（安全） |
| `local-model-parity` | 本地模型在基础 fixture 上的成功率与成本对比 | M12 |
| `worktree-isolation` | 并行两个 Session 互不污染文件与 Checkpoint | M13 |

## 27.2 性能基准扩展

| 基准 | 目标 |
|------|------|
| 长会话事件吞吐（≥2000 事件） | UI 不掉帧，内存无单调增长 |
| 超长 tool output（≥10MB） | 尾部窗口策略生效，主进程内存有上限 |
| 压缩耗时与压缩后首 Token 延迟 | 压缩不让用户感觉「卡住」 |
| 多 worktree 并行下的 Git 操作 | 无锁竞争导致的假死 |

## 27.3 风险登记册追加（接 §16）

| 风险 | 影响 | 缓解 |
|------|------|------|
| 压缩丢失关键上下文 | Agent 遗忘约束、重复劳动、改错方向 | 压缩摘要可见可展开；支持自定义压缩指令；`context-overflow` fixture 回归 |
| Extension / Skill 供应链 | Main 进程内任意代码执行 | 默认不加载 + 显式启用 + 来源展示 + 审计 + 安全 fixture |
| MCP 桥扩大权限面 | 外部副作用不可控 | fail-closed 风险等级、强制审批、进程树纳管、超时与输出上限 |
| Fork 与 Checkpoint 语义耦合 | 误 Revert 破坏另一分支工作 | Fork 不复制快照 + 恢复前 hash 校验 + 冲突拒绝覆盖 |
| 本地模型能力不足 | 任务成功率骤降，用户误判产品质量 | 能力标签 + 本地模型评测报告 + 明确提示「本地模型能力受限」 |
| 远程推理节点泄露源码 | prompt 中含源码片段过网 | 明示数据流、隧道加密、可开关、ADR 记录接受的风险 |
| 并行 Session 冲突 | 文件互相覆盖 | worktree 强隔离；未隔离时禁止同项目并行写 |
| 增强阶段范围膨胀 | 又一次没有可用版本 | M8.5 门槛前不开新功能；每阶段独立门槛与 ADR |


# 28. ADR 队列

> 现有：ADR-0001（Electron + Pi）、ADR-0002（Pi SDK 版本锁定）。以下为按阶段应补的决策记录。

| 编号 | 主题 | 触发阶段 | 必须回答 |
|------|------|----------|----------|
| 0003 | `@pierre/diffs` 选型与版本策略 | M8.5（补记） | 为什么不用 Monaco；升级回归步骤 |
| 0004 | SQLite 驱动选择（`node:sqlite` 实验特性） | M8.5（补记） | 实验特性风险、packaged ARM64 验证、迁移到 better-sqlite3 的退路 |
| 0005 | 仓库结构对齐（抽 `packages/git`、`packages/ui` 还是修改 §6） | M8.5 | 依赖方向与收益评估 |
| 0006 | API Key 输入路径（Main 侧输入 vs 接受经 Renderer 的短暂暴露） | M8.5 | 威胁模型与取舍 |
| 0007 | 上下文压缩策略（自动阈值、摘要留存、成本记账） | M9 | 压缩失真的可接受边界 |
| 0008 | Plan Mode 实现方式（工具集切换 vs 独立 Session） | M10 | 为什么选 `setActiveToolsByName`；违规处理 |
| 0009 | Fork 语义（只分叉历史不分叉文件） | M10 | 与 Checkpoint 的交互规则 |
| 0010 | Extension / Skill 信任模型 | M11 | 启用门、审计、撤销 |
| 0011 | MCP 桥架构（SDK 无 MCP 时自建，未来迁移路径） | M11 | 进程模型、权限映射、SDK 支持 MCP 后如何退场 |
| 0012 | 本地推理与远程节点数据流 | M12 | 源码是否过网、加密与开关 |
| 0013 | Git 写操作与 worktree 隔离 | M13 | 审批边界、push 策略 |
| 0014 | 分发：签名、Notarization、自动更新源 | M13 | 更新校验与回滚 |
| 0015 | 跨平台抽象边界 | M13 | SQLite / Keychain / 进程树 / 路径语义


# 29. 实现期教训与反模式清单（v1.2）

> **本节存在的理由：** §1–§28 是开工前写的。这一节记录**实际实现后才知道的事** ——
> 一轮 v2 设计落地过程中发现并修掉的十个缺陷，抽象成可复用的反模式。四个是静默失败：
> 不报错、UI 看起来正常、但功能根本没运行。这类缺陷靠「跑一遍看看」发现不了，
> 必须靠清单。

## 29.1 反模式一：作用域过滤器吃掉了阻塞型事件

Renderer 的事件 store 按 `activeProjectId / activeSessionId / activeRunId` 过滤事件，
以防串台。但 Terminal 面板的审批请求带的是它自己的 session/run id ——
于是审批事件被静默丢弃，`await pending` 永不 resolve，命令永远挂着，用户什么也看不到。

**规则：** 任何**阻塞调用方**的事件（审批、确认、需要用户决策的一切）必须豁免作用域
过滤。丢一条这种事件不是「少显示一点」，而是死锁。

## 29.2 反模式二：生命周期声明只在成功路径释放

自动化在发 prompt **之前**先 `claimSession(sessionId)`（因为第一轮就可能触发审批）。
但释放只写在成功路径上。启动失败（Provider 不可用等）时 claim 永久残留 ——
之后**用户自己**在该 session 里的操作会被这条已死自动化的 mode 自动裁决；
`unattended` 下等于静默批准用户自己的写入。

**规则：** 任何「先声明、后释放」的配对必须在 `catch`/`finally` 里释放。
凡是涉及权限的 claim，泄漏就是提权漏洞，不是内存泄漏。

## 29.3 反模式三：把「下一次」当成「是否到点」

`nextRunAt()` 只返回**未来**时间；`isDue()` 判断 `next <= now`。两者组合的结果是
daily 自动化**永远不会触发**。功能写完、UI 正常、开关能开，就是不跑。

**规则：** 时间窗调度必须把「下一次触发时刻」和「当前是否应触发」当成两个概念分别
测试，且必须有「到点触发 / 未到点不触发 / 错过不补跑 / 同窗口不重复」四个用例。

## 29.4 反模式四：持有到「开始」而不是「结束」

并发保护 `running` 在 run *启动*后就释放，于是连点 Run now 或下一个 tick 会重复启动。

**规则：** 幂等保护的持有区间是整个操作的生命周期，不是它的启动阶段。

## 29.5 反模式五：状态归属搞错（选中 ≠ 正在运行）

「运行中」的红点和状态标签按**选中项**渲染。于是 A 在跑、你点开 B，B 被标成
running 并带脉冲动画。

**规则：** 运行态属于**持有该 run 的实体**（`activeSessionId`），与 UI 选中态无关。
两者必须是不同变量。

## 29.6 反模式六：主题反转打穿了照抄的前景色

设计稿的 dark map 把 accent 的**浅色底**（100/200）调暗了，却仍在标记里用
accent-800/900 当这些底上的**文字色**；neutral 阶梯整体反转后，
`neutral-200 on neutral-900` 也变成深底深字。照抄标记 = 暗色模式下大面积不可读。

**规则：** 逐字移植设计稿时，**底色与前景色必须成对检查**，不能各自独立照抄。
反转型主题里，「可读的强调色」在亮色下是深阶、在暗色下是浅阶 —— 需要专门的
语义 token（本项目用 `--color-output` / `--color-output-foreground` 与倒置的 accent 深阶）。

## 29.7 反模式七：设备像素比静默改变产物尺寸

Retina 屏上 `capturePage()` 返回 2× 尺寸，于是 `icon_512x512@2x.png` 变成 2048px ——
违反 icns 规范，而 `iconutil` **不报错**。差一点就发出一个尺寸错误的图标。

**规则：** 任何产出**固定尺寸产物**的光栅化步骤，必须显式归一化并断言尺寸，
不能相信渲染环境的 DPR。

## 29.8 反模式八：控件写了偏好，但没有任何代码读它

Density 开关把值存进了偏好，`data-density` 也上了 `<html>`，但没有一行 CSS 用它 ——
一个看起来能用、实际什么都不做的开关。

**规则：** 见 §31。开关的验收标准是「能观察到行为变化」，不是「值被持久化了」。

## 29.9 反模式九：文案描述的是意图而非实现

Composer 的提示写「writes + bash need approval」，但 `autoAllowWorkspaceWrite`
默认 `true` —— 写入本来就是自动放行的。文案不是过时，是**从来就不对**。

**规则：** 描述策略的字符串必须由策略的**同一数据源**推导（本项目：三档 mode →
提示表），不能手写。同理，Settings 里描述受保护路径、保留期、超时值的字符串
一律改为从 `app.getInfo` 读真值。

## 29.10 反模式十：把测试写在容易的地方，安全路径反而没测

最初只测了自动化的时间算术（纯函数，好测），而真正危险的自动审批决策路径
（unattended 自动放行 / read-only 自动拒绝 / 归属判断）零覆盖。

**规则：** 测试优先级按**出错后果**排序，不按易测程度排序。安全相关分支
（谁能自动放行、什么绝不放行、归属错了会怎样）必须有用例。

## 29.11 合并前清单

| 检查 | 为什么 |
|------|--------|
| 阻塞型事件是否豁免作用域过滤？ | §29.1 |
| 每个 claim 是否在失败路径也释放？ | §29.2 |
| 调度类逻辑是否有「到点/未到点/错过/重复」四用例？ | §29.3 |
| 幂等保护是否覆盖到操作结束？ | §29.4 |
| 「运行中」是否取自 run 归属而非 UI 选中？ | §29.5 |
| 新增/改动主题 token 后，暗色下是否逐对验证过底色+前景？ | §29.6 |
| 固定尺寸产物是否断言了尺寸？ | §29.7 |
| 每个新开关是否有可观察的行为变化？ | §31 |
| 描述策略的文案是否由策略数据源推导？ | §29.9 |
| 安全分支是否有测试？ | §29.10 |


# 30. 设计稿到实现的保真契约（v1.2）

> 本项目的主要工作流是「Claude Design 设计文件 → 实现」。这个工作流有固定的坑，
> 值得成文而不是每次靠临场判断。

## 30.1 设计稿里的数据是占位，不是需求

设计文件带完整的假数据（任务列表、终端历史、自动化、skills、搜索结果、Provider 条目）。
**这些一律不得进入应用**。它们的作用是描述**形状**（哪些字段、什么层级、什么状态），
不是描述内容。

判断标准：这一格的数据在真实运行时从哪个后端来？答不出来 → 说明缺后端，
按 §31 处理，而不是照抄假值。

## 30.2 设计稿可能有 bug，照抄就是把 bug 抄进产品

本轮实测在设计文件里发现三处问题：

1. dark map 的底色/前景色不成对（§29.6），暗色下不可读。
2. 图标模块自带注释 “only intended for CLI use, not browser environments” ——
   在 Electron 里必须跑在 Main（Node）而不是 Renderer。
3. Composer placeholder 承诺 `@ files / commands / $ skills` 三种能力，
   设计稿本身没有任何一处实现它们。

**规则：** 逐字移植的对象是**意图**，不是字节。移植时发现的设计缺陷要修，并在
代码注释里写清「设计稿这里是什么、为什么改」，否则下一个人会以为是实现走样。

## 30.3 CSS 语义 → 目标格式需要真换算

`linear-gradient(160deg, A, B)` 换成 SVG `linearGradient` 不能靠目测端点。
160° 的梯度线方向是 `(sin160, -cos160) = (0.342, 0.940)`，正方形上梯度长度
`|sin| + |cos| = 1.282`，端点即 `(0.281, -0.103) → (0.719, 1.103)`。
同类需要换算的还有：`border-radius` 百分比 → 绝对半径、`box-shadow inset`、
`::after` 叠加层的层序。

## 30.4 小尺寸允许简化，且应当简化

设计稿自己在小尺寸就丢掉了土堆细节。图标生成器照做（<128px 移除该元素）。
macOS iconset 本就是每尺寸一张图，这是规范内的正常做法，不是偷懒。

## 30.5 什么是合法的静态内容

标题、正文、说明文案、图标、tone/theme token 映射、快捷键标签（那**就是**绑定本身）
—— 这些天然静态，不需要动态化。需要动态化的是**声称在描述系统状态的一切**。


# 31. 诚实呈现契约（v1.2）

> 本仓库已经有过一次进度失真（见 `docs/TODOS.md` §7：把 Fake runtime 当成真 Pi 打通）。
> 这一节把「不许假装」从文化升级为可检查的契约。

## 31.1 三种允许的形态，一种禁止的形态

| 形态 | 何时用 | 例 |
|------|--------|-----|
| **真实可交互** | 后端存在 | 主题切换、审批模式、自动化开关 |
| **真实只读** | 行为固定、值可读 | 受保护路径、保留期、终端上限 |
| **明确缺失** | 无后端 | 不渲染，或渲染为 `—` + 「未记录」说明 |
| ~~**惰性控件**~~ | **禁止** | 能点、能存、但没有任何代码读它 |

## 31.2 未知值不得编造

数值未上报就显示 `—` 并说明「未记录/未上报」，绝不填 0、绝不填示例值。
已在 `lib/status.ts` 用 `NOT_REPORTED` 统一。

## 31.3 未实现的入口要么不给，要么明确禁用

设计里存在但后端没有的入口：`disabled` + tooltip 说明未实现，或直接不渲染。
不允许「点了没反应」。

## 31.4 Feature 的完成定义

一个功能称得上「已实现」需同时满足：

1. 有真实后端（不是 Renderer 里的假数据）；
2. 跨进程边界有 Zod 校验的 typed IPC；
3. 有测试，且覆盖到失败/安全分支；
4. 界面上出现的每个数字/路径/状态都来自真实数据源；
5. 已知限制写进代码注释或本文档（例：终端无 PTY、`allow-project` 不跨重启）。


# 32. 状态存放清单（v1.2）

> §10 只覆盖 SQLite。实际状态已散落在四处，缺一张总表就会出现
> 「以为持久化了其实没有」的问题 —— 下表最后两行正是这种情况。

| 状态 | 位置 | 跨重启 | 含密 | 备注 |
|------|------|--------|------|------|
| Project / Session / Checkpoint / 快照 BLOB | SQLite（Main） | ✅ | ✖ | §10，迁移至 v5 |
| Provider API Key | Main 私有文件，safeStorage 加密 | ✅ | ✅ | 不进 SQLite / 日志 / Renderer 持久层 |
| Provider OAuth 凭据 | Pi `AuthStorage`（auth.json） | ✅ | ✅ | Pi 自行刷新，见 §24.6 |
| 自动化定义 | Main 私有 JSON | ✅ | ✖ | 迁 SQLite 是 §26.2 v6 |
| Skill 启用状态 | Main 私有 JSON | ✅ | ✖ | 文件本身是 source of truth |
| 默认审批模式 / UI 行为开关 | Main 私有文件 | ✅ | ✖ | 通知、信任新项目、默认项目目录 |
| 主题 / 密度 / 动效 / diff 视图 | Renderer localStorage | ✅ | ✖ | 纯呈现偏好，无需特权，故不走 IPC |
| Pi Session（对话内存） | Pi 进程内 | ✖ | — | 重启后按 SQLite 记录惰性重建 |
| **Run 指标（时长/token/成本/工具数）** | **仅内存** | **✖** | ✖ | **应持久化**：Home 五处占位全靠它，§26.2 v6 |
| **`allow-project` 记忆规则** | **仅内存** | **✖** | ✖ | **应持久化**：否则「记住此项目」名不副实，Settings 已如实说明 |


# 33. 可访问性与本地化基线（v1.2）

> 现状：设计系统自带 `:focus-visible` 焦点环、`prefers-reduced-motion` 已实现、
> 交互控件已带 `role=switch / radiogroup / dialog + aria-modal`。但本文档此前
> 完全没有这一节，没有验收标准就会随迭代退化。

## 33.1 必须保持

- **键盘可达：** 主路径（开项目 → 建任务 → 发消息 → 审批 → Review → Keep/Revert）
  全程可仅用键盘完成；⌘K 面板支持 ↑↓/↵/esc。
- **焦点可见：** 一律用设计系统的 2px accent `:focus-visible`，不得移除。
- **动效可关：** OS 的 `prefers-reduced-motion` 无条件生效，另有应用内开关。
- **状态不只靠颜色：** 运行态同时有文字标签（`running` / `waiting_for_approval`），
  不能只靠圆点颜色区分。

## 33.2 已知不足

- 设计系统 readme 明确说明 accent 与底色对比约 3:1 —— **只够图标、大字和界面装饰，
  不够正文**。正文用 accent 时必须取深阶（亮色下 `accent-700`+）。
- 未做屏幕阅读器实测；流式输出区域尚未加 `aria-live`（长时间流式更新对读屏不友好）。
- 未做键盘焦点陷阱测试（模态框内 Tab 循环）。

## 33.3 本地化：一个待决问题

`index.html` 声明 `lang="zh-CN"`，但全部界面文案是英文；文档与提交信息是中文。
这是不一致，需要一个决定：

- **A**：界面保持英文 → 把 `lang` 改成 `en`，文档继续中文。
- **B**：界面本地化 → 引入 i18n 层（文案外置、复数/日期本地化），并接受它会影响
  §29.9 的「文案由数据源推导」实现方式。

MVP 阶段建议 A（改一行、消除不一致），B 排到 M13 产品化时再评估。


# 34. 构建环境不变量（v1.2）

> 本轮踩过的坑，写下来避免重复发现。

| 约束 | 后果 | 应对 |
|------|------|------|
| `index.html` 的 CSP 是 `default-src 'self'` | 远程字体/脚本一律加载失败 | 字体不走 Google Fonts；需要精确排版时把 woff2 vendored 进仓库 |
| ImageMagick 内置 SVG 渲染器不支持渐变/clipPath | 输出一个纯黑方块，且**不报错** | 光栅化走 Electron 自带 Chromium（`pnpm icon:generate`） |
| `npx electron` 会拉一个未钉版本的 Electron | 与应用实际运行版本不一致，且触发网络下载 | 一律用 `./apps/desktop/node_modules/.bin/electron` |
| Retina 屏 `capturePage()` 返回 2× | 固定尺寸产物尺寸错误 | 显式归一化并断言（§29.7） |
| `@pierre/diffs` 的 CodeView 无行号/字号 props | 相关设置无法实现 | Settings 不渲染这两行（§31） |
| Electron 离屏窗口循环创建/销毁不稳定 | 第二次 `loadFile` 报 `ERR_FAILED` | 复用单窗口，多次 `loadFile` |
