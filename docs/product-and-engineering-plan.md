# PiX — Product & Engineering Plan

> Formerly "Pi Agent Desktop." Local desktop Coding Agent — product and engineering master plan.
>
> PRODUCT & ENGINEERING PLAN · Version 1.2 · 2026-07-26
>
> v1.1 changes: added §21–§28 (v1 close-out checklist, Pi SDK capability inventory, M8.5–M13 enhancement roadmap and design, feature candidate list, protocol and data model evolution, enhancement-phase testing and risk, ADR queue). The scope and contracts in §1–§20 are unchanged.
>
> v1.2 changes (written back **after one round of v2 design landed**): added §29–§34 (implementation-era lessons and anti-pattern checklist, design-fidelity contract, honest-presentation contract, state-storage inventory, accessibility and localization baseline, build-environment invariants); supplemented §9.3 approval modes and §9.4 unattended execution (and clarified its relationship to §4.1 A5); supplemented §14.1.1 with the concrete values now in effect. The first twenty sections were written before work began; this batch is **things we only learned after building it**.

> **Core goal:** Using the Pi Agent SDK as the Agent Runtime, build a desktop application that, within a local project, "understands the task, modifies code, runs verification, reviews the diff, and accepts or reverts the changes."


| **Project attribute** | **Current decision** |
|--------------|-----------------------------------------------------------|
| Target user | Individual developers and the project's own author, first |
| Launch platform | macOS first; architecture does not lock out other desktop platforms |
| Desktop technology | Electron + React + TypeScript |
| Agent core | Pi Agent SDK, integrated via the AgentRuntime adapter layer |
| Core UI | shadcn/ui + Tailwind CSS |
| Async state | @tanstack/react-query; streaming run state uses an event bus and Zustand |
| Diff | @pierre/diffs, preferring the stable version and CodeView capability |
| Planning method | Driven by milestones and acceptance gates, not tied to fixed dates |

# 0. Document Purpose and Usage

This document is the project's master outline, not a one-off product concept. It simultaneously serves as the product scope, architectural constraints, engineering contracts, security baseline, action checklist, and acceptance criteria. When major decisions arise during development, this file should be updated or split into the repo's `docs/` folder, with the rationale preserved in a decision record.

> **Progression principle:** Each phase only proceeds to the next after its corresponding acceptance criteria pass; nothing that does not affect the first complete user journey may block the MVP.


## 0.1 Document Navigation

| **Section** | **Question it answers** |
|----------|-------------------------------------------------|
| 1-3      | What the product is, who it solves problems for, and what the first version does |
| 4-6      | How the system is layered, which technologies are used, how the repo is organized |
| 7-11     | How Runtime, events, the state machine, permissions, data, and recovery are defined |
| 12-15    | Each milestone's action items, tests, observability, and release gates |
| 16-18    | Risks, decision records, and the first backlog for kicking off development |
| 19-20    | The MVP's final acceptance script and technical rationale |
| 21-22    | What's still missing from the first version; which Pi SDK capabilities the product hasn't used yet |
| 23-25    | What to do after the MVP: enhancement roadmap, design, feature priority |
| 26-28    | Protocol/data evolution in the enhancement phase, testing and risk, ADR queue |
| 29-31    | Written back after implementation: anti-pattern checklist, design-fidelity, honest-presentation contract |
| 32-34    | Full state-storage table, accessibility and localization, build-environment invariants |

# 1. Product Vision and Definition of Success

Product vision: let developers hand real coding tasks over to Pi Agents driven by different Providers and Models, inside a trustworthy, reviewable, recoverable local desktop workbench.

## 1.1 Core Value
- Local execution: project files, Git, and Shell run on the user's own machine by default.
- Model freedom: use Pi's existing multi-Provider, multi-Model capabilities instead of building a duplicate model adapter layer.
- Process transparency: the user can see what the Agent is reading, executing, and modifying.
- Safe and controllable: sensitive or high-risk operations go through a unified permission policy and explicit authorization.
- Reviewable results: all code changes are reviewed together through a high-performance Diff interface.
- Recoverable work: crashes, cancellations, or rejected changes never destroy work the user had before the task.

## 1.2 First-Version Success Criteria
- [ ] The user can open a local Git project and establish a trusted Workspace.
- [ ] The user can select a configured Provider and Model.
- [ ] The Agent can read, search, modify code, and run verification commands.
- [ ] The user can understand the Agent's running state and tool calls in real time.
- [ ] Dangerous operations are intercepted and require authorization.
- [ ] The user can review a multi-file Diff, then request further changes or keep the result.
- [ ] The user can revert the changes the Agent produced in this round without damaging any work that existed before the task.
- [ ] After closing the app, the project, session, and run history can be restored.

## 1.3 Non-Goals
- The first version is not a full IDE; it does not offer VS Code–level code editing.
- The first version does not pursue multi-Agent orchestration, team collaboration, cloud sync, or a plugin marketplace.
- The first version does not require a local model as a launch prerequisite; the local Agent and a local Model are two independent capabilities.
- The first version does not promise unconfirmed execution of arbitrary system commands, nor does it market itself as "fully automatic."

# 2. MVP Primary User Journey

1.  Launch the app, select or restore a local Git project.

2.  Confirm the project's trust status, create a new Agent Session.

3.  Choose a Provider, Model, and Thinking Level.

4.  Enter a real coding task, optionally referencing project files.

5.  The Agent analyzes the project and streams messages, tool calls, and run state.

6.  Reads and writes inside the normal Workspace proceed per policy; sensitive operations trigger approval.

7.  The Agent finishes the code changes and runs lint, test, or build.

8.  The desktop app displays a multi-file Diff, test results, and a task summary.

9.  The user chooses to keep iterating, keep the changes, or revert this round's Agent changes.

10. The app persists Session, Run, Approval, FileChange, and Checkpoint information.

> **MVP freeze rule:** Plan Mode, Session Fork, multi-Agent, remote Workspace, local 4090 inference, MCP, auto-update, and multi-window all move to the subsequent roadmap and do not block the primary journey above.


# 3. Product Feature Scope

| **Module** | **MVP**                                | **Later enhancement**                  |
|----------|----------------------------------------|-------------------------------|
| Project  | Select directory, recent projects, Git detection, project trust | Project grouping, remote Workspace |
| Session  | Create, resume, rename, archive         | Fork, tree navigation, sharing |
| Agent    | Streaming execution, Stop, Follow-up    | Plan Mode, multi-Agent, background parallelism |
| Provider | At least one Provider with full login and model switching | Local model, Provider health checks |
| Tool     | read/write/edit/bash with approval      | Browser, MCP, SSH |
| Diff     | Multi-file review, Keep/Revert          | Line-level instructions, comments, merge conflict handling |
| Recovery | Pre-task snapshot, file-level/whole-run recovery | Cross-device recovery, historical version browsing |
| Release  | macOS local installer                   | Signing, Notarization, auto-update |

# 4. Technical Architecture

