# PiX — First-run & Onboarding

> **Status:** proposal / not implemented  
> **Last updated:** 2026-08-07  
> **Context:** 作者本人日常使用无感；新装用户无欢迎流、无 checklist，容易卡在「没项目 / 没模型」到不了第一次成功跑完一句 prompt。  
> **进度账本：** 落地时在 [`TODOS.md`](./TODOS.md) 开项；本文件是产品与实现约定。

---

## 目标

**Aha moment（唯一北极星）：**

> 打开一个文件夹 → 配好一个模型 → 发出第一条消息并看到回复

在此之前，不介绍 Plan / MCP / memory / hashline / web_search 等进阶能力。

**原则：**

- 不做多步 wizard、不做强制 spotlight tour（开发者产品，仪式感越重跳过率越高）
- **Show in the real UI**，不用单独 tutorial 模式
- 可跳过、可关掉；完成后不再出现
- 空状态 = onboarding；功能发现延后到用到时

---

## 现状（2026-08-07）

| 项 | 现状 |
|----|------|
| 首启落点 | 直接进 Run 工作台；`blankRun: true`；无 welcome |
| 无项目 | 侧栏 “No projects yet”；聊天 “Choose a project to start”；发送禁用 |
| 开项目 | ⌘O / 侧栏文件夹 / “Open another folder…” → OS picker |
| 无项目点 New task | 进 `userData/playground`（易误当成正式项目） |
| 模型 | 无 `hasAuth` 时 Model picker 空；需自己找 Settings → Providers |
| Trust | Settings 文案提 “Workspace Trust step”，实际首次发消息静默 trust；无独立对话框 |
| `reopenLastProject` | UiFlag 存在，**未接线** |
| 首启 / onboarding flag | **无** |
| Skills / Automations | 有 recipe 空状态（方向对） |
| MCP / memory / git 工具等 | 无 UI 发现路径（MCP 仅 `.pi-desktop/mcp.json`） |

---

## 推荐形态：三层

### 层 1 — 冷启动 checklist（必做）

空白 Run / 尚未完成首启时，用 **可打勾 checklist** 替代含糊的 “Choose a project”：

| # | 步骤 | CTA | 完成条件 |
|---|------|-----|----------|
| 1 | **Open a folder** | 主按钮打开目录；playground 仅次要链接 | `activeProjectId` 存在且非「用户不知情的 scratch」体验（playground 需标明） |
| 2 | **Add a model** | 无可用 auth 时一键打开 Settings → Providers | `hasAuth === true`（任一 provider） |
| 3 | **Send something** | 有项目 + 有模型后，预填可改 starter（如 “Summarize this repo”） | 至少一次 `run` 成功开始或完成 |

**持久化（建议）：**

- `onboarding.completed` — 三步都完成后为 true，之后不再挡主路径  
- 或拆：`hasOpenedProject` / `hasConfiguredAuth` / `hasFirstRun`（便于局部空状态复用）  
- 存用户级 settings（与现有 `provider-settings` / UiFlags 同层），尊重 dismiss / Skip

**Skip：** “I’ll explore on my own” → 写 `onboarding.completed`（或 `onboarding.skipped`），不再展示 checklist；空状态仍可保留轻量 CTA。

### 层 2 — 空状态当 onboarding（补齐现有）

| 表面 | 做什么 |
|------|--------|
| 无模型 | Composer / Model picker **强提示** “Add a provider key”，点击直达 Providers（不要只靠 Settings 菜单） |
| 有项目无会话 | 一行 starter + `@` / `$` / `/` hint（聊天空状态已有雏形，对齐文案） |
| Skills / Automations | 保持 recipe；确保无项目时说明「先开文件夹」 |
| Playground | 明确标注 “Scratch playground”，并提供 “Open a real folder…” |

### 层 3 — 功能发现（延后，先不做 tour）

