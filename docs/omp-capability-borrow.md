# OMP 能力借鉴清单

> 来源：[oh-my-pi / OMP](https://omp.sh/)  
> 策略：**不换内核**（继续 `@earendil-works/pi`），把 OMP 当竞品功能雷达；能接线的接线，值得学的学交互/算法，重的自建并走 PiX 权限与 Checkpoint。  
> 对照：[`product-and-engineering-plan.md`](./product-and-engineering-plan.md) §22–§24  
> **进度跟踪（完成状态）：** [`omp-capability-todo.md`](./omp-capability-todo.md)

---

## 紧急可选池（21 条）

**已确认：原 20 条 + #21 Auto 模型请求全部纳入。** 完成状态请只在 [`omp-capability-todo.md`](./omp-capability-todo.md) 更新，避免两处打架。

下表保留编号与说明；排序按「个人日用紧急度 × 投入产出」。

| # | 能力 | 为什么紧急 | 路径 | 粗估 |
|---|------|------------|------|------|
| 1 | [ ] **Compaction + 上下文用量** | 长任务撞 context 是最常见崩法 | 接线 Pi | S |
| 2 | [ ] **Thinking level 控制** | 主路径已承诺，未接线 | 接线 Pi | S |
| 3 | [ ] **Plan Mode（只读再动手）** | 防 Agent 一上来就改错方向 | 接线 Pi | M |
| 4 | [ ] **Composer `@` 文件引用** | UI 已承诺；选文件进上下文 | 接线 Pi / Main 搜索 | M |
| 5 | [ ] **Composer `$` skills** | Skills 发现已有，Composer 触发不齐 | 接线 Pi | S |
| 6 | [ ] **Composer `/` 命令** | 同上；compact/model 等入口 | 接线 Pi | S |
| 7 | [ ] **成本 / token / cache 面板** | 看不见花销就无法控成本 | 接线 Pi | S |
| 8 | [ ] **Auto-retry 可见化** | Provider 抖动时像卡住 | 接线 Pi | S |
| 9 | [ ] **Steer 队列 UI** | IPC 有、策略/队列展示弱 | 接线 Pi | S |
| 10 | [ ] **Session Fork** | 试探分支不毁主线对话 | 接线 Pi | M |
| 11 | [ ] **Todo 步骤清单工具** | 长任务可跟踪；Pi 无内置 | 自建 `defineTool` | S |
| 12 | [ ] **Ask 结构化追问** | 减少瞎猜；可点选回答 | 自建 | S |
| 13 | [ ] **Hashline / 锚点编辑** | OMP 最大编辑收益；少坏 patch | 移植思路 | M–L |
| 14 | [ ] **LSP 工具（诊断/引用/重命名）** | `@symbol` 与重构质量跃迁 | 自建 | L |
| 15 | [ ] **grep/glob 一等工具** | 少靠 bash 搜；更稳更省 token | 接线 Pi / 自建 | M |
| 16 | [ ] **结构化 Git 工具**（status/diff/hunk） | Agent 看变更不靠糊 bash | 自建 | M |
| 17 | [ ] **智能拆 commit（需审批）** | 日用收尾；永不自动 push | 移植思路 | M |
| 18 | [ ] **web_search（单 provider 起步）** | 查文档/报错；须走外部副作用审批 | 自建 | M |
| 19 | [ ] **MCP 桥（经权限管线）** | 扩展工具生态；官方 Pi 无 MCP | 自建（原 M11） | L |
| 20 | [ ] **跨会话 memory / learn→skill** | 项目习惯沉淀；可先 SQLite | 自建 / 移植思路 | M |
| 21 | [ ] **Auto 模型请求** | 不钉死单一模型；代选 + 角色路由 + 失败换模 | 接线 Pi + 产品化 | M |

**路径图例：** 接线 Pi = 官方 SDK 已有，主要做 IPC/UI；自建 = Desktop 工具或服务；移植思路 = 学 OMP，不搬其 Bun/natives 栈。  
**粗估：** S ≈ 数天；M ≈ 1–2 周；L ≈ 2 周+。

> **命名注意：** PiX 审批模式里已有文案「Auto」（`auto-reads`）。**#21 是模型 Auto**，产品文案需区分（例如「Auto model」vs 审批「Auto」），避免用户搞混。

### 推进顺序

推荐顺序与完成勾选，见 [`omp-capability-todo.md`](./omp-capability-todo.md)（#21 排在 Plan Mode 之后）。

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

### A. 编辑与代码修改

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Hashline edit | hash 锚点改文件，少 token、少 stale patch | Pi `edit`/`write` | 移植思路（高价值） |
| stale-anchor 拒绝 | 文件变了就拒 patch | Checkpoint/冲突检测部分有 | 移植思路 |
| ast_edit | ast-grep 结构改写，preview 再 Accept | 无 | 自建（中） |
| ast_grep | 结构查询 | 靠 bash/rg | 自建（中） |
| Preview then accept | 提案 → Accept 再落盘 | Diff + Keep/Revert 已有 | 移植思路 |

### B. 搜索与读取

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| grep / glob 一等工具 | 不靠 bash 搜 | bash + 本地 index | 接线 Pi / 自建 |
| read 万能路径 | 文件/归档/PDF/URL/ssh 同一 read | 普通文件 | 移植思路（选子集） |
| 内部 URL schemes（`pr://` 等） | PR/冲突/子代理当 FS | 无 | 移植思路（选 1–2 个） |
| conflict:// 解冲突 | `@theirs/@ours/@base` | 无 | 自建（跟 Git 一起） |

### C. 代码智能（LSP / DAP）

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| LSP 工具 | diagnostics / refs / rename 等 | 无；`@symbol` 计划用 rg | 自建（高价值） |
| 写时 LSP 联动 | rename 带 re-export | 无 | 自建（跟 LSP） |
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
| 自动/手动 compaction | 长会话不撞墙 | Not wired（Pi 有 API） | 接线 Pi（P0） |
| TTSR 流中注入规则 | 跑偏中止并注入规则 | 无 | 移植思路（中） |
| checkpoint / rewind（对话态） | 折叠探索上下文 | 文件 Checkpoint 语义不同 | 移植思路（勿撞名） |
| Session fork | 从某条消息分叉 | Not wired | 接线 Pi |
| `/fresh` | 重置 provider 流 | 无 | 接线 Pi / 小自建 |
| steer / followUp / 队列 | 跑着插话 | IPC 部分有 | 接线 Pi |

### F. 规划与人机协作

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| Plan mode | 只读工具集 | Not wired | 接线 Pi |
| todo | 步骤清单 | 计划自建 | 自建 |
| ask | 结构化追问 | 无 | 自建 |
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
| retain / recall / learn | 跨会话记忆 | 仅权限记忆 | 自建（可选） |
| learn → skill | 教训沉淀为 skill | Skills UI 已有 | 移植思路 |
| 继承 Cursor/Claude/Codex rules | 读盘上已有规则 | 主要跟 Pi skills | 自建（中） |
| `/` `$` `@` Composer | 已承诺能力 | 实现不完整 | 接线 Pi（P0） |

### I. 外部世界

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| web_search | 多后端搜索 | 无 | 自建（先单 provider） |
| github / github-as-fs | PR/issue 当路径 | shell + gh | 移植思路 |
| browser（Puppeteer/CDP） | Agent 开车页 | 仅 preview iframe | 自建（高风险） |
| computer（OS 操控） | 截屏/键鼠/AX | 无 | 跳过 |
| generate_image / tts | 多媒体 | 非核心 | 低优先 |
| 图片理解 / 粘贴截图 | UI bug 复现 | roadmap 部分 | 接线 Pi / 小自建 |
| MCP 内置 | 接 MCP servers | 计划自建桥 | 自建（原 roadmap） |

### J. 模型路由

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| **Auto 模型请求（产品化）** | 用户选 Auto：代选 + 角色路由 + 失败换模 | 仅有 `pickDefaultModel`；无 Auto UI / 无角色链 | **#21 紧急项**；接线 Pi `scopedModels` + 产品路由层 |
| 多 role 模型 | plan/fast/smol… | scopedModels Not wired | 接线 Pi（含在 #21） |
| fallback chains | 429 换模型 | retry Not wired | 接线 Pi（含在 #21；UI 与 #8 联动） |
| path-scoped models | 目录绑模型 | 无 | 移植思路（低） |
| round-robin keys | 多 key 轮转 | 无 | 低优先 |
| 本地 llama / Ollama | 本地推理 | M12；Pi 有 llama ext | 接线 Pi |

### K. Git

| OMP 能力 | 一句话 | PiX 现状 | 建议路径 |
|----------|--------|----------|----------|
| 原子拆 commit | 按依赖拆提交 | Diff UI 有 | 移植思路（高，需审批） |
| git_overview / hunk 工具 | 结构化看 git | bash + Pierre | 自建 |
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
| 破坏性操作审批 | 权限提示 | Ask/Auto/Read-only + Automations | **保持自有模型** |
| security_scan | 云/本地安审 | 无 | 低优先（可用 skill） |

---

## 与「换内核」的关系（归档）

全量 `@earendil-works` → `@oh-my-pi` **不划算**：Electron×Bun、natives 打包、默认工具面爆炸。默认策略是留在官方 Pi，按本清单勾选借鉴。

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-07 | 初版：完整对照 + 20 条紧急可选池 |
| 2026-08-07 | 新增 #21 Auto 模型请求；池扩为 21 条 |
