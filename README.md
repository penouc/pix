# Pi Agent Desktop

本地桌面 Coding Agent：以 Pi Agent SDK 为 Runtime，在本地 Git 项目中完成「理解任务 → 改代码 → 验证 → Diff 审查 → 接受/撤销」。

> 产品与工程总纲见 [`Pi_Agent_Desktop_开发总计划.md`](./Pi_Agent_Desktop_开发总计划.md)。  
> **执行 todos 与进度台账（以验收门槛为准）：** [`docs/TODOS.md`](./docs/TODOS.md)

## 当前进度

以 [`docs/TODOS.md`](./docs/TODOS.md) 为准。摘要：

- **M0**：未完全关闭（缺完整评测集与文档集）
- **M1（当前焦点）**：Electron 壳 + Zod IPC + Fake 演示已有；**真实 Pi SDK / packaged 验证未做**，阶段未通过

## 仓库结构

```text
apps/desktop/          Electron Main / Preload / React Renderer
packages/protocol/     Typed IPC + Zod schemas + DesktopAgentEvent
packages/agent-domain/ AgentRuntime 边界、状态机、领域错误
packages/agent-pi/     Pi 适配层（当前为 FakeAgentRuntime）
docs/                  架构与契约文档
fixtures/              固定评测用测试仓库
```

## 开发

```bash
pnpm install
pnpm --filter @pi-desktop/protocol build
pnpm --filter @pi-desktop/agent-domain build
pnpm --filter @pi-desktop/agent-pi build
pnpm dev
```

应用启动后：

1. 在左侧输入一个本地目录路径并 **Open project**
2. **New session**
3. 发送消息，观察中间栏流式输出与 Tool 卡片（Fake runtime）
4. 可用 **Stop** 取消进行中的 run

## 脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Electron + Vite 开发模式 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm test` | Vitest |
| `pnpm lint` | ESLint |
| `pnpm build` | 构建 packages + desktop |

## 架构约束（摘要）

- Renderer **无** Node Integration；只经 Preload 白名单 API 通信
- 所有 IPC 输入/输出/事件经 Zod 校验（`@pi-desktop/protocol`）
- Pi SDK 只允许出现在 `packages/agent-pi`；UI 不导入 Pi 类型
- 权限判定在 Main Process；Checkpoint 快照才是可靠恢复来源
