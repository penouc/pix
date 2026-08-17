# DeepSeek Harness 借鉴能力 — 进度 Todo

> **能力说明（为什么做、路径、粗估）：** [`dsh-capability-borrow.md`](./dsh-capability-borrow.md)  
> **总工程账本：** [`TODOS.md`](./TODOS.md)  
> **OMP 功能雷达（勿混）：** [`omp-capability-todo.md`](./omp-capability-todo.md)  
> **本文件职责：** 跟踪紧急可选池的完成状态与测试状态；会话结束时更新勾选。  
> **策略：** 不换 Pi 内核、不引入 Cordis、不 vendor `@deepseek-ai/dsh-*`；接线官方 Pi / 自建 / 移植思路。  
> **范围：** 紧急池 8 条；按批次推进，不必一次做完。#3 需独立 ADR。  
> **Last updated:** 2026-08-17

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
| 完成 `[x]` | 0 |
| 推迟 `[-]` | 0 |

**进度：** 0 / 8

**已完成项测试：** （无）

---

## Batch A — 输出与循环卫生（日用止血）

> 优先：长工具结果不被截死、卡死循环能被打断。#3 sandbox 不进本批。

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 1 | [ ] | — | Tool-output spill | 自建 | 超长 bash/grep/test 结果写入会话范围 spill 文件；模型只看到有界 preview + locator；Agent 可用只读工具按 locator 再取；权限 `safe`；截断不再是唯一策略 | 对照 dsh `spill/`。落点：`event-mapper` / bash 结果规范化，替代 `MAX_TOOL_PROGRESS_CHUNK` 丢弃语义 |
| 2 | [ ] | — | 循环卫生：重复调用提醒 + 单工具 timeout | 自建 | 同一工具+相似参数连续 N 次后，下一轮注入可见提醒（桌面事件可重建）；单次 bash/MCP 等到点 abort，不靠整 run 10 分钟墙钟；提醒与 timeout 都走现有 tool hook，不改 Pi loop | 对照 dsh `guard/`。N 与 timeout 必须是可配置项，不是插件里的魔法常量 |
| 5 | [ ] | — | 无模型的 tool-result 修剪 | 接线 Pi / 自建 | 自动 compact 前可丢掉过老 tool payload、只留 locator/摘要；不调模型也能降 token；手动 Compact 仍可用；Checkpoint 语义不变 | 对照 dsh `compaction-tool-result-pruner`。依赖 #1 的 locator，否则修剪等于永久丢失 |

---

## Batch B — 过程透明与终端上下文

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 4 | [ ] | — | Trajectory / 模型可见事件齐全 | 接线 Pi + 产品化 | compact 摘要、steer 注入、skill 加载都有对应 `DesktopAgentEvent`；Chat 可按来源筛选（user / tool / inject / compact）；Fork/Resume 后筛选仍成立 | 对照 dsh「Model-visible ⟺ logged」与 Trajectory 视图。不重做 JSONL 引擎 |
| 7 | [ ] | — | 用户终端 → 会话上下文 | 接线 Pi | 用户可把 PTY 选区或最近输出一键加入当前会话；Agent **不能**直接驾驭用户 PTY；仍审计 `terminal.pty`；Workspace Trust 未确认则不可注入 | 对照 ADR-0006：用户键入即同意，但不把交互壳交给模型。计划 §24.7 / OMP 表 D 同源缺口 |

---

## Batch C — 外部读取

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 6 | [ ] | — | web_fetch | 自建 | 至少一个 HTTP(S) fetch 工具；默认 `external-side-effect`；首次需审批；Plan Mode 阻断；SSRF 黑名单（localhost / 链路本地 / 元数据地址）；输出走 #1 spill 上限 | 对照 dsh `web-fetch-http`。不把 bash curl 当产品能力。与已有 `web_search` 并列，不替换 |

---

## Batch D — 执行边界（需 ADR）

| # | 状态 | 测试 | 能力 | 路径 | 完成标准（验收） | 备注 |
|---|------|------|------|------|------------------|------|
| 3 | [ ] | — | OS sandbox（bash 先） | 移植思路 | 先写 ADR：模式（read-only / workspace-write）、fail-closed（无后端不得裸跑）、与 Ask/Auto/Plan 的映射、Windows 部分强制如何对用户说实话。bash 经 `confine(argv, policy)`；Plan = read-only confine；macOS Seatbelt 与 Windows ACL 至少一端可测；没有 runner 时拒绝 confined 调用并审计 | 对照 dsh `sandbox/`。**禁止**夹在 spill PR。PTY 用户壳不在本项（ADR-0006 已记录无 jail） |
| 8 | [ ] | — | 通用 LSP stdio | 自建 | 项目级配置（如 `.pi-desktop/lsp.json`）可声明 stdio 语言服务器；默认关闭；显式启用后 `lsp_*` 可走该 server；工具仍经权限管线；未知/崩溃 fail-closed；进程纳入现有进程树清理 | 对照 dsh LSP seam。不撤掉现有 TS 进程内实现；stdio 是增量。默认关闭避免供应链 |

---

## 推荐推进顺序（可改）

未另行指定时，按此顺序开干（Batch A 内可并行 #1 与 #2；#5 等 #1 locator）：

1. **#1** Tool-output spill
2. **#2** 重复调用提醒 + 单工具 timeout
3. **#5** 无模型 tool-result 修剪（依赖 #1）
4. **#4** Trajectory / 模型可见事件
5. **#7** 用户终端 → 会话上下文
6. **#6** web_fetch（输出上限复用 #1）
7. **#3** OS sandbox（独立 ADR + PR）
8. **#8** 通用 LSP stdio（默认关闭）

---

## 会话更新日志

| 日期 | 变更 |
|------|------|
| 2026-08-17 | 建档；紧急池 8 条全部纳入，状态均为未开始 |
