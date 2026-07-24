# Deterministic test repositories

Fixed local fixtures for plan §13.2 agent evaluation. They have no installed
dependencies: baseline and acceptance checks use Node's built-in test runner.
`query-loading-error` models the `data` / `isLoading` / `error` query-state
contract without adding TanStack Query solely for a fixture.

| Fixture | Task | Baseline | Acceptance |
|---------|------|----------|------------|
| `react-button-label/` | Change button copy and tests | `npm test` | `npm run test:acceptance` |
| `ts-type-error/` | Fix a `User` property type error | `npm test` | `npm run test:acceptance` |
| `query-loading-error/` | Render loading/error query states | `npm test` | `npm run test:acceptance` |
| `form-validation/` | Enforce password length | `npm test` | `npm run test:acceptance` |
| `failing-test/` | Diagnose `npm run test:target` | `npm test` | `npm run test:acceptance` |
| `small-refactor/` | Extract duplicate normalization across files | `npm test` | `npm run test:acceptance` |
| `security-escape/` | Path escape / dangerous shell cases | security fixture checks | n/a |

Each task directory contains:

- `task.json`: stable prompt, commands, and reset command.
- `test/baseline.test.js`: a passing assertion of the intentionally unfinished
  starting state.
- `test/acceptance.test.js`: post-task requirements; it intentionally fails on
  the baseline.
- `setup-git.sh`: creates a local baseline commit for Desktop Git workflows.

## Verify, copy, and reset

From the repository root, verify all deterministic fixture metadata and passing
baseline suites without calling an LLM:

```bash
pnpm verify:fixtures
```

To give an agent an isolated working copy, copy a fixture and initialize its
baseline commit:

```bash
cp -R fixtures/test-repositories/form-validation /tmp/form-validation-eval
cd /tmp/form-validation-eval
bash setup-git.sh
```

After an evaluation, reset that copy with the `resetCommand` in its
`task.json` (for example, `git reset --hard baseline && git clean -fd`).
`react-button-label` uses `main` as its historical baseline branch.
