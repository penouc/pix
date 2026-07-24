# Fixture: react-button-label

Fixed evaluation task from plan §13.2:

> 修改一个按钮文案并更新测试。

## Baseline

- `PRIMARY_LABEL` and default prop are `'Submit'`
- `pnpm test` / `npm test` should **pass** on baseline

## Agent task prompt

```text
In this project, rename the primary button label from "Submit" to "Continue".
Update src/Button.jsx (default prop + PRIMARY_LABEL) and any tests so `npm test` passes.
Do not change unrelated files.
```

## Acceptance

1. Source uses `Continue` for the primary label.
2. `npm test` exits 0.
3. No unrelated refactors.

## Open in Pi Desktop

Use the absolute path of this directory as the project path.