```text
React Renderer
├─ Chat / Tool Calls / Approval / Diff / Settings
├─ TanStack Query (query and persistent async state)
└─ Zustand + Event Bus (streaming and transient UI state)
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

## 4.1 Architectural Principles
- The Renderer has Node Integration disabled, and never directly accesses the filesystem, Shell, secrets, or the database.
- All cross-process input, output, and events pass through Zod runtime validation.
- The Pi SDK only appears in the agent-pi adapter layer; business logic and the UI never import Pi's internal types.
- Every Agent Event carries `projectId`, `sessionId`, `runId`, `sequence`, and `timestamp`.
- Permission decisions are made entirely in the Main Process; the Renderer is only responsible for presenting approvals and submitting the user's choice.
- Git Diff is a presentation source; the Checkpoint snapshot is the reliable recovery source.
- Provider and Model are handed off to Pi; the desktop app is responsible for the login experience, secret protection, and status display.

# 5. Technology Choices and Constraints

| **Domain**        | **Choice**                      | **Constraint or rationale**                                             |
|-----------------|-------------------------------|--------------------------------------------------------------------|
| Desktop         | Electron                      | Pi is a TypeScript/Node ecosystem; avoids sidecar and RPC complexity in the first version |
| UI              | React + TypeScript            | Consistent with existing experience, enables fast construction of a complex workbench |
| Server State    | @tanstack/react-query         | Manages async queries for projects, sessions, diffs, providers, etc. |
| Streaming State | Event Bus + Zustand           | Avoids updating the Query Cache on every token |
| Components      | shadcn/ui + Tailwind          | Component source is controllable, suited to product customization |
| Diff            | @pierre/diffs                 | Oriented toward Code Review, supports Shiki and high-performance virtualization |
| Validation      | Zod                           | Unified validation across IPC, database boundaries, and persisted data |
| Database        | SQLite                        | Used only in the Main Process; a Repository isolates the concrete driver |
| Credentials     | Keychain / safeStorage        | Plaintext secrets never enter the Renderer, logs, or the project directory |
| Testing         | Vitest + Playwright           | Unit, contract, integration, and end-to-end coverage |
| Packaging       | Electron Builder or Forge (pick one) | Complete a packaged build during the technical-validation phase, not deferred to just before release |

> **Version policy:** Electron, the Pi SDK, @pierre/diffs, and the SQLite driver must be pinned to specific versions; the MVP phase does not use auto-follow-latest range specifiers. Dependency upgrades must run the fixed evaluation suite.


# 6. Recommended Repository Structure

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

## 6.1 Repository Documentation

| **File**                  | **Content**                                           |
|---------------------------|----------------------------------------------------|
| product-scope.md          | MVP scope, non-goals, core user journeys                     |
| architecture.md           | Process boundaries, module responsibilities, dependency direction |
| agent-runtime-contract.md | Runtime interface, event protocol, error types |
| ipc-protocol.md           | Commands, Queries, Events, and Zod Schemas |
| security-model.md         | Threats, permission levels, approval and audit policy |
| data-model.md             | Entities, ownership, migrations, and lifecycle |
| checkpoint-semantics.md   | Precise definitions of snapshots, conflicts, and Keep/Revert |
| acceptance-tests.md       | Fixed test repositories, task sets, and pass criteria |
| decisions/                | Key ADRs: why Electron, Pi, Pierre Diffs, etc. were chosen |

# 7. The AgentRuntime Contract

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

## 7.1 Adapter Layer Responsibilities
- Create, resume, and dispose of Pi Sessions.
- Convert Pi messages, Tool Calls, Tool Results, and Usage into DesktopAgentEvents.
- Convert Pi Provider/Model data into a stable desktop domain model.
- Normalize Abort, timeouts, Provider errors, and tool errors.
- Isolate changes in the Pi SDK version so that the Renderer and database schema never need to change.
- Provide a FakeAgentRuntime so UI and E2E tests don't depend on real model costs.

## 7.2 Pi Technical Validation Checklist
- [ ] The Pi SDK can load and run inside Electron Main dev mode.
- [ ] The Pi SDK can load and run inside a packaged Electron app.
- [ ] No packaging conflicts from ESM/CJS, dynamic dependencies, or resource discovery.
- [ ] The Session storage path can be controlled, and resume behavior is stable.
- [ ] Tool Events provide the input needed for permission decisions.
- [ ] Abort terminates a running Bash command and its child-process tree.
- [ ] Closing the app leaves no Agent or Shell processes behind.
- [ ] At least one Provider's login, model listing, and real call round-trip pass.
- [ ] The Pi SDK version is pinned, and the upgrade regression steps are documented.

# 8. Event Protocol and State Machine

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

| **Event family** | **Example**                              | **UI behavior**                    |
|------------|---------------------------------------|--------------------------------|
| Lifecycle   | run.started / completed / failed      | Update the state machine and run summary |
| Message       | message.delta / completed             | Batch-refresh streaming text; persist once complete |
| Tool       | tool.requested / progress / completed | Show tool cards and collapsible output |
| Approval       | approval.requested / resolved         | Pause the run and show the permission dialog |
| Files       | files.changed                         | Refresh the change list and the Diff query |
| Usage       | usage.updated                         | Show tokens, cost, and context usage |

> **Out-of-order protection:** The Renderer only accepts events for the current `projectId`/`sessionId`/`runId`; late or duplicate events whose `sequence` is less than or equal to the last processed sequence number must be discarded.


# 9. Permissions and Security Model

Pi provides tools and extensibility, but the desktop product must treat permission control as one of its own core capabilities. The Workspace boundary can only constrain file paths — it cannot automatically constrain the system side effects produced by project scripts, test commands, or dependency installation.

## 9.1 Risk Levels

| **Level**             | **Typical operation**                                 | **Default policy**             |
|----------------------|----------------------------------------------|--------------------------|
| safe                 | Reads within Workspace, git status, explicit read-only checks | Auto-allow and audit           |
| workspace-write      | Modifying ordinary source code, creating test files                   | Allowed per project mode, snapshot retained |
| sensitive            | Reading .env, installing dependencies, network requests                | Confirm every time, or denied by default       |
| destructive          | Deletion, overwriting many files, rewriting Git history            | Always confirm, memorized authorization limited |
| external-side-effect | git push, publish, deploy, external write operations             | Always confirm, no fuzzy authorization allowed |

## 9.2 Approval Protocol

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

## 9.3 Approval Modes (v1.2 addition, implemented)

§9.2 only defines "how a single request is asked" — it does not define "how far this Session as a whole is allowed to go."
`PolicyEngine` now has three modes, settable as a global default or overridden per Session:

| mode | Semantics | workspace-write | bash / sensitive+ |
|------|------|-----------------|-------------------|
| `ask` | Every change waits for a human decision | Requires approval | Requires approval |
| `auto-reads` | Free reads, free writes within the workspace (the historical default) | Auto-allowed | Requires approval |
| `read-only` | Nothing gets written, nothing gets run | **Denied** | **Denied** |

Two implementation constraints that must be preserved:

1. **`read-only` means "deny," not "queue for approval."** If it were just a popup, it would be equivalent to `ask`,
   and the mode would lose its purpose — one click on Allow and it can write anyway.
2. **The `read-only` check must run before the memorized-rule lookup.** Otherwise an `allow-project` grant made earlier under
   a looser mode would bypass read-only. This is already covered by a regression test.

The mode also applies to the **Terminal panel**: read-only must be truly global read-only, otherwise the user could bypass it from the terminal.

## 9.4 Unattended Execution (v1.2 addition, relationship to §4.1 A5)

§4.1 A5's original text is "Permission decisions are made entirely in the Main Process; the Renderer is only responsible for presenting approvals and submitting the user's choice,"
with the implicit assumption that **a human decides every elevated operation**. The Automations feature's `unattended` mode breaks
this assumption: when a scheduled trigger fires, there is no one at the keyboard.

**This deviation is an explicit decision, recorded in `docs/decisions/0003-unattended-automations.md`.**
A5 should now read: permission decisions are always made in Main; the decision-maker can be a human, or an automation rule the user has
explicitly configured as `unattended`.

Bottom lines that `unattended` does not relax (encoded in code, and asserted by fixtures):

- The policy engine's `deny` decisions (protected paths, escaping the workspace, `git push`, and other external-side-effect operations)
  **never become approval requests in the first place**, so automatic approval can never see or allow them.
- Workspace Trust is not bypassed.
- Every automatic decision is written to the audit log, including the automationId and mode.
- The scheduler does not catch up on missed time slots on startup (a crash loop will not repeatedly trigger writes).
- Checkpoint semantics are unchanged: changes produced unattended can be precisely reverted.

## 9.5 Threats That Must Be Covered
- Prompt injection from malicious repositories, AGENTS.md, or source files.
- Workspace boundary escapes via symlinks, relative paths, or case differences.
- npm/pnpm install scripts, test scripts, and build scripts accessing the system or network.
- Reading SSH, cloud platform, Git, browser, and local-model credentials.
- The Agent starting background processes, listening on ports, or leaving orphan processes.
- High-risk IPC calls invoked after Renderer XSS.
- Shell output, stack traces, and logs leaking tokens or sensitive paths.
- Executing git push, publish, deploy, or external service writes without confirmation.

**Security baseline checklist**
- [ ] contextIsolation on, nodeIntegration off.
- [ ] Preload exposes only a whitelisted API, no generic invoke.
- [ ] All IPC input, output, and events are validated through Zod.
- [ ] The real (canonicalized) path is resolved before checking the Workspace boundary.
- [ ] Sensitive directories and files have independent protected-path rules.
- [ ] Approvals, denials, and actual execution results are all written to the Audit Log.
- [ ] Log redaction covers API keys, Authorization headers, cookies, and common credential formats.

# 10. Data Model and Ownership

| **Data**                      | **Owner** | **Notes**                               |
|-------------------------------|------------|----------------------------------------|
| Pi Session/Message/Compaction | Pi         | Keep Pi's native semantics; don't duplicate the model's context implementation |
| Project                       | Desktop    | Path, trust status, default model, and permissions |
| Session Metadata              | Desktop    | Project association, name, archive status, and UI info |
| AgentRun                      | Desktop    | One task run: status, duration, model, and result |
| Approval                      | Desktop    | Request, risk, user decision, and audit |
| FileChange                    | Desktop    | Path, before/after hash, runId, and status |
| Checkpoint                    | Desktop    | Content references and lifecycle needed for recovery |
| ProviderProfile               | Desktop/Pi | Desktop stores display config; credentials go to secure storage |
| UI Settings                   | Desktop    | Layout, theme, recent projects, etc. |

## 10.1 SQLite Constraints
- The database is only accessible from the Electron Main Process.
- The business layer depends on a Repository interface, never directly on the SQLite driver.
- Migration scripts must be versioned, repeatable, and have a backup strategy.
- If using a native SQLite driver, technical validation must include a macOS ARM64 packaged build.
- An Agent Run is persisted as `running` when it starts, and transitions to `interrupted` on crash recovery.
- The cascade semantics for deleting a project, session, and checkpoint must be explicit.

# 11. Diff, Checkpoint, and Recovery Semantics

> **Key definition:** The Agent modifies the working directory directly, so in the Diff page, "Keep changes" means keeping the current modifications, and "Revert" means reverting this round's Agent changes — this is not equivalent to Accept/Reject on GitHub.


## 11.1 Pre-Change Baseline
- Before each Run begins, record the Git status, file content hashes, and any modifications that already existed before the task.
- Before the Agent's first write to a given file, save a content snapshot; for new files, save a "does not exist" state.
- Git Diff is used for display; the snapshot and hash are used for precise recovery.
- If the user manually modifies the same file while the Agent is running, flag a conflict and forbid silent overwriting.
- Non-Git projects can still use file snapshots, but this is not part of the first MVP acceptance path.

## 11.2 Semantics of User Actions

| **Action**                 | **Semantics**                          | **Protection condition**                   |
|--------------------------|------------------------------------|--------------------------------|
| Keep changes             | Keep the current working-tree state and end the review   | Save the run summary and change record         |
| Continue editing         | Send feedback to the same Session to keep iterating | Create a new Run and Checkpoint     |
| Revert file              | Revert only this Run's changes to the specified file     | If concurrent modification is detected, require conflict handling |
| Revert all agent changes | Revert all files this Run modified         | Never destroy uncommitted work that existed before the task |
| Review later             | Keep the working tree; mark the Session as pending review    | Re-validate hashes when reopened |

# 12. Milestones and Action Items

The following phases are not tied to fixed dates. Each phase is considered complete based on its deliverables and acceptance gates; exploration can happen in parallel, but dependency relationships and safety gates cannot be bypassed.

## M0: Scope Freeze and Project Baseline
- [x] Confirm macOS-first, single-Agent, Git-project-first.
- [x] Freeze the MVP primary journey and non-goals list.
- [x] Create the repo, pnpm workspace, coding standards, and CI baseline.
- [ ] Establish docs/, ADRs, fixtures/test-repositories. (Skeleton exists; the §6.1 doc set and fixtures are incomplete)
- [ ] Prepare a fixed set of real-task evaluations.

> **Completion gate:** The repo has a clear scope, a runnable empty-shell project, and repeatable acceptance inputs.
>
> **Progress ledger:** see [`docs/TODOS.md`](./TODOS.md). M0 is **not closed**.


## M1: Pi SDK + Electron Technical Validation
- [x] Initialize Electron, React, TypeScript, Vite.
- [ ] Create a Pi Session in the Main Process. (Adapter layer and smoke test pass; GUI + auth round-trip still to be confirmed)
- [ ] Wire up Renderer → Typed IPC → Pi → Event Stream. (Wired; a real stream depends on Provider login)
- [ ] Support sending messages, showing streaming text, Tool Events, and Stop.
- [ ] Complete dev and packaged build validation.
- [x] Complete one real code change and test run in the test repository. (Headless `pnpm eval:fixture` + OpenCode Go PASS)

> **Completion gate:** Complete one real coding task from the desktop window, without ever opening the Pi TUI.
>
> **Progress ledger:** see [`docs/TODOS.md`](./TODOS.md). Evidence of the SDK making a real code change is complete; a manual GUI test is still recommended, but is not blocking given the headless evidence.


## M2: Domain Contracts and State Machine
- [ ] Complete AgentRuntime, PiAgentRuntime, and FakeAgentRuntime.
- [x] Define AgentRunState, DesktopAgentEvent, and AgentError.
- [ ] Give every event proper scope and ordering fields; handle duplicate and late events. (Missing project/session/run filtering)
- [ ] Complete Runtime, IPC, and state-machine contract tests. (Only basic tests exist)

> **Completion gate:** The Renderer never imports Pi types; out-of-order, cancellation, and failure states can be reproduced deterministically.
>
> **Progress ledger:** see [`docs/TODOS.md`](./TODOS.md).


## M3: Project, Session, and Provider
- [ ] Implement project selection, recent projects, Git detection, and project trust.
- [ ] Implement Session creation, resume, rename, and archive.
- [ ] Read Pi Provider/Model, complete at least one real login round-trip.
- [ ] Keep secrets out of the Renderer, out of database plaintext, and out of logs.

> **Completion gate:** After restarting the app, the user can restore projects and Sessions and call a previously configured model again.


## M4: Agent Chat Workbench
- [ ] Complete Chat, Composer, streaming messages, and Tool Call cards.
- [ ] Support Stop, Retry, the Follow-up Queue, and error recovery.
- [ ] Wire in TanStack Query, Zustand, and event batching.
- [ ] Display model, context, tokens, cost, and run state.

> **Completion gate:** During a long task, the user can understand the Agent's current step, tool, output, and whether they need to intervene.


## M5: Permission and Security Baseline
- [ ] Build the Tool Normalizer, Risk Classifier, and Policy Engine.
- [ ] Implement the approval dialog with allow-once/session/project and deny.
- [ ] Complete protected paths, path canonicalization, and the audit log.
- [ ] Cover Shell, network, dependency install, git push, delete, and other external side effects.
- [ ] Build a security attack test repository.

> **Completion gate:** The Agent cannot access sensitive paths, push code, or perform high-risk side effects without authorization.


## M6: Diff Review
- [ ] Integrate a stable version of @pierre/diffs with CodeView.
- [ ] Support multi-file, unified/split views, collapsing unchanged lines, and file navigation.
- [ ] Display added, modified, deleted, renamed, and binary-file indicators.
- [ ] Complete a large-diff performance benchmark and theme sync.

> **Completion gate:** Large multi-file changes still open, scroll, switch, and navigate smoothly.


## M7: Checkpoint and Precise Recovery
- [ ] Record Git status and file baselines before the task.
- [ ] Save a snapshot and hash before the first write.
- [ ] Implement Keep, Continue, Revert file, and Revert all.
- [ ] Handle concurrent user modifications and conflicts.
- [ ] Complete post-crash recovery and Checkpoint cleanup.

> **Completion gate:** Reverting an Agent task never destroys uncommitted work that existed before the task.


## M8: Stability, Evaluation, and an Installable Version
- [ ] Complete long-output truncation, backpressure, timeouts, and child-process-tree termination.
- [ ] Complete structured logging, redaction, Run metrics, and diagnostic export.
- [ ] Run the fixed Agent evaluation set and Electron E2E tests.
- [ ] Complete macOS packaged build, install, and uninstall verification.

> **Completion gate:** The app can run continuously as a personal daily development tool, with clear means of diagnosing failures.


## M9: Follow-On Capability Roadmap
- [ ] Plan Mode, Todo, Session Fork.
- [ ] Local llama.cpp/OpenAI-compatible Provider.
- [ ] Mac Desktop + 4090 PC inference node.
- [ ] Remote Workspace, SSH, MCP, multi-Agent.
- [ ] Signing, Notarization, auto-update, and productized distribution.

> **Completion gate:** Every enhancement has its own ADR, evaluation, and security review, and does not encroach on the MVP core.
>
> **Split note (v1.1):** M9 was originally a single placeholder line. As of v1.1, the post-MVP roadmap is split into **M8.5 (close-out) + M9–M13**, detailed in §21–§26. This section is retained as a historical anchor; `docs/TODOS.md` remains the source of truth for execution status.


# 13. Testing and Agent Quality Evaluation

## 13.1 Test Layers

| **Layer**         | **Coverage focus**                                         |
|------------------|------------------------------------------------------|
| Unit             | State machine, risk classification, path decisions, data conversion, Repository     |
| Contract         | AgentRuntime, IPC Schema, Event Protocol, Pi Adapter |
| Integration      | Pi Session, Git, Checkpoint, SQLite, Keychain        |
| E2E              | The full path from opening a project to Review/Keep/Revert           |
| Security         | Path escapes, malicious scripts, sensitive files, dangerous commands, XSS/IPC      |
| Performance      | Very long sessions, tool output, large diffs, event throughput, memory           |
| Agent Evaluation | Task success rate, unrelated changes, test behavior, cost, and safety           |

## 13.2 Fixed Evaluation Tasks
- Change a button's copy and update the test.
- Fix a TypeScript type error.
- Add a TanStack Query request with loading/error states.
- Modify form validation and add tests.
- Locate and fix a failing test.
- Complete a small refactor spanning multiple files.
- Ask a question first when requirements are ambiguous, rather than expanding scope unilaterally.
- Trigger a denial or approval when encountering a request to read outside the Workspace.
- Trigger the correct risk level for a dangerous command.
- Cancel a long-running task and confirm child processes have been terminated.
- Precisely revert Agent changes when the project already has uncommitted changes.

## 13.3 Evaluation Metrics

| **Dimension** | **Metric**                                    |
|----------|---------------------------------------------|
| Correctness   | Whether the task was completed, tests pass, and no regression was introduced    |
| Restraint   | Whether unrelated changes were made, whether the task scope was expanded unilaterally          |
| Transparency   | Whether the user can understand the tools, state, and reasons for failure          |
| Safety   | Whether permissions were correctly triggered, whether there is any bypass              |
| Recoverability   | Whether state is consistent after cancel, crash, or revert           |
| Performance     | First token, total duration, diff open/scroll, peak memory |
| Cost     | Input/output tokens, caching, model cost             |

# 14. Observability and Runtime Protection
- Every Run records the Provider, Model, Thinking Level, start/end time, and final state.
- Record first-token latency, tool-call count, per-tool duration, and approval wait time.
- Record input/output tokens, context usage, cache hits, and available cost information.
- Record the number of files changed, the test command, and the test result.
- Logs are queryable by projectId/sessionId/runId, saved locally by default, and not auto-uploaded.
- Logs must be redacted before export; raw Shell output uses a separate file and its own retention policy.

## 14.1 Backpressure and Resource Limits

| **Object**      | **Policy**                                       |
|---------------|------------------------------------------------|
| Token Delta   | Merge updates per animation frame or short batch; write to the persistence layer only once the message completes |
| Shell Output  | The UI keeps a trailing window; the full log is written to a file; a memory cap is set  |
| Tool Result   | Apply controlled truncation and summarization when passing back to the model, keeping a truncation notice         |
| Diff          | Virtualized rendering; binary and very large files use a degraded display       |
| Child Process | Kill the entire process tree on timeout, cancellation, or app exit           |
| Event Queue   | Bounded queue, batch processing, drop old progress events that can be reconstructed           |

### 14.1.1 Concrete Values Currently in Effect (v1.2 addition)

The table above is policy; the table below is the **constants actually enforced in code**. Any change here should be kept in
sync with this table, or the numbers shown in Settings will drift from actual behavior (this is part of the §31 honesty contract).

| Limit | Value | Constant location |
|------|----|----------|
| message.delta batching interval | 16 ms | `DELTA_FLUSH_INTERVAL_MS` (main/index.ts) |
| Delta buffer cap | 500 entries | `MAX_BUFFERED_DELTAS` (same file) |
| Run timeout | 10 min (overridable via `RUN_TIMEOUT_MS`) | agent-pi |
| Per-command terminal timeout | 120 s | `DEFAULT_TIMEOUT_MS` (main/terminal) |
| Terminal output cap | 256 KB (keeps the tail + a truncation notice) | `MAX_OUTPUT_BYTES` (same file) |
| Resolved Checkpoint retention | 30 days (unresolved ones are **never** cleaned up) | `RESOLVED_CHECKPOINT_RETENTION_MS` |
| File search buffer | 8 MB | main/git/file-search-service |
| Automation scheduler tick | 30 s | `TICK_MS` (main/automations) |
| Missed-slot grace period | 60 min (skipped past that point, never caught up) | `MISSED_SLOT_GRACE_MS` |

> These values are surfaced to Settings via the `policy` field of `app.getInfo`; the UI no longer hardcodes this copy.

# 15. Release Gates
- [ ] All MVP primary-journey E2E tests pass.
- [ ] The fixed Agent evaluation tasks reach an acceptable success rate, with no serious security regression.
- [ ] Pi, SQLite, Keychain, and @pierre/diffs all work correctly in the packaged build.
- [ ] App exit, Abort, and crash recovery leave no orphan child processes and never corrupt the database.
- [ ] Tests for workspace escapes, sensitive paths, dangerous shell commands, and external side effects all pass.
- [ ] Keep/Revert never destroys uncommitted work that existed before the task.
- [ ] Logs contain no plaintext API keys, Authorization headers, or other sensitive credentials.
- [ ] Performance with large sessions and diffs meets daily personal-use requirements.
- [ ] Documentation is provided for data location, cleanup, export, and uninstall.

# 16. Risk Register

| **Risk**            | **Impact**               | **Mitigation**                                 |
|---------------------|------------------------|----------------------------------------------|
| Pi SDK API changes     | Regressions in Runtime and session behavior | Version pinning, adapter isolation, contract tests, upgrade evaluation   |
| Electron's permission surface is too large | Risk to local data or the system     | Main-process permission pipeline, minimal preload, future OS sandbox |
| Incorrect Checkpoint semantics | Destroys the user's existing changes       | Pre-write snapshot, hash, concurrent-conflict detection, recovery tests       |
| SQLite native packaging     | Works in dev but the installer fails   | Validate a packaged ARM64 build at the earliest stage            |
| Streaming events too dense        | Jank, memory growth     | Batching, virtualization, bounded queue, log to disk           |
| Large-diff performance        | Review becomes unusable          | Pierre CodeView, benchmarks, degradation strategy              |
| Provider/OAuth differences | Unstable login experience     | Fully support one Provider first, then expand one at a time          |
| Model capability differences | Fluctuating task success rate     | Fixed evaluation set, capability tags, explicit model switching          |
| Scope creep            | No usable version for a long time       | MVP freeze, non-goals list, completion gates               |

# 17. Key Decision Record

| **Decision**   | **Current choice**     | **Rationale**                                             |
|------------|------------------|------------------------------------------------------|
| Desktop framework   | Electron         | Directly integrates with Pi's Node/TS SDK, lowering first-version complexity           |
| Agent core | Pi SDK           | Reuse Provider, Model, Session, Tools, and Extensions   |
| Model abstraction   | Use Pi          | Don't duplicate a multi-Provider interface; keep only the AgentRuntime boundary |
| UI system    | shadcn/ui        | Lightweight, controllable, suited to customizing an Agent workbench                    |
| Async state   | TanStack Query   | Manage queries and mutations; streaming events never enter the Query Cache      |
| Diff       | @pierre/diffs    | Better suited to large code reviews, without pulling in the full Monaco editor            |
| Recovery       | Snapshot + hash      | Git Diff is only suitable for display, not for precisely distinguishing the source of changes             |
| Launch scope   | macOS + Git projects | Serve a real individual workflow first, reducing platform and recovery branches             |

# 18. Kickoff Development Backlog

The following order is the first batch of executable work after project kickoff. The goal is to get technical evidence as quickly as possible, not to finish a complete visual design first.

**First batch of tasks**
- [x] Create the pi-desktop repo and pnpm workspace.
- [x] Configure TypeScript, ESLint, Prettier, Vitest, and basic CI.
- [x] Create the minimal Electron Main, Preload, and React Renderer project.
- [ ] Install shadcn/ui, establish base theme tokens, and a three-column workbench skeleton. (Only minimal components exist, not a full shadcn system)
- [x] Pin the Pi SDK version and create the agent-pi package. (`@earendil-works/*@0.82.0`, see ADR-0002)
- [x] Define AgentRuntime, DesktopAgentEvent, AgentRunState, and AgentError.
- [x] Define the protocol package, establishing Typed IPC + Zod.
- [x] Create a Pi Session in the Main Process and send the first message. (Includes a real OpenCode Go model)
- [x] Show message deltas and tool events in the Renderer. (The real stream has been validated in eval)
- [ ] Implement Stop, and verify the Bash child-process tree is terminated. (abort API + unit tests exist; end-to-end still pending)
- [x] Prepare a test React project, requiring the Agent to modify a component and run tests. (`pnpm eval:fixture` PASS)
- [~] Produce a packaged macOS build, verify the Pi SDK still runs. (dir package + asar smoke test passed)
- [x] Record the technical-validation results, decide whether to continue on the SDK path or switch to the Pi RPC fallback path. (Continue on SDK)

> **Execution ledger:** All checkbox states are governed by [`docs/TODOS.md`](./TODOS.md).

## 18.1 Next Batch of Tasks After Technical Validation Passes
- [x] Implement Project, Workspace Trust, and recent projects. (SQLite projects + Trust UI)
- [x] Implement the Session Repository and SQLite migration. (`@pi-desktop/database`)
- [~] Implement Provider/Model selection and secure credential storage. (OpenCode Go + dropdown; Keychain not done yet)
- [~] Implement the full Agent Chat, Tool Cards, and Event Batching.
- [ ] Implement the Permission Pipeline and Approval Dialog.
- [ ] Integrate @pierre/diffs, complete multi-file review.
- [ ] Implement Checkpoint, Keep, Revert file, and Revert all.
- [ ] Complete the fixed evaluation set, E2E, security, and performance testing.

# 19. MVP Final Acceptance Script

1.  Open the app and select an existing React Git project that already has uncommitted changes.

2.  Confirm Workspace Trust, create a Session, select a Provider and Model.

3.  Ask the Agent to implement a small feature spanning multiple files, plus tests.

4.  Observe the Agent reading files, searching code, modifying files, and running tests.

5.  Trigger a command that requires approval, confirm the UI shows the risk, path, and impact.

6.  Send a Follow-up while the Agent is running, confirm the message lands in the correct Session.

7.  Once the task is complete, open the multi-file Diff, switch between unified/split, and review the test results.

8.  Ask the Agent to make one more small change, producing a second Run and Checkpoint.

9.  Revert the second Run, confirm the first Run's changes are still kept.

10. Revert all Agent changes, confirm the user's changes from before the task started are still fully intact.

11. Close and restart the app, confirm the Project, Session, Run, and audit records can be recovered.

> **The judgment of whether the product stands:** once the above script passes reliably, and you're willing to use it continuously on a real day-to-day project, the first version is done. Only then decide whether to prioritize local models, multi-Agent, or grow it into a sellable desktop product.


# 20. Technical Rationale and References
- Pi SDK: supports embedding Pi into custom Web, Desktop, and automation applications. https://pi.dev/docs/latest/sdk
- Pi Extensions: tool interception, permission gates, path protection, state, and custom tools. https://pi.dev/docs/latest/extensions
- Pi Coding Agent: Provider, Model, Session, and programmatic usage. https://github.com/earendil-works/pi
- Pierre Diffs: Diff/code rendering based on Shiki. https://diffs.com/
- Pierre CodeView technical write-up: virtualization-first rendering of large diffs. https://pierre.computer/writing/on-rendering-diffs


# 21. First-Version Close-Out (M8.5)

> **Why this section exists:** M0–M8's todos are mostly checked off, but the §15 release gates and §19 acceptance script **have not been passed item by item yet**. Before opening any new feature work, these gaps must be closed first, otherwise later enhancements would be built on an unverified foundation. M8.5 is not a new-feature phase — it is an **evidence-completion phase**.

## 21.1 Capabilities Already Closed Out (as of 2026-07-26)

| Capability | Evidence |
|------|------|
| Electron security baseline | contextIsolation + nodeIntegration off + whitelisted preload, no generic invoke |
| Typed IPC | `packages/protocol` Zod discriminated union, 30 methods |
| Pi adapter layer | `PiAgentRuntime` (createSession / prompt / steer / followUp / abort / setModel / listModels / dispose) + event mapping |
| Permission pipeline | tool-normalizer → risk-classifier → policy-engine → four approval states + audit log (Main-only) |
| Diff Review | `@pierre/diffs@1.2.12`, multi-file / unified-split / collapsing / large-diff benchmark |
| Checkpoint | SQLite v5: pre-write BLOB snapshot + hash + concurrent-conflict detection + Keep/Continue/Revert file/Revert all + crash recovery |
| Observability | NDJSON rotating logs + redaction + RunMetrics + `diagnostics.export` |
| Packaging | electron-builder mac-arm64 dir + DMG, `verify:packaged` validates asar / native / DMG |
| Testing | 25 files / 73 test cases passing; 11 fixture integrity checks; Playwright happy-path E2E |

## 21.2 Gaps That Must Be Closed in M8.5

| ID | Gap | Why it must be closed first | Definition of done |
|----|------|----------------|----------|
| M8.5-1 | **The M1 gate is not closed:** there is no end-to-end evidence of "inside a packaged app, real Provider authentication, a real coding task" | This is the founding premise of the entire technical approach; only offline integration tests and CLI-side fixture evals exist | Run through §19's script, steps 1–11, inside a packaged app; land screenshots/logs in `docs/eval-reports/` |
| M8.5-2 | **2 contract documents are missing:** `security-model.md`, `checkpoint-semantics.md` | Permissions and recovery are the product's highest-risk surfaces; the implementation exists but the semantics were never written down, leaving nothing to reference for future changes | The documents match the code, and every claimed semantic links to a corresponding test |
| M8.5-3 | **The repo structure doesn't match §6:** there is no `packages/git`, `packages/ui` (the git service lives under `apps/desktop/src/main/git`, UI components are scattered across the renderer) | A contract document that doesn't match reality keeps misleading people | Pick one: extract the packages, or update §6 to acknowledge the current structure — either way, record it in an ADR |
| M8.5-4 | **The evaluation set only has a baseline, no success rate** | §13.3's correctness/restraint/safety metrics are currently empty, so there's no way to tell whether a model or dependency upgrade has regressed | Run all 11 fixtures across at least 2 models × 3 times, record the success rate and the rate of unrelated changes |
| M8.5-5 | **The performance benchmark only covers diff parsing** | §15 requires "large session" performance; long-session event throughput and memory are untested | Add benchmarks for long sessions (≥2000 events) and very long tool output |
| M8.5-6 | **API keys still briefly pass through the Renderer** | Violates the spirit of §4.1 "secrets never enter the Renderer" (flagged `[~]` at M3-4) | Move input to the Main side (native prompt / separate BrowserWindow), or write an ADR explicitly accepting this risk and why |
| M8.5-7 | **Dependency versions are still mostly `^`** | §5's version policy requires the MVP not to auto-follow the latest | Pin the key dependencies; document the remaining exceptions |
| M8.5-8 | **Uninstall / data-location / export documentation is missing** | The last item of the §15 gates | `docs/data-lifecycle.md`: data location, cleanup, export, uninstall |
| M8.5-9 | **An uncommitted UI redesign** (light theme + `hiddenInset` title bar, 8 files, 843 lines changed) | Left sitting in the working tree long-term, it will conflict with future feature work | Consolidate into a design-token document and commit; or explicitly revert |
| M8.5-10 | **Composer capabilities that were promised but never implemented:** the placeholder reads `@ for files, / for commands, $ for skills`, and none of the three exist | The UI promises functionality that doesn't exist, which is a deceptive product defect | Either implement it (see §24.4), or fix the placeholder first |

> **M8.5 completion gate:** All nine §15 release gates have reproducible evidence; the §19 script passes once inside a packaged app; all 10 items in this section are `[x]` or have an ADR explaining why they won't be done.

## 21.3 New Features Are Not Allowed Until After M8.5

The reason is that this project has already had one instance of progress distortion — a "Fake runtime mistakenly marked as a real Pi integration" (see `docs/TODOS.md` §7). Every phase of the enhancement effort follows the same constraint: **evidence first, features second.**


# 22. Pi SDK Capability Inventory (0.82.0) and Unused-Capability Mapping

> **Why this section exists:** When planning "what else can we add," the cheapest source is not inventing new architecture, but **exposing SDK capabilities we've already paid for, that are already running in-process, but that the product hasn't surfaced yet**. The table below is based on an actual inventory of the d.ts surface of `@earendil-works/pi-coding-agent@0.82.0`.

## 22.1 AgentSession Capabilities → Product Status

| Pi SDK API | Product capability it enables | Desktop status |
|------------|------------------|--------------|
| `prompt` / `abort` / `setModel` / `listModels` | Basic conversation and model switching | **Wired up** |
| `steer` / `followUp` + `steeringMode` / `followUpMode` / `clearQueue` / `pendingMessageCount` | Interject mid-run, queuing policy, queue visualization and clearing | Partially wired (IPC has steer/followUp, no mode or queue UI) |
| `getContextUsage` / `getSessionStats` / `usage-totals` / `cache-stats` / `provider-attribution` | Context usage, tokens, cache hit rate, cost-attribution panel | **Not wired** (the UI only shows the coarse-grained values Pi reports) |
| `compact` / `abortCompaction` / `setAutoCompactionEnabled` / `SessionBeforeCompactEvent` | Automatic/manual compaction for long sessions, compaction-summary card | **Not wired** (long tasks run straight into the context limit) |
| `setThinkingLevel` / `getAvailableThinkingLevels` / `supportsThinking` / `cycleThinkingLevel` | Thinking-level control (explicitly required by step 3 of §2's primary journey, but never implemented) | **Not wired** |
| `scopedModels` / `setScopedModels` / `cycleModel` | Model orchestration: a strong model for planning, a fast model for execution, one-click switching | **Not wired** |
| `setActiveToolsByName` / `getAllTools` / `createReadOnlyTools` / `noTools` / `excludeTools` | **Plan Mode**, tool allow-listing, per-session tool policy | **Not wired** |
| `customTools` / `defineTool` | Register native desktop tools (todo, ask-user, MCP bridge, browser) | **Not wired** |
| `navigateTree` / `getUserMessagesForForking` / `SessionBeforeForkEvent` / `SessionTreeEvent` | Session Fork and tree-based history navigation | **Not wired** |
| `exportToHtml` / `exportToJsonl` | Session export, sharing, issue attachments | **Not wired** |
| `sendUserMessage([TextContent \| ImageContent])`, `steer/followUp(text, images)` | Image input: pasting screenshots, reproducing UI bugs | **Not wired** |
| `resourceLoader` / `promptTemplates` / `loadSkillsFromDir` / `BUILTIN_SLASH_COMMANDS` | `@` file references, `/` commands, `$` skills (already promised by the Composer) | **Not wired** |
| `bindExtensions` / `ExtensionRunner` / extension hooks (tool_call, tool_result, project_trust, resources_discover, session_*) | Extension Host: project-level custom tools and hooks | Only two hooks used — tool_call / tool_result — for permissions and snapshots |
| `executeBash` / `recordBashResult` / `output-guard` | Letting the user run their own commands, with the result entering the session context (terminal panel) | **Not wired** |
| `setAutoRetryEnabled` / `isRetrying` / `retryAttempt` / `abortRetry` | Automatic retry on Provider jitter, with visible state | **Not wired** |
| `extensions/llama` (llama.cpp + HuggingFace) | Local model Provider (an off-the-shelf implementation for M9-2) | **Not wired** |
| `setSessionName` / `sessionFile` / `reload` | Session naming, reload after external edits | Partial (rename goes through SQLite, not synced to the Pi session name) |

## 22.2 Capabilities the SDK Explicitly Does **Not** Provide, Requiring Custom Work

| Capability | 0.82.0 status | Custom-build plan |
|------|-------------|----------|
| MCP | **No MCP support at all** (the only hits across the entire repo are string matches in a vendored syntax-highlighting library) | Desktop implements its own MCP client, adapting MCP tools into Pi `customTools` (§24.5) |
| Todo / task checklist tool | No built-in todo tool | Register `desktop_todo_write` via `defineTool` (§24.2) |
| Sub-agent / multi-Agent orchestration | No spawn-agent tool | Multiple Sessions on the Main side + a `customTool` that spawns a child Session (§24.7) |
| File-level parallel isolation | Sessions share a single cwd | `git worktree` per session (§24.7) |
| Remote Workspace / SSH | None | A remote FS/exec abstraction on the Main side; substantial work, scheduled for M13 |

> **Planning conclusion:** For the vast majority of Tier A features in §24, the cost is concentrated in **IPC + UI + persistence** — the Runtime side is just exposing SDK calls that already exist. This is the highest-value batch of work available after the MVP.


# 23. Enhancement Roadmap Overview (M8.5 → M13)

| Phase | Theme | Core problem | Completion gate |
|------|------|----------|----------|
| **M8.5** | First-version close-out | The release gates have no item-by-item evidence | The 10 items in §21.2 are closed |
| **M9** | Context and cost economics | A long task fails outright once it hits the context limit, and cost is invisible | A single session can work continuously for ≥2 hours without being interrupted by context; cost and context usage are visible in real time and match the order of magnitude on the Provider's bill |
| **M10** | Plan and control | The user cannot steer direction before the Agent starts acting | Full Plan → Approve → Build flow; zero write operations in Plan Mode (asserted by a security test); Fork never damages any Checkpoint |
| **M11** | Capability expansion | The Agent only has four tools: read/write/edit/bash | Skills / Slash / `@` references are usable; Extension and MCP tools all go through the existing permission pipeline; supply-chain risk has a trust gate |
| **M12** | Provider and local inference | Relying solely on cloud Providers means the app is unusable offline and privacy is uncontrollable | Local models pass fixture evaluation; Provider health status is diagnosable; credentials never leave the local machine |
| **M13** | Workflow and distribution | Results stay stuck in the working tree, and the app can't be shipped to anyone else | Complete Git workflow (stage/commit/branch/worktree); signing + Notarization + auto-update; cross-platform decisions documented |

> **Constraints between phases (continuing the §0 progression principle):** Every phase gets its own ADR + evaluation + security review; no phase may encroach on the four hard contracts in §7–§11 — the Renderer has no privileges, permission decisions happen in Main, the Checkpoint is the only reliable recovery source, and Pi types never leave `agent-pi`.


# 24. Enhancement-Phase Design

## 24.1 M9: Context and Cost Economics

**Problem:** Right now, a long task fails outright the moment it hits the model's context limit; the user can't see "how much context is left," and can't see how much this task has cost. This is currently the single easiest way for the product to fall apart in real usage.

**Design:**

| Sub-item | Design |
|------|------|
| Context gauge | `session.getContextUsage()` polling + `SessionBeforeCompactEvent` push → new event `context.updated`; the UI shows a usage ring above the Composer (green/yellow/red tiers) |
| Automatic compaction | `setAutoCompactionEnabled(true)` + a threshold saved in settings; during compaction the UI enters a `compacting` state (`AgentRunState` needs one more state added) |
| Manual compaction | `/compact [instructions]` → `agent.compact` IPC; supports custom compaction instructions (e.g. "keep only context related to the auth module") |
| Compaction-summary card | `CompactionResult` (summary / tokensBefore / estimatedTokensAfter / usage) is stored in a `compactions` table; rendered in Chat as a collapsible special message |
| Cost attribution | `usage-totals` + `provider-attribution` + `cache-stats` → cost at the run / session / project level; cache hit rate is broken out separately (it has a huge effect on Anthropic-style Providers) |
| Visible auto-retry | `setAutoRetryEnabled` + `retryAttempt` → a `run.retrying` event, the UI shows "Retry attempt N" instead of appearing to hang |

**Security impact:** Compaction summaries are generated by the model and may contain sensitive file fragments; they go through `redactSecrets` before being written to SQLite, and are redacted the same way on export.

**Acceptance:** Build a fixture guaranteed to overflow context (a full-repo grep on a large repo plus multiple rounds of edits); verify the task still completes after automatic compaction, and that Checkpoint semantics are unchanged before and after compaction.

## 24.2 M10-a: Plan Mode and Todo

**Problem:** §1.3 listed Plan Mode as frozen out of the MVP, on the grounds that it doesn't block the primary journey. But in real usage, "the Agent just starts acting and goes in the wrong direction" is the most expensive failure mode. M10 is the right place to unfreeze it.

**Plan Mode design (the SDK already fully supports this, no hack needed):**

```text
SessionMode = 'build' | 'plan'

Entering plan:  session.setActiveToolsByName(readOnlyToolNames)   // read / grep / find / ls
                + a plan-specific system-prompt fragment
Exiting plan:   session.setActiveToolsByName(codingToolNames)     // + edit / write / bash
```

- Every Run records its `mode`; the `agent_runs` table gets a `mode` column.
- Plan output is stored as a Markdown checklist in a `plans` table; the UI provides an "Approve plan" action → injects the plan as the first message of a new build Run, and associates the plan id with that Run.
- **The permission pipeline still applies:** if a write/edit/bash request appears in Plan Mode, it's treated as a contract violation → denied + audited + clearly flagged in the UI (this is also a security-test assertion).
- Relationship to Checkpoint: a plan run produces no file changes, so it creates no snapshot, but it still creates an `agent_runs` record to preserve cost and duration.

**Todo design (no built-in SDK support, needs custom work):**

- Register `desktop_todo_write` via `defineTool` (input: `items: {id, text, status}[]`); Main persists it to a `todos` table and broadcasts `todo.updated`.
- The UI shows a live step checklist in the Chat sidebar; steps are aligned with the tool-call timeline (reusing M8-2's RunMetrics).
- This tool's risk level is `safe`, so it never enters the approval queue.

## 24.3 M10-b: Session Fork and Tree History

**Design:** `getUserMessagesForForking()` lists the possible fork points → `navigateTree(targetId)` switches between them; the SDK provides `SessionBeforeForkEvent` / `SessionTreeEvent` hooks for Main to record bookkeeping.

**Data model:** `sessions` gains `parent_session_id` and `fork_from_entry_id`.

**Key semantics (must be written into `checkpoint-semantics.md`):**

> **Fork only forks the conversation history, not the working tree.** Both branches share the same filesystem state. A Checkpoint belongs to a Run; forking **does not copy** the snapshot BLOB, it only keeps a reference — so when reverting a Run on a forked branch, you must verify that the current file hash still matches that Run's expected state (the conflict detection from M7-4 already provides this capability); if it doesn't match, refuse to auto-overwrite.

True file-level forking requires `git worktree`, which belongs to M13 (§24.7).

## 24.4 M11-a: Composer Capability Completion (`@` / `/` / `$`)

**Problem:** The placeholder already promises these; the implementation is zero (§21.2 M8.5-10).

| Trigger | Data source | Security constraint |
|--------|----------|----------|
| `@file` / `@dir` | Main-side `resources.search` IPC, based on ripgrep/fd within the workspace | Only paths within the workspace are allowed; protected paths are respected; result paths are canonicalized |
| `@symbol` | ripgrep + language-agnostic regex (no LSP in the first version) | Same as above |
| `/command` | `BUILTIN_SLASH_COMMANDS` + `session.promptTemplates` | Built-in commands are dispatched through a Main-side whitelist; arbitrary strings are never passed straight through |
| `$skill` | `loadSkillsFromDir` (`~/.pi/skills` + the project's `.pi/skills`) | **An in-project skill is a code-level supply-chain risk:** it requires one more explicit enable confirmation beyond Workspace Trust, and must list the skill's source path |

## 24.5 M11-b: Extension Host and the MCP Bridge

**Extension Host:** Pi extensions are **arbitrary code that executes inside the Main process**. Therefore:

- Project-local extensions are not loaded by default; after Trust, the user must explicitly check an enablement list (per-project, stored in SQLite).
- Load results, diagnostics, and every hook invocation are written to the audit log.
- Tools registered by an extension **do not bypass** the permission pipeline: the tool names returned by `getAllTools()` all go through the tool-normalizer, and unknown tools default to `external-side-effect` risk (fail-closed).

**MCP bridge (the SDK has no MCP, so this is custom-built):**

```text
MCP Server (stdio / http)
  ↓ Desktop MCP Client (Main process, its own child process, with a timeout/output cap)
  ↓ tools/list → wrapped with defineTool()
Pi customTools → tool_call hook → tool-normalizer → risk-classifier → policy-engine
```

- MCP tools default to `external-side-effect` risk; the first call always requires approval, with allow-session / allow-project memory supported.
- The MCP server process is folded into M8-1's process-tree termination logic (no leftovers on exit/Abort).
- Needs its own ADR: why build a bridge while the SDK has no MCP, and how to migrate once the SDK adds it.

## 24.6 M12: Provider and Local Inference

| Sub-item | Design |
|------|------|
| Local llama.cpp | Directly reuse `@earendil-works/pi-coding-agent/dist/extensions/llama` (including HuggingFace model pulling and the provider implementation); the UI provides model-download progress and local-port configuration |
| OpenAI-compatible | A Provider entry with a custom base URL and key (covers vLLM / LM Studio / Ollama / self-hosted gateways) |
| Provider health check | Probe on startup and switch: credential validity, model-list reachability, rate-limit status; results are cached and shown on the Auth row (extending the existing `agent.authStatus`) |
| Model capability tags | Sourced from `model-registry` / `model-config`: context window, vision, thinking, tool use; shown in the model dropdown in the UI, to avoid picking a model that doesn't support tool calls |
| Mac + 4090 node | The 4090 side runs an OpenAI-compatible server, the Mac side acts as the client; **the Workspace and files never leave the local machine**, only the prompt/completion crosses the network; the link runs over Tailscale or an SSH tunnel, requiring an ADR + security review (making explicit the fact that the prompt will include source-code fragments) |

## 24.7 M13: Git Workflow, Parallelism, and Distribution

| Sub-item | Design | Risk level |
|------|------|----------|
| Stage / Unstage (including hunk-level) | The Main-side git service adds write operations, reusing Pierre diff's hunk structure | Requires approval (write operation) |
| Commit message generation | Generated from the current session's model + staged diff, editable by the user; **never auto-committed** | Commit is high-risk, must be approved |
| Branch / `git worktree` isolation | Each Session can optionally bind to an independent worktree → the real basis for parallel runs; Checkpoint scope is then bound to the worktree path | High risk |
| Push | **Denied by default**, only released via explicit approval, with no "remember this decision" option | external-side-effect |
| Terminal panel | `executeBash` + `recordBashResult` + `output-guard`: the user runs their own commands, and the result enters the session context, saving the Agent from re-exploring | User-initiated, still audited |
| Session export | `exportToHtml` / `exportToJsonl` + redaction before export | — |
| Parallel multi-Agent | Prerequisite is worktree isolation + event routing (already scoped by projectId/sessionId/runId); a sub-Agent spawns a new Session via `customTool`, and the parent session only gets the summary | Requires an ADR |
| Signing / Notarization / auto-update | Developer ID signing + notarytool + electron-updater; the update source and signature-verification policy must be documented | Requires an ADR |
| Cross-platform | Windows/Linux need rework: `node:sqlite` availability, Keychain → `safeStorage`, process-tree termination (`taskkill /T` vs. pgid), and path case/symlink semantics | Requires an ADR |


# 25. Feature Candidate List and Priority

> Ranking basis: **marginal benefit to "sustained daily personal use" ÷ implementation cost**, favoring items the SDK already supports where only IPC/UI work remains.

## 25.1 Tier A — Directly Determines Daily Usability (recommended to complete within M9–M11)

| # | Feature | Basis | Cost | Notes |
|---|------|------|------|------|
| A1 | Context-usage gauge + auto/manual compaction | §24.1 | Medium | **Highest priority**: without this, long tasks are guaranteed to break off |
| A2 | Thinking Level selector | §22.1 | Low | Already required by step 3 of §2's primary journey, yet never implemented |
| A3 | Token / cost / cache-hit panel | §24.1 | Medium | Invisible cost = users won't dare to use it for long |
| A4 | `@` file references + `/` commands + `$` skills | §24.4 | Medium | Already promised by the UI, must be delivered |
| A5 | Plan Mode (Plan → Approve → Build) | §24.2 | Medium | The direct remedy for the most expensive failure mode (going the wrong direction) |
| A6 | Todo / step checklist | §24.2 | Low | Comprehensibility for long tasks, aligned with §13.3's "transparency" |
| A7 | Image input (screenshot paste / drag-and-drop) | §22.1 | Low | Huge input-efficiency gain for UI-related tasks |
| A8 | Follow-up queue visualization + clear + queue mode | §22.1 | Low | `clearQueue` / `pendingMessageCount` already exist, pure UI work |
| A9 | Global command palette + keyboard shortcuts | — | Low | Basic table stakes for a desktop app; currently everything is mouse-driven |
| A10 | Cross-session search (messages / tools / files) | — | Medium | SQLite FTS5; once there are many sessions, no search means a data graveyard |
| A11 | Visible auto-retry status | §24.1 | Low | Turns "looks frozen" into "retrying" |
| A12 | Session export (HTML / JSONL, redacted) | §24.7 | Low | A one-line SDK call |
| A13 | Model capability tags + model orchestration (scopedModels) | §24.6 | Medium | Avoids picking a model that doesn't support tool use |

## 25.2 Tier B — Structural Capabilities (M11–M13)

| # | Feature | Basis | Cost |
|---|------|------|------|
| B1 | Session Fork + tree history | §24.3 | Medium |
| B2 | Extension Host (explicit enable + audit) | §24.5 | Medium |
| B3 | MCP client bridge | §24.5 | High |
| B4 | Terminal panel (user commands enter context) | §24.7 | Medium |
| B5 | Git stage / commit + message generation | §24.7 | Medium |
| B6 | `git worktree` isolation and parallel Sessions | §24.7 | High |
| B7 | Local llama.cpp Provider | §24.6 | Medium |
| B8 | OpenAI-compatible custom Provider | §24.6 | Low |
| B9 | Provider health check and diagnostics | §24.6 | Medium |
| B10 | Diff line-level comments / line-level instructions (select lines → tell the Agent to change this) | §3 later enhancement | Medium |
| B11 | Project grouping and workspace favorites | §3 later enhancement | Low |
| B12 | Session templates / project-level prompt presets | `promptTemplates` | Low |

## 25.3 Tier C — Productization and Ecosystem (M13+, needs stable user value established first)

| # | Feature | Cost | Prerequisite |
|---|------|------|----------|
| C1 | Signing + Notarization + auto-update | Medium | Only matters once distributing externally |
| C2 | Windows / Linux support | High | Needs an ADR to define the platform-abstraction boundary first |
| C3 | Mac + 4090 remote inference node | Medium | §24.6 security review |
| C4 | Remote Workspace / SSH | High | Requires a major Main-side FS/exec abstraction rework |
| C5 | Multi-Agent orchestration (parent/child task decomposition) | High | Depends on B6's worktree isolation |
| C6 | Session sharing / team collaboration | High | Involves a server side, beyond the "local-first" positioning, needs a product-form decision first |
| C7 | Crash reporting and anonymous telemetry (off by default) | Low | Needs a documented privacy policy |
| C8 | Browser tool (screenshot / DOM inspection) | High | Significantly expands the permission surface, needs its own security review |

## 25.4 Explicitly Out of Scope (continuing the spirit of §1.3)

- Cloud session sync and account systems: conflicts with the "local-first, data never leaves the machine" positioning.
- Building a custom multi-Provider abstraction layer: §17 already decided to delegate this to Pi.
- A full built-in editor (Monaco/LSP): this product is an Agent workbench, not an IDE; line-level editing is left to the user's own editor.
- A plugin marketplace: not until the Extension security model matures enough to support distribution.


# 26. Protocol and Data Model Evolution

## 26.1 IPC Increments (preserving §4.1's "everything Zod-validated")

| Phase | New methods | New events |
|------|-------------|----------|
| M9 | `agent.compact`, `agent.setAutoCompaction`, `agent.getContextUsage`, `agent.setThinkingLevel`, `session.getStats` | `context.updated`, `compaction.completed`, `run.retrying` |
| M10 | `agent.setMode`, `plan.approve`, `plan.list`, `session.fork`, `session.navigateTree`, `session.listForkPoints` | `todo.updated`, `plan.updated`, `mode.changed` |
| M11 | `resources.search`, `skills.list`, `skills.setEnabled`, `commands.list`, `extensions.list`, `extensions.setEnabled`, `mcp.addServer`, `mcp.listTools` | `extension.diagnostic`, `mcp.serverState` |
| M12 | `provider.testConnection`, `provider.addCustomEndpoint`, `localModel.download`, `localModel.status` | `provider.health`, `localModel.progress` |
| M13 | `git.stage`, `git.unstage`, `git.commit`, `git.generateCommitMessage`, `git.createWorktree`, `terminal.exec`, `session.export` | `terminal.output`, `worktree.changed` |

**Constraint:** New methods always go through the `IpcCommandSchema` discriminated union; events always carry `projectId/sessionId/runId/sequence/timestamp` (§4.1 A4); the Renderer still has no generic invoke.

## 26.2 SQLite Migration Roadmap (currently v10)

**Already shipped** (`packages/database/src/migrations.ts` is the single source of truth):

| Version | Name | Content |
|------|------|------|
| v1–v3 | `sessions_and_schema_meta` / `projects` / `checkpoints_agent_runs_and_baseline_files` | Base tables |
| v4–v5 | `checkpoint_write_snapshots` / `checkpoint_review_outcomes` | Pre-write snapshot BLOBs and Keep/Continue/Revert results |
| v6 | `checkpoint_write_snapshot_expected_states` | Snapshot expected state (exists/sha256/size), the basis for pre-revert conflict detection |
| v7 | `checkpoint_recovery_conflicts` | Recovery conflict records |
| v8 | `sessions_soft_delete` | `sessions.deleted_at`, soft delete |
| v9 | `run_metrics` | Per-run token/cost/duration/result, the data source for the Usage page; previously metrics only lived in memory and were lost on every restart |
| v10 | `workspace_index` | `index_files` + FTS5 `index_content` + `index_state`, a cross-project search index |

**Planned** (version numbers continue from the table above, not reused):

| Version | Phase | Content |
|------|------|------|
| v11 | M9 | `compactions` (session_id, run_id, summary, tokens_before, tokens_after, usage_json); `agent_runs` gains `cache_read_tokens`, `cache_write_tokens`, `retry_count` |
| v12 | M10 | `plans` (id, session_id, run_id, markdown, approved_at); `todos` (id, session_id, run_id, text, status, ordinal); `agent_runs` gains `mode`; `sessions` gains `parent_session_id`, `fork_from_entry_id` |
| v13 | M11 | `project_extensions` (project_id, source_path, enabled, enabled_at); `mcp_servers` (id, name, transport, command_json, enabled); `skill_grants` (project_id, skill_path, granted_at) |
| v14 | M12 | `provider_endpoints` (id, kind, base_url, model_ids_json); `provider_health` (provider_id, checked_at, status, detail) |
| v15 | M13 | `worktrees` (session_id, path, branch, created_at); `terminal_runs` (session_id, command, exit_code, output_path) |

**Relationship between the index and trust (an extension of §9):** the index is a persistent copy of file content, so only trusted projects are indexed; revoking trust deletes all of that project's index rows at the same time (`IndexService.refresh` calls `deleteProject` first on the untrusted branch), and the search stage filters by trusted status again, preventing leftover rows from being read out.

**Migration constraints (continuing §10.1):** every migration must be forward-only, backed up, and documented for rollback; the snapshot BLOB table schema is never modified destructively; destructive migrations are forbidden while unresolved Checkpoints exist.


# 27. Enhancement-Phase Additions to Testing, Evaluation, and Risk

## 27.1 Fixed Evaluation Set Expansion (on top of the existing 11 fixtures)

| New fixture | Capability it validates | Corresponding phase |
|------------|------------|----------|
| `context-overflow` | A task guaranteed to exceed context, still completes after automatic compaction | M9 |
| `plan-then-build` | Plan Mode is read-only, executes according to the plan after Approve, no changes outside scope | M10 |
| `plan-mode-violation` | The model attempts to write a file in Plan Mode → must be denied and audited | M10 (security) |
| `fork-revert-safety` | Reverting on a forked branch doesn't damage the other branch or the user's uncommitted changes | M10 (recoverability) |
| `skill-supply-chain` | An in-project malicious skill / extension cannot execute without being explicitly enabled | M11 (security) |
| `mcp-tool-approval` | An MCP tool's first call must be approved, and it does not execute after a deny | M11 (security) |
| `local-model-parity` | Comparing a local model's success rate and cost against the baseline fixtures | M12 |
| `worktree-isolation` | Two parallel Sessions don't pollute each other's files or Checkpoints | M13 |

## 27.2 Performance Benchmark Expansion

| Benchmark | Target |
|------|------|
| Long-session event throughput (≥2000 events) | UI does not drop frames, memory does not grow monotonically |
| Very long tool output (≥10MB) | The trailing-window policy takes effect, main-process memory has a cap |
| Compaction duration and first-token latency after compaction | Compaction never makes the user feel "stuck" |
| Git operations under multiple parallel worktrees | No lock contention causing an apparent hang |

## 27.3 Risk Register Additions (continuing §16)

| Risk | Impact | Mitigation |
|------|------|------|
| Compaction loses critical context | The Agent forgets constraints, repeats work, goes in the wrong direction | Compaction summaries are visible/expandable; custom compaction instructions supported; regression via the `context-overflow` fixture |
| Extension / Skill supply chain | Arbitrary code execution inside the Main process | Not loaded by default + explicit enable + source display + audit + security fixture |
| The MCP bridge expands the permission surface | Uncontrolled external side effects | Fail-closed risk level, mandatory approval, folded into the process tree, timeout and output caps |
| Fork coupled to Checkpoint semantics | An incorrect Revert damages work on another branch | Fork doesn't copy the snapshot + hash check before recovery + refuse-to-overwrite on conflict |
| Local model capability shortfall | Task success rate drops sharply, users misjudge product quality | Capability tags + local-model evaluation report + a clear "local model capability is limited" notice |
| A remote inference node leaks source code | The prompt, containing source-code fragments, crosses the network | Make the data flow explicit, encrypt the tunnel, make it toggleable, document the accepted risk in an ADR |
| Parallel Session conflicts | Files overwrite each other | Strong worktree isolation; forbid parallel writes to the same project when not isolated |
| Scope creep in the enhancement phase | No usable version, yet again | No new features before the M8.5 gate; every phase has its own gate and ADR |


# 28. ADR Queue

> Existing: ADR-0001 (Electron + Pi), ADR-0002 (Pi SDK version pinning). Below are the decision records that should be added, phase by phase.

| # | Topic | Trigger phase | Must answer |
|------|------|----------|----------|
| 0003 | `@pierre/diffs` selection and version policy | M8.5 (retroactive) | Why not Monaco; upgrade regression steps |
| 0004 | SQLite driver choice (`node:sqlite` experimental feature) | M8.5 (retroactive) | Experimental-feature risk, packaged ARM64 validation, fallback path to better-sqlite3 |
| 0005 | Repository structure alignment (extract `packages/git`, `packages/ui`, or amend §6) | M8.5 | Dependency direction and benefit assessment |
| 0006 | API key input path (Main-side input vs. accepting brief exposure through the Renderer) | M8.5 | Threat model and trade-offs |
| 0007 | Context-compaction strategy (automatic threshold, summary retention, cost accounting) | M9 | Acceptable bounds for compaction-induced distortion |
| 0008 | Plan Mode implementation approach (tool-set switching vs. a separate Session) | M10 | Why `setActiveToolsByName` was chosen; violation handling |
| 0009 | Fork semantics (forks history only, not files) | M10 | Interaction rules with Checkpoint |
| 0010 | Extension / Skill trust model | M11 | Enablement gate, audit, revocation |
| 0011 | MCP bridge architecture (custom-built while the SDK lacks MCP, future migration path) | M11 | Process model, permission mapping, how to retire this once the SDK supports MCP |
| 0012 | Local inference and remote-node data flow | M12 | Whether source code crosses the network, encryption, and toggle |
| 0013 | Git write operations and worktree isolation | M13 | Approval boundary, push policy |
| 0014 | Distribution: signing, Notarization, auto-update source | M13 | Update verification and rollback |
| 0015 | Cross-platform abstraction boundary | M13 | SQLite / Keychain / process tree / path semantics


# 29. Implementation-Era Lessons and Anti-Pattern Checklist (v1.2)

> **Why this section exists:** §1–§28 were written before work began. This section records **things we only learned after actually
> implementing it** — ten defects found and fixed during one round of v2 design landing, abstracted into reusable anti-patterns.
> Four of them were silent failures: no error, the UI looked fine, but the feature simply never ran. This class of defect can't
> be found by "just try it and see" — it needs a checklist.

## 29.1 Anti-Pattern One: A Scope Filter Swallowed a Blocking Event

The Renderer's event store filters events by `activeProjectId / activeSessionId / activeRunId` to prevent cross-talk. But the
Terminal panel's approval requests carry their own session/run id — so the approval event was silently dropped,
`await pending` never resolved, the command hung forever, and the user saw nothing.

**Rule:** Any event that **blocks its caller** (approval, confirmation, anything requiring a user decision) must be exempt from
scope filtering. Dropping one of these events isn't "showing a little less" — it's a deadlock.

## 29.2 Anti-Pattern Two: A Lifecycle Claim Was Only Released on the Success Path

An automation calls `claimSession(sessionId)` **before** sending its prompt (because even the first round can trigger an approval).
But the release was only written on the success path. When startup fails (e.g. the Provider is unavailable), the claim leaks
permanently — after that, the **user's own** actions in that session get automatically adjudicated by this now-dead automation's mode;
under `unattended`, that means silently approving the user's own writes.

**Rule:** Any "claim first, release later" pairing must release in a `catch`/`finally` block. Any claim that touches permissions —
leaking it is a privilege-escalation bug, not a memory leak.

## 29.3 Anti-Pattern Three: Treating "the Next Occurrence" as "Is It Due Now"

`nextRunAt()` only ever returns a **future** time; `isDue()` checks `next <= now`. Combining the two means a daily
automation **never fires**. The feature was fully written, the UI looked normal, the toggle worked — it just never ran.

**Rule:** Scheduling logic must treat "the next trigger time" and "is it due right now" as two separate concepts, tested
separately, with at least four test cases: "fires when due / doesn't fire when not due / doesn't catch up on missed slots / doesn't
duplicate within the same window."

## 29.4 Anti-Pattern Four: Held Until "Start" Instead of "Finish"

The concurrency guard `running` was released right after the run *started*, so clicking Run now repeatedly, or the next scheduler
tick, would launch it again.

**Rule:** An idempotency guard's holding interval is the entire lifecycle of the operation, not just its startup phase.

## 29.5 Anti-Pattern Five: State Attribution Confused (Selected ≠ Running)

The "running" red dot and status label were rendered based on the **selected** item. So while A was running and you clicked
over to B, B got labeled as running with a pulsing animation.

**Rule:** Running state belongs to **the entity holding that run** (`activeSessionId`), not to the UI's selection state.
The two must be separate variables.

## 29.6 Anti-Pattern Six: Theme Inversion Broke a Copy-Pasted Foreground Color

The design's dark map darkened accent's **light backgrounds** (100/200), but the spec still used accent-800/900 as the
**text color** on top of those backgrounds; once the neutral scale was globally inverted, `neutral-200 on neutral-900` also
became dark-text-on-dark-background. Copying the spec literally = large swaths of unreadable text in dark mode.

**Rule:** When porting a design spec literally, **background and foreground colors must be checked as a pair**, never copied
independently. In an inverted theme, "the readable version of the accent color" is a dark shade in light mode and a light
shade in dark mode — this needs its own semantic tokens (this project uses `--color-output` / `--color-output-foreground` plus an
inverted accent shade).

## 29.7 Anti-Pattern Seven: Device Pixel Ratio Silently Changed Output Dimensions

On a Retina screen, `capturePage()` returns 2× the size, so `icon_512x512@2x.png` became 2048px — violating the icns
spec, and `iconutil` **doesn't error**. This nearly shipped an icon with the wrong dimensions.

**Rule:** Any rasterization step that produces a **fixed-size** artifact must explicitly normalize and assert the size,
never trust the rendering environment's DPR.

## 29.8 Anti-Pattern Eight: A Control Wrote a Preference, but No Code Ever Read It

The density toggle stored its value in preferences, and `data-density` was even set on `<html>`, but not a single line of
CSS consumed it — a toggle that looks functional but does absolutely nothing.

**Rule:** See §31. A toggle's acceptance criterion is "an observable behavior change," not "the value got persisted."

## 29.9 Anti-Pattern Nine: Copy Described Intent, Not the Implementation

The Composer's hint text read "writes + bash need approval," but `autoAllowWorkspaceWrite` defaults to `true` — writes were
already auto-allowed. The copy wasn't outdated; it was **never correct to begin with**.

**Rule:** Any string describing a policy must be derived from that policy's **single source of truth** (in this project: the
three-tier mode → a hint-text table), never hand-written. Likewise, any Settings string describing protected paths, retention
periods, or timeout values should be changed to read the real values from `app.getInfo`.

## 29.10 Anti-Pattern Ten: Tests Were Written Where It Was Easy, Not Where the Security Path Was

Initially only the automation's time arithmetic was tested (pure functions, easy to test), while the actually dangerous
automatic-approval decision paths (unattended auto-allow / read-only auto-deny / attribution logic) had zero coverage.

**Rule:** Test priority should be ordered by **the consequence of getting it wrong**, not by how easy something is to test.
Security-relevant branches (who can auto-allow, what must never be allowed, what happens if attribution is wrong) must have
test cases.

## 29.11 Pre-Merge Checklist

| Check | Why |
|------|--------|
| Are blocking events exempt from scope filtering? | §29.1 |
| Is every claim released on the failure path too? | §29.2 |
| Does scheduling logic have "due / not due / missed / duplicate" test cases? | §29.3 |
| Does the idempotency guard cover the operation through to its end? | §29.4 |
| Is "running" derived from run ownership, not UI selection? | §29.5 |
| After adding/changing a theme token, was background + foreground verified as a pair in dark mode? | §29.6 |
| Are fixed-size artifacts asserted for size? | §29.7 |
| Does every new toggle have an observable behavior change? | §31 |
| Is policy-describing copy derived from the policy's data source? | §29.9 |
| Do security-relevant branches have tests? | §29.10 |


# 30. Design-to-Implementation Fidelity Contract (v1.2)

> This project's main workflow is "Claude Design design file → implementation." This workflow has recurring pitfalls that
> deserve to be documented rather than judged case by case each time.

## 30.1 Data in the Design File Is a Placeholder, Not a Requirement

The design file ships with complete fake data (task lists, terminal history, automations, skills, search results, Provider
entries). **None of this may ever enter the application.** Its purpose is to describe **shape** (which fields, what hierarchy,
what states) — not to describe content.

The test: where would this cell's data come from at runtime, from which backend? If you can't answer that, it means the
backend is missing — handle it per §31, don't copy the fake value in.

## 30.2 The Design File Can Have Bugs; Copying It Literally Copies the Bug into the Product

This round's real-world testing found three problems in the design file:

1. The dark map's background/foreground colors aren't paired (§29.6), unreadable in dark mode.
2. The icon module ships with a comment reading "only intended for CLI use, not browser environments" —
   in Electron this must run in Main (Node), not the Renderer.
3. The Composer placeholder promises three capabilities — `@ files / commands / $ skills` —
   and the design file itself doesn't implement any one of them.

**Rule:** What you're porting literally is **intent**, not bytes. Any design defect discovered during the port must be fixed,
with a code comment explaining "what the design said here, and why it was changed" — otherwise the next person will assume it's
an implementation drift.

## 30.3 CSS Semantics → Target Format Requires Real Conversion Math

Converting `linear-gradient(160deg, A, B)` into an SVG `linearGradient` can't be eyeballed for endpoints. A 160° gradient
line direction is `(sin160, -cos160) = (0.342, 0.940)`; on a square, the gradient length is `|sin| + |cos| = 1.282`,
giving endpoints `(0.281, -0.103) → (0.719, 1.103)`. Other conversions needing real math: `border-radius` percentage →
absolute radius, `box-shadow inset`, and `::after` overlay layer order.

## 30.4 Small Sizes Are Allowed to Simplify, and Should

The design file itself drops fine detail at small sizes. The icon generator does the same (removing that element below
128px). A macOS iconset is inherently one image per size — this is a normal, spec-compliant practice, not a shortcut.

## 30.5 What Counts as Legitimate Static Content

Titles, body copy, explanatory text, icons, tone/theme token mappings, keyboard-shortcut labels (which **are** the binding
itself) — these are naturally static and don't need to be made dynamic. What needs to be made dynamic is **anything claiming
to describe system state**.


# 31. Honest Presentation Contract (v1.2)

> This repo has already had one instance of progress distortion (see `docs/TODOS.md` §7: treating the Fake runtime as if it
> were a real Pi integration). This section elevates "no faking it" from culture to a checkable contract.

## 31.1 Three Allowed Forms, One Forbidden Form

| Form | When to use | Example |
|------|--------|-----|
| **Real and interactive** | A backend exists | Theme switching, approval mode, automation toggles |
| **Real and read-only** | Behavior is fixed, the value is readable | Protected paths, retention period, terminal cap |
| **Explicitly missing** | No backend | Don't render it, or render `—` + a "not recorded" note |
| ~~**Inert control**~~ | **Forbidden** | Clickable, storable, but no code anywhere reads it |

## 31.2 Unknown Values Must Never Be Made Up

If a number was never reported, show `—` with a "not recorded / not reported" note — never fill in 0, never fill in an
example value. This is already standardized via `NOT_REPORTED` in `lib/status.ts`.

## 31.3 Unimplemented Entry Points: Either Omit Them, or Clearly Disable Them

For entry points that exist in the design but have no backend: `disabled` + a tooltip explaining it isn't implemented, or
just don't render it at all. "Clickable but does nothing" is not allowed.

## 31.4 The Definition of "Feature Complete"

A feature only counts as "implemented" if it satisfies all of the following:

1. It has a real backend (not fake data living in the Renderer);
2. It crosses process boundaries via typed IPC with Zod validation;
3. It has tests, including coverage of failure/security branches;
4. Every number/path/status shown in the UI comes from a real data source;
5. Known limitations are documented in a code comment or in this document (e.g., the terminal has no PTY, `allow-project` doesn't survive a restart).


# 32. State-Storage Inventory (v1.2)

> §10 only covers SQLite. In reality, state is scattered across four different places, and without a single master table you
> end up with "I thought this was persisted but it wasn't" problems — the last two rows in the table below are exactly that
> situation.

| State | Location | Survives restart | Contains secrets | Notes |
|------|------|--------|------|------|
| Project / Session / Checkpoint / snapshot BLOB | SQLite (Main) | ✅ | ✖ | §10, migrated up to v5 |
| Provider API Key | A Main-private file, encrypted with safeStorage | ✅ | ✅ | Never enters SQLite / logs / the Renderer's persistence layer |
| Provider OAuth credentials | Pi's `AuthStorage` (auth.json) | ✅ | ✅ | Pi refreshes it itself, see §24.6 |
| Automation definitions | A Main-private JSON file | ✅ | ✖ | Migrating to SQLite is §26.2 v6 |
| Skill enablement state | A Main-private JSON file | ✅ | ✖ | The file itself is the source of truth |
| Default approval mode / UI behavior toggles | A Main-private file | ✅ | ✖ | Notifications, trust-new-project, default project directory |
| Theme / density / motion / diff view | Renderer localStorage | ✅ | ✖ | A pure presentation preference, needs no privilege, so it skips IPC |
| Pi Session (conversation memory) | In the Pi process | ✖ | — | Lazily rebuilt after a restart from the SQLite record |
| **Run metrics (duration/tokens/cost/tool count)** | **In-memory only** | **✖** | ✖ | **Should be persisted:** all five placeholders on the Home page depend on it, §26.2 v6 |
| **`allow-project` memorized rules** | **In-memory only** | **✖** | ✖ | **Should be persisted:** otherwise "remember this project" isn't true to its name; Settings already discloses this honestly |


# 33. Accessibility and Localization Baseline (v1.2)

> Current state: the design system already ships a `:focus-visible` focus ring, `prefers-reduced-motion` is implemented, and
> interactive controls already carry `role=switch / radiogroup / dialog + aria-modal`. But this document previously had no
> section for this at all, and without acceptance criteria, it will regress with each iteration.

## 33.1 Must Be Preserved

- **Keyboard reachability:** the primary journey (open project → create task → send message → approve → review → Keep/Revert)
  must be completable entirely with the keyboard; the ⌘K palette supports ↑↓/↵/esc.
- **Focus visibility:** always use the design system's 2px accent `:focus-visible`; it must never be removed.
- **Motion can be disabled:** the OS's `prefers-reduced-motion` takes effect unconditionally, plus a separate in-app toggle.
- **State is never color-only:** run states also have a text label (`running` / `waiting_for_approval`),
  never distinguished by dot color alone.

## 33.2 Known Gaps

- The design system's readme states that accent-on-background contrast is about 3:1 — **enough for icons, large text, and
  decoration, not enough for body text**. When accent is used for body text, it must use a darker shade (`accent-700`+ in light mode).
- No real screen-reader testing has been done; the streaming-output region doesn't yet have `aria-live` (long-running streaming
  updates are unfriendly to screen readers as-is).
- No keyboard focus-trap testing has been done (Tab cycling within a modal).

## 33.3 Localization: An Open Question

`index.html` declares `lang="zh-CN"`, but all UI copy and product/engineering docs are in English.
This is inconsistent, and needs a decision:

- **A:** Keep the UI in English → change `lang` to `en` (recommended for MVP; a one-line change removes the inconsistency).
- **B:** Localize the UI → introduce an i18n layer (externalized copy, locale-aware plurals/dates), accepting that it will
  affect how §29.9's "copy derived from a data source" is implemented.

Option A is recommended for the MVP phase; option B should be evaluated at M13's productization stage.


# 34. Build-Environment Invariants (v1.2)

> Pitfalls hit during this round, written down to avoid rediscovering them.

| Constraint | Consequence | Response |
|------|------|------|
| `index.html`'s CSP is `default-src 'self'` | Remote fonts/scripts always fail to load | Don't use Google Fonts; vendor the woff2 file into the repo when precise typography is needed |
| ImageMagick's built-in SVG renderer doesn't support gradients/clipPath | Outputs a solid black square, and **doesn't error** | Rasterize via Electron's own bundled Chromium (`pnpm icon:generate`) |
| `npx electron` pulls an unpinned Electron version | Doesn't match the app's actual runtime version, and triggers a network download | Always use `./apps/desktop/node_modules/.bin/electron` |
| Retina-screen `capturePage()` returns 2× | Fixed-size artifacts end up the wrong dimensions | Explicitly normalize and assert (§29.7) |
| `@pierre/diffs`'s CodeView has no line-number/font-size props | The corresponding settings can't be implemented | Settings doesn't render these two rows (§31) |
| Electron off-screen windows are unstable when repeatedly created/destroyed | A second `loadFile` throws `ERR_FAILED` | Reuse a single window, call `loadFile` multiple times |

# 35. Acknowledgments

Huge thanks to **[Pi](https://github.com/earendil-works/pi)** — the open-source coding agent runtime that powers PiX. This project stands on the shoulders of the Pi Agent team and community.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=penouc/pix&type=Date)](https://www.star-history.com/#penouc/pix&Date)

