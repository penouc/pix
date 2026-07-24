# Pi Agent Desktop

> 本地桌面 Coding Agent 产品与工程开发总计划
>
> PRODUCT & ENGINEERING PLAN · Version 1.0 · 2026-07-24

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

## 9.3 必须覆盖的威胁
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
- [ ] 在测试仓库中完成一次真实代码修改和测试运行。

> **完成门槛：** 不打开 Pi TUI，也能从桌面窗口完成一次真实编码任务。
>
> **进度台账：** 见 [`docs/TODOS.md`](./docs/TODOS.md)。已锁 Pi `0.82.0` 并实现 `PiAgentRuntime`；**M1 门槛仍未关闭**。


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
- [ ] 在 Main Process 创建 Pi Session 并发送第一条消息。（Session 创建已通；真模型消息待鉴权）
- [ ] 把 message delta 和 tool events 显示到 Renderer。（映射已接；真流待鉴权）
- [ ] 实现 Stop，并验证 Bash 子进程树被终止。
- [ ] 准备测试 React 项目，要求 Agent 修改组件并运行测试。
- [ ] 生成 packaged macOS build，验证 Pi SDK 仍能运行。
- [ ] 记录技术验证结果，决定是否继续 SDK 路线或切换 Pi RPC 备用路线。

> **执行台账：** 全部勾选状态以 [`docs/TODOS.md`](./docs/TODOS.md) 为准。

## 18.1 技术验证通过后的下一批任务
- [ ] 实现 Project、Workspace Trust 和最近项目。
- [ ] 实现 Session Repository 与 SQLite migration。
- [ ] 实现 Provider/Model 选择和安全凭据存储。
- [ ] 实现完整 Agent Chat、Tool Cards 和 Event Batching。
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