| 能力 | 建议时机 |
|------|----------|
| Plan Mode | 首次打开 SessionModePicker 或 `/plan` 时一次 tip |
| Approval Auto vs Model Auto | 文案区分（见 [`omp-capability-borrow.md`](./omp-capability-borrow.md) 命名注意） |
| Skills `$` / 命令 `/` | 第一条消息前后一行 hint 即可 |
| MCP / memory / web_search / git 工具 | Settings「Capabilities / What’s new」短列表，或首次相关工具进入审批队列时说明；**不进冷启动** |

---

## 顺手修的误导点（与 checklist 同批更好）

| 问题 | 建议 |
|------|------|
| Settings 承诺 Trust step，代码静默 trust | 文案对齐，**或** 首次开项目出一次信任确认 |
| `reopenLastProject` 未接线 | 接上：二次启动恢复上次项目（比 tip 更有用） |
| New task → playground | checklist / 空状态标明 scratch，避免当成默认工作区 |

---

## 明确不做（本轮）

- 强制多步 wizard / 全屏产品导览  
- 把 MCP、hashline、LSP、memory 塞进首启  
- 单独 tutorial 模式或假数据沙箱（除非以后要做 demo reel）  
- 每次升级强弹全部新功能（可用可关的 What’s new）

---

## 实现 checklist（落地时勾选）

### P0 — 到第一次回复

- [ ] 用户级 onboarding 状态读写（completed / skipped / 分步）
- [ ] 空白 Run：三步 checklist UI + Skip
- [ ] 步骤 1：Open folder（主）/ playground（次，带说明）
- [ ] 步骤 2：无 auth → 直达 Providers；有 auth 自动勾上
- [ ] 步骤 3：starter prompt；首跑后勾上并 `completed`
- [ ] 无模型时 Composer / Model picker 强 CTA

### P1 — 少踩坑

- [ ] 接线 `reopenLastProject`（设置项 + 启动恢复）
- [ ] Trust 文案与行为对齐（静默 or 真对话框，二选一）
- [ ] Playground 标注 +「打开真实文件夹」出口

### P2 — 发现层

- [ ] Settings「Capabilities」或「What’s new」短列表（链到文档/能力说明）
- [ ] Plan / Auto 命名首次 tip（可关）
- [ ] （可选）相关工具首次审批时的一句说明

### 验收（手测）

- [ ] **干净用户数据**（清 `Application Support/@pi-desktop/desktop` 或等价路径）新装一遍
- [ ] 计时：到「第一条模型回复」的步数与卡点
- [ ] Skip 后不再出现 checklist；完成后重启不再出现
- [ ] 已有用户（已有项目 + auth）升级后不被 checklist 打断

---

## 文案草稿（可改）

**Checklist 标题：** Get started  
**步骤：**

1. Open a project folder  
2. Add a model (API key or sign-in)  
3. Send your first message  

**Skip：** Skip for now  
**Starter：** Summarize what this repo does and list the top risks before changing code.  
**无模型：** Add a provider under Settings to run the agent. 〔Open Providers〕

---

## 相关代码（现状锚点）

| 区域 | 路径 |
|------|------|
| 首屏 / Run | `apps/desktop/src/renderer/app/App.tsx` |
| 侧栏空状态 | `apps/desktop/src/renderer/features/projects/ProjectSidebar.tsx` |
| 聊天空状态 | `apps/desktop/src/renderer/features/chat/ChatPanel.tsx` |
| 建任务 / trust | `apps/desktop/src/renderer/features/sessions/use-create-task.ts` |
| UiFlags | `apps/desktop/src/main/providers/provider-settings-store.ts` |
| Providers / Settings | `apps/desktop/src/renderer/features/settings/` |
| Model picker | `apps/desktop/src/renderer/features/models/ModelPicker.tsx` |

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-07 | 初版：三层策略、冷启动 checklist、P0–P2 实现项与验收；记录当前缺口 |
