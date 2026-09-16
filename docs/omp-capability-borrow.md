# OMP 能力借鉴清单

> 来源：[oh-my-pi / OMP](https://omp.sh/)  
> 策略：**不换内核**（继续 `@earendil-works/pi`），把 OMP 当竞品功能雷达；能接线的接线，值得学的学交互/算法，重的自建并走 PiX 权限与 Checkpoint。  
> 对照：[`product-and-engineering-plan.md`](./product-and-engineering-plan.md) §22–§24  
> **进度跟踪（完成状态）：** [`omp-capability-todo.md`](./omp-capability-todo.md)  
> **新装 / 首启（尚未实现）：** [`onboarding.md`](./onboarding.md)  
> **Harness 机制雷达（dsh，勿混）：** [`dsh-capability-borrow.md`](./dsh-capability-borrow.md) · [`dsh-capability-todo.md`](./dsh-capability-todo.md)

---

## 紧急可选池（21 条）

**已确认：原 20 条 + #21 Auto 模型请求全部纳入。** 权威进度在 [`omp-capability-todo.md`](./omp-capability-todo.md)；下表勾选与之同步（**21/21 全部完成** · 截至 v0.4.0）。

下表保留编号与说明；排序按「个人日用紧急度 × 投入产出」。

| # | 能力 | 为什么紧急 | 路径 | 粗估 |
|---|------|------------|------|------|
| 1 | [x] **Compaction + 上下文用量** | 长任务撞 context 是最常见崩法 | 接线 Pi | S |
| 2 | [x] **Thinking level 控制** | 会话可选 thinking 深度 | 接线 Pi | S |
| 3 | [x] **Plan Mode（只读再动手）** | 防 Agent 一上来就改错方向 | 接线 Pi | M |
| 4 | [x] **Composer `@` 文件引用** | UI 已承诺；选文件进上下文 | 接线 Pi / Main 搜索 | M |
| 5 | [x] **Composer `$` skills** | Skills 发现已有，Composer 触发不齐 | 接线 Pi | S |
| 6 | [x] **Composer `/` 命令** | 同上；compact/model 等入口 | 接线 Pi | S |
| 7 | [x] **成本 / token / cache 面板** | 看不见花销就无法控成本 | 接线 Pi | S |
| 8 | [x] **Auto-retry 可见化** | Provider 抖动时像卡住 | 接线 Pi | S |
| 9 | [x] **Steer 队列 UI** | IPC 有、策略/队列展示弱 | 接线 Pi | S |
| 10 | [x] **Session Fork** | 试探分支不毁主线对话 | 接线 Pi | M |
| 11 | [x] **Todo 步骤清单工具** | 长任务可跟踪；Pi 无内置 | 自建 `defineTool` | S |
| 12 | [x] **Ask 结构化追问** | 减少瞎猜；可点选回答 | 自建 | S |
| 13 | [x] **Hashline / 锚点编辑** | OMP 最大编辑收益；少坏 patch | 移植思路 | M–L |
| 14 | [x] **LSP 工具（诊断/引用/重命名）** | `@symbol` 与重构质量跃迁 | 自建 | L |
| 15 | [x] **grep/glob 一等工具** | 少靠 bash 搜；更稳更省 token | 接线 Pi / 自建 | M |
| 16 | [x] **结构化 Git 工具**（status/diff/hunk） | Agent 看变更不靠糊 bash | 自建 | M |
| 17 | [x] **智能拆 commit（需审批）** | 日用收尾；永不自动 push | 移植思路 | M |
| 18 | [x] **web_search（单 provider 起步）** | 查文档/报错；须走外部副作用审批 | 自建 | M |
| 19 | [x] **MCP 桥（经权限管线）** | 扩展工具生态；官方 Pi 无 MCP | 自建（原 M11） | L |
| 20 | [x] **跨会话 memory / learn→skill** | 项目习惯沉淀；可先 SQLite | 自建 / 移植思路 | M |
| 21 | [x] **Auto 模型请求** | 不钉死单一模型；代选 + 角色路由 + 失败换模 | 接线 Pi + 产品化 | M |

**路径图例：** 接线 Pi = 官方 SDK 已有，主要做 IPC/UI；自建 = Desktop 工具或服务；移植思路 = 学 OMP，不搬其 Bun/natives 栈。  
**粗估：** S ≈ 数天；M ≈ 1–2 周；L ≈ 2 周+。

> **命名注意：** PiX 审批模式里已有文案「Auto」（`auto-reads`）。**#21 是模型 Auto**，产品文案需区分（例如「Auto model」vs 审批「Auto」），避免用户搞混。

### 批次落地摘要

| Batch | 项 | 落地要点（实现侧） |
|-------|----|--------------------|
| A | #1–10、#21 | Compaction / Thinking / Plan·Build / Composer `@$/` / Usage / retry / Steer / Fork / Auto 模型路由 |
| B | #11–12 | `todo`、`ask` 自定义工具 + UI（Dock Todo、AskDialog）；走权限管线且 `safe` |
| C | #13–15 | hashline `edit` + `hash_lines`；TS 进程内 `lsp_*`；会话默认启用 `grep`/`find`/`ls` |
| D | #16–20 | `git_*` + `git_commit`；`web_search`（DuckDuckGo）；`.pi-desktop/mcp.json` → `mcp__*`；`memory` / `learn` |

细节、验收标准与测试状态见 [`omp-capability-todo.md`](./omp-capability-todo.md)。

### 推进顺序

紧急池已全部勾完。后续从下方「完整能力对照」里挑下一批（对照表「建议路径」仍为雷达，**不是**承诺排期）。Harness 层缺口（spill、循环卫生、OS sandbox、Trajectory）见 [`dsh-capability-borrow.md`](./dsh-capability-borrow.md)，不要把 dsh 项填回本表。

### 明确不进本轮池（避免分心）

- 整核换成 `@oh-my-pi/*`
- `computer` 桌面操控、`/collab` 实时协作
- DAP 真调试器、Vibe/多 Agent hub（等 worktree 后再说）
- 默认敞开 browser/MCP 而不经审批

---

## 完整能力对照

每项标签：

- **接线 Pi**：官方 Pi 已有或接近，主要产品化
- **自建**：需 `customTools` / Main 服务 / 权限扩展
- **移植思路**：学交互或算法，不搬 OMP 运行时
- **低优先 / 跳过**：定位冲突或性价比低

「PiX 现状」相对紧急池完成态更新；未进池项仍可能是「无」。

### A. 编辑与代码修改

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Hashline edit | hash 锚点改文件，少 token、少 stale patch | **已落地（#13）**：自定义 `edit` 覆盖 Pi 内置；`lineHash` + `oldHash`；坏锚点整批拒绝 | 移植思路（已做） |
| stale-anchor 拒绝 | 文件变了就拒 patch | **已落地（#13）**：`oldHash` 全文件校验 | 移植思路（已做） |
| ast_edit | ast-grep 结构改写，preview 再 Accept | 无 | 自建（中） |
| ast_grep | 结构查询 | 靠 bash/`grep` 工具 | 自建（中） |
| Preview then accept | 提案 → Accept 再落盘 | Diff + Keep/Revert 已有 | 移植思路 |

### B. 搜索与读取

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| grep / glob 一等工具 | 不靠 bash 搜 | **已落地（#15）**：会话默认启用 Pi `grep`/`find`/`ls`；Plan→Build 回退完整白名单 | 接线 Pi / 自建 |
| read 万能路径 | 文件/归档/PDF/URL/ssh 同一 read | 普通文件 | 移植思路（选子集） |
| 内部 URL schemes（`pr://` 等） | PR/冲突/子代理当 FS | 无 | 移植思路（选 1–2 个） |
| conflict:// 解冲突 | `@theirs/@ours/@base` | 无 | 自建（跟 Git 一起） |

### C. 代码智能（LSP / DAP）

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| LSP 工具 | diagnostics / refs / rename 等 | **已落地（#14）**：TS 进程内语言服务 — `lsp_diagnostics` / `lsp_references` / `lsp_rename`；经权限管线 | 自建（已做，先 TS） |
| 写时 LSP 联动 | rename 带 re-export | **部分**：`lsp_rename` 会改写跨文件引用/import | 自建（跟 LSP） |
| DAP debugger | 真调试步进 | 无 | 低优先 |

### D. 运行时与执行

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| bash + in-process coreutils | 少 fork | Pi bash 子进程 | 低优先 |
| eval（持久 Python/JS） | notebook + 回调工具 | 无 | 自建（中，安全面大） |
| output-guard | 防输出撑爆上下文 | 事件层有截断 | 接线 Pi + 产品化 |
| 用户终端 → 会话上下文 | 用户命令进 transcript | terminal 未进 agent | 接线 Pi |

### E. 上下文与会话

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 自动/手动 compaction | 长会话不撞墙 | **已落地（#1）**：协议 + Compact 按钮 + Composer context 用量 | 接线 Pi（已做） |
| TTSR 流中注入规则 | 跑偏中止并注入规则 | 无 | 移植思路（中） |
| checkpoint / rewind（对话态） | 折叠探索上下文 | 文件 Checkpoint 语义不同 | 移植思路（勿撞名） |
| Session fork | 从某条消息分叉 | **已落地（#10）**：`forkPoints` / `forkSession` + UI Fork | 接线 Pi |
| `/fresh` | 重置 provider 流 | 无 | 接线 Pi / 小自建 |
| steer / followUp / 队列 | 跑着插话 | **已落地（#9）**：Queue/Steer UI + `agent.steer` | 接线 Pi |

### F. 规划与人机协作

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Plan mode | 只读工具集 | **已落地（#3）**：Plan/Build 工具集 + 安全 fail-closed + Approve→Build | 接线 Pi |
| todo | 步骤清单 | **已落地（#11）**：`todo` 工具 + SQLite + Dock 面板；风险 `safe` | 自建 |
| ask | 结构化追问 | **已落地（#12）**：`ask` + AskDialog；阻塞至用户回答 | 自建 |
| Magic keywords | 散文触发特殊行为 | 无 | 移植思路（低；不如模式按钮） |
| Vibe mode | 导演 + 只读工人 | 多 Agent 冻结 | 低优先 |

### G. 多 Agent / 并行

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| task 子代理 + yield | 并行工人 | 非 MVP / M13 | 自建（后置） |
| hub | 监督后台任务 | 无 | 低优先 |
| advisor | 第二模型审每一轮 | 无 | 移植思路（中） |
| worktree 隔离 | 文件级隔离 | roadmap M13 | 自建 |

### H. 记忆与 Skills

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| retain / recall / learn | 跨会话记忆 | **已落地（#20）**：`memory` → `.pi-desktop/agent/memory.json`；recall=`safe`，retain/forget=`workspace-write` | 自建（已做，JSON 无云） |
| learn → skill | 教训沉淀为 skill | **已落地（#20）**：`learn` 写 `.pi/skills/<name>/SKILL.md` | 移植思路（已做） |
| 继承 Cursor/Claude/Codex rules | 读盘上已有规则 | 主要跟 Pi skills | 自建（中） |
| `/` `$` `@` Composer | 已承诺能力 | **已落地（#4–6）**：`@`（含 protected 过滤）/ `$` skills / `/` 命令菜单 | 接线 Pi（已做） |

### I. 外部世界

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| web_search | 多后端搜索 | **已落地（#18）**：单 provider（DuckDuckGo HTML）；风险 `external-side-effect`；Plan 阻断 | 自建（已做，单 provider） |
| github / github-as-fs | PR/issue 当路径 | shell + gh | 移植思路 |
| browser（Puppeteer/CDP） | Agent 开车页 | **P1 预览宿主已落地**：Dock `WebContentsView` + localhost Select→Composer；Agent 工具仍无（C8 / P2） | 自建（高风险；P2） |
| computer（OS 操控） | 截屏/键鼠/AX | 无 | 跳过 |
| generate_image / tts | 多媒体 | 非核心 | 低优先 |
| 图片理解 / 粘贴截图 | UI bug 复现 | Composer 可贴图（roadmap 余量） | 接线 Pi / 小自建 |
| MCP 内置 | 接 MCP servers | **已落地（#19）**：`.pi-desktop/mcp.json` → `McpBridge` stdio；工具名 `mcp__{server}__{tool}`；未知 fail-closed；默认 `sensitive`；dispose 清子进程 | 自建（已做） |

### J. 模型路由

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| **Auto 模型请求（产品化）** | 用户选 Auto：代选 + 角色路由 + 失败换模 | **已落地（#21）**：Composer Auto + 角色链 + fallback + UI `model.auto-switched` | 接线 Pi + 产品路由层 |
| 多 role 模型 | plan/fast/smol… | **部分（#21）**：至少 `default` + `plan` 档 | 接线 Pi（含在 #21） |
| fallback chains | 429 换模型 | **已落地（#21 + #8）**：换模 + retry 可见化 | 接线 Pi |
| path-scoped models | 目录绑模型 | 无 | 移植思路（低） |
| round-robin keys | 多 key 轮转 | 无 | 低优先 |
| 本地 llama / Ollama | 本地推理 | M12；Pi 有 llama ext | 接线 Pi |

### K. Git

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 原子拆 commit | 按依赖拆提交 | **已落地（#17）**：`git_commit`（本地、禁 push）+ `ask` 提案多 commit；`workspace-write` 审批；Plan 阻断 | 移植思路（已做） |
| git_overview / hunk 工具 | 结构化看 git | **已落地（#16）**：`git_status` / `git_diff` / `git_log`；hunk 走全量 patch（无独立 `git_hunk`）；解析对齐 Diff 面板 | 自建 |
| `/review` P0–P3 | 带裁决的 review | example skill | 移植思路 |

### L. 协作与分发

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| /collab | 分享实时会话 | 非目标 | 跳过 |
| ACP 编辑器内嵌 | Zed 等宿主 | PiX 自己是壳 | 跳过 |
| RPC/stdio | 外进程驾驭 | in-process | 低优先 |
| 插件 marketplace | 扩展分发 | Extension 信任门计划中 | 移植思路（后） |

### M. 安全（对照学，不照搬）

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 破坏性操作审批 | 权限提示 | Ask/Auto/Read-only + Automations；Batch D 工具已纳入 risk/Plan 规则 | **保持自有模型** |
| security_scan | 云/本地安审 | 无 | 低优先（可用 skill） |

---

## 与「换内核」的关系（归档）

全量 `@earendil-works` → `@oh-my-pi` **不划算**：Electron×Bun、natives 打包、默认工具面爆炸。默认策略是留在官方 Pi，按本清单勾选借鉴。紧急池 21 条已完成，后续仍按「接线 / 自建 / 移植思路」从对照表增量挑选，不换核。

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-07 | 初版：完整对照 + 20 条紧急可选池 |
| 2026-08-07 | 新增 #21 Auto 模型请求；池扩为 21 条 |
| 2026-08-07 | Batch D（#16–20）完成；紧急池 21/21 |
| 2026-08-07 | 同步完整对照表「PiX 现状」与批次落地摘要（对齐 v0.4.0 / todo 21/21）；推进顺序改为从对照表挑下一批 |
| 2026-08-07 | 链到 [`onboarding.md`](./onboarding.md)（新装 checklist 约定） |
| 2026-08-17 | 交叉链接 [`dsh-capability-borrow.md`](./dsh-capability-borrow.md)（harness 机制雷达；与本表功能雷达分工） |
