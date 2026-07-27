# ADR-0003: Automations Support Full Unattended Execution (Writes + Auto-Approval)

- **Status:** Accepted
- **Date:** 2026-07-26
- **Related:** master plan §9 (Permission and Security Model), §4.1 A5, §24.2, `docs/TODOS.md` M5

## Background

The `Loam Desktop.dc.html` v2 design added an Automations screen: automations that self-trigger an Agent task on a
trigger (schedule / event), each with an approval mode.

The master plan's §4.1 A5 contract originally reads "Permission decisions are made entirely in the Main Process; the Renderer is
only responsible for presenting approvals and submitting the user's choice," with the implicit assumption that **a human decides
every elevated operation**. Unattended execution conflicts with that assumption: when a scheduled trigger fires, there is no one
at the keyboard.

Before implementation, this conflict and three possible tiers (manual Run now only / scheduled + read-only / full unattended)
were explicitly explained to the user. The user explicitly chose **full unattended execution (writes + auto-approval)**. This ADR
records that decision, what it gives up, and which non-negotiable bottom lines are preserved.

## Decision

Every automation carries an `approvalMode`, with the following values and semantics:

| mode | Behavior |
|------|------|
| `ask` | Every elevated call waits for a human decision; when unattended, the run **stalls**, and the UI makes this explicit |
| `auto-reads` | Read-only tools are already judged `safe` by the policy engine and auto-allowed; writes/bash still wait for a human → also stalls |
| `read-only` | The scheduler **automatically denies** all approval requests for this run |
| `unattended` | The scheduler **automatically allow-once**s approval requests for this run |

## Bottom Lines Preserved (not relaxed by `unattended`)

1. **The policy engine's `deny` decisions are unaffected.** Protected paths (`.env`, `.git/**`, `~/.ssh/**`,
   etc.), paths escaping the workspace, `git push`, and other external-side-effect operations are already `deny` at the
   policy-engine stage, and **never become approval requests in the first place** — so auto-approval can't see them and can't
   allow them. Auto-approval only ever applies to the class of operations that "would normally ask a human."
2. **Workspace Trust is not bypassed.** The automation checks `project.trusted` before starting; if untrusted, it throws immediately.
3. **Every automatic decision is audited.** `AutomationScheduler.recordAudit` → structured log, including the
   automationId, mode, decision, and summary; the `PermissionPipeline`'s own audit chain is unchanged.
4. **No catch-up on startup.** The scheduler's `start()` does not do catch-up; a crash loop will not repeatedly trigger writes.
   A run only happens when a tick is due, or the user clicks Run now.
5. **Checkpoint semantics are unchanged.** An automation opens an ordinary session/run; pre-write snapshots, conflict
   detection, and Keep/Revert all work as usual, so changes produced unattended **can be precisely reverted**.
6. **The scheduler only starts at all if an enabled automation exists.**

## What Is Given Up

- "A human decides every elevated operation" is no longer globally true. Under `unattended` mode, writes within the
  workspace and bash within the workspace get automatically approved with no one present.
- The risk of `unattended` is therefore equivalent to "handing a CI job's permissions to the model": it can modify your working
  tree, run your tests and builds. It **cannot** touch protected paths, cannot escape the workspace, cannot push.

## Triggers

| trigger | Semantics |
|---------|------|
| `manual` | Only triggerable via Run now |
| `interval` | Every N minutes (minimum 5, maximum 14 days) |
| `daily` | Once a day, at a given local time |
| `event` (`run-completed`) | Fires after a run **you** initiated completes |

The `event` trigger has mandatory recursion protection: when a run started by an automation itself completes, it will
**not** re-trigger `event` automations (`runOrigins` records each run's origin), otherwise two `event` automations could
trigger each other in an infinite loop.

**Missed time slots are not caught up.** A time slot more than 1 hour late is treated as missed and skipped: waking the
machine at noon should not trigger last night's 2am automation.

## Three Defects Fixed During Implementation (2026-07-26)

1. **A failed startup left a stale session claim (security).** `claimSession` is called before `sendMessage`;
   if startup throws without releasing it, that sessionId's claim would leak permanently — after that, **the user's own**
   actions in that session would be automatically adjudicated by this now-dead automation's mode (under `unattended`, that
   means silently approving the user's own writes). The startup-failure path now explicitly releases the claim, with a
   regression test.
2. **`running` was released too early.** It used to be released right after the run *started*, so clicking Run now
   repeatedly, or the next tick, would launch the same automation again. It is now held until the run *finishes*.
3. **Results were never recorded.** `recordRun` only wrote a summary at startup — "Last run" never told you whether it
   succeeded. `handleRunFinished` now writes back `completed / failed / cancelled`.

## Follow-Up

- A better `read-only` implementation would use Pi's `setActiveToolsByName` + `createReadOnlyTools` to withhold write
  tools directly, rather than relying on auto-deny as a backstop (see the same mechanism in the master plan's §24.2 Plan Mode).
- Automation definitions currently live in a Main-private JSON file; migrating to a SQLite `automations` table is §26.2's v6.
- A fixture still needed: `automation-unattended-floor` — asserting that under `unattended` mode, protected paths,
  workspace escapes, and push are still denied and audited.
