# PiX — First-run & Onboarding

> **Status:** implemented (P0 + P1)  
> **Last updated:** 2026-08-12  
> **Context:** 作者本人日常使用无感；新装用户无欢迎流、无 checklist，容易卡在「没项目 / 没模型」到不了第一次成功跑完一句 prompt。  
> **进度账本：** [`TODOS.md`](./TODOS.md)；本文件是产品与实现约定。

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

## 现状（2026-08-12）

| 项 | 现状 |
|----|------|
| 首启落点 | 空白 Run + **Get started** 三步 checklist（可 Skip） |
| 无项目 | checklist 步骤 1：Open folder（主）/ scratch playground（次） |
| 开项目 | ⌘O / 侧栏文件夹 / checklist CTA → OS picker |
| Playground | 标注 “Scratch playground”，提供 “Open a real folder…” |
| 模型 | 无 `hasAuth` 时 Model picker 强 CTA → Settings → Providers |
| Trust | Settings 文案与行为对齐：off 时首次发消息信任项目（无独立对话框） |
| `reopenLastProject` | 已接线；设置项可关；升级老用户默认打开以保持旧行为 |
| 首启 / onboarding flag | 用户级 `app-preferences.json` → `onboarding` |

---

## 推荐形态：三层

### 层 1 — 冷启动 checklist（已做）

空白 Run / 尚未完成首启时，用 **可打勾 checklist** 替代含糊的 “Choose a project”：

| # | 步骤 | CTA | 完成条件 |
|---|------|-----|----------|
| 1 | **Open a folder** | 主按钮打开目录；playground 仅次要链接 | 非 playground 的 `activeProject` / `hasOpenedProject` |
| 2 | **Add a model** | 无可用 auth 时一键打开 Settings → Providers | `hasAuth` / `hasConfiguredAuth` |
| 3 | **Send something** | 有项目 + 有模型后预填可改 starter | 至少一次 `run` 成功开始（`hasFirstRun`） |

**持久化：**

- `onboarding.completed` / `onboarding.skipped`
- `hasOpenedProject` / `hasConfiguredAuth` / `hasFirstRun`
- 与 `provider-settings` / UiFlags 同层（`app-preferences.json`），不进 project SQLite

**Skip：** “Skip for now — I’ll explore on my own” → `skipped` + `completed`，不再展示 checklist。

**升级迁移：** 已有真实项目 / auth / session 的安装在首次读取时标记 `completed`，并打开 `reopenLastProject`，避免打断老用户。

### 层 2 — 空状态当 onboarding（已做补齐）

| 表面 | 做什么 |
|------|--------|
| 无模型 | Composer / Model picker **强提示** “Add a provider…”，点击直达 Providers |
| Playground | “Scratch playground” + “Open a real folder…” |
| Skills / Automations | 保持 recipe（未改） |

### 层 3 — 功能发现（延后，先不做 tour）

| 能力 | 建议时机 |
|------|----------|
| Plan Mode | 首次打开 SessionModePicker 或 `/plan` 时一次 tip |
| Approval Auto vs Model Auto | 文案区分（见 [`omp-capability-borrow.md`](./omp-capability-borrow.md) 命名注意） |
| Skills `$` / 命令 `/` | 第一条消息前后一行 hint 即可 |
| MCP / memory / web_search / git 工具 | Settings「Capabilities / What’s new」短列表；**不进冷启动** |

---

## 明确不做（本轮）

- 强制多步 wizard / 全屏产品导览  
- 把 MCP、hashline、LSP、memory 塞进首启  
- 单独 tutorial 模式或假数据沙箱  
- 每次升级强弹全部新功能（What’s new）

---

## 实现 checklist

### P0 — 到第一次回复

- [x] 用户级 onboarding 状态读写（completed / skipped / 分步）
- [x] 空白 Run：三步 checklist UI + Skip
- [x] 步骤 1：Open folder（主）/ playground（次，带说明）
- [x] 步骤 2：无 auth → 直达 Providers；有 auth 自动勾上
- [x] 步骤 3：starter prompt；首跑后勾上并 `completed`
- [x] 无模型时 Composer / Model picker 强 CTA

### P1 — 少踩坑

- [x] 接线 `reopenLastProject`（设置项 + 启动恢复）
- [x] Trust 文案与行为对齐（选择：修文案，保留首次发送时信任）
- [x] Playground 标注 +「打开真实文件夹」出口

### P2 — 发现层

- [ ] Settings「Capabilities」或「What’s new」短列表（链到文档/能力说明）
- [ ] Plan / Auto 命名首次 tip（可关）
- [ ] （可选）相关工具首次审批时的一句说明

### 验收（手测）

- [ ] **干净用户数据**（清 `Application Support/@pi-desktop/desktop` 或等价路径）新装一遍
- [ ] 计时：到「第一条模型回复」的步数与卡点
- [ ] Skip 后不再出现 checklist；完成后重启不再出现
- [ ] 已有用户（已有项目 + auth）升级后不被 checklist 打断
- [ ] Settings → Projects：toggle “Reopen last project on launch” 可观察（开=恢复，关=空白 Run）
- [ ] Playground 显示 Scratch 文案，并能 Open a real folder

---

## 文案

**Checklist 标题：** Get started  
**步骤：**

1. Open a project folder  
2. Add a model (API key or sign-in)  
3. Send your first message  

**Skip：** Skip for now — I’ll explore on my own  
**Starter：** Summarize what this repo does and list the top risks before changing code.  
**无模型：** Add a provider under Settings to run the agent. 〔Open Providers〕

---

## 相关代码

| 区域 | 路径 |
|------|------|
| 状态机（纯函数） | `apps/desktop/src/shared/onboarding-state.ts` |
| 持久化 | `apps/desktop/src/main/providers/provider-settings-store.ts` |
| IPC | `settings.getOnboarding` / `settings.patchOnboarding` |
| Checklist UI | `apps/desktop/src/renderer/features/onboarding/` |
| 空白 Run | `apps/desktop/src/renderer/features/chat/ChatPanel.tsx` |
| Model picker CTA | `apps/desktop/src/renderer/features/models/ModelPicker.tsx` |
| Providers 深链 | `App.tsx` → `SettingsView` `initialTab` |

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-07 | 初版：三层策略、冷启动 checklist、P0–P2 实现项与验收；记录当前缺口 |
| 2026-08-12 | 落地 P0+P1：用户级 onboarding、checklist、Providers CTA、reopenLastProject、Trust 文案、Playground 标注 |
