# Acceptance Tests

Source of truth for eval tasks: plan §13.2 / §19.

## Fixture: react-button-label

Path: `fixtures/test-repositories/react-button-label`

### Setup

```bash
./fixtures/test-repositories/react-button-label/setup-git.sh
pnpm test:fixture   # baseline must pass (Submit)
```

### Agent prompt

```text
In this project, rename the primary button label from "Submit" to "Continue".
Update src/Button.jsx (default prop + PRIMARY_LABEL) and any tests so `npm test` passes.
Do not change unrelated files.
```

### Pass criteria

1. `src/Button.jsx` uses `Continue` for primary label / default prop.
2. Baseline tests updated or acceptance suite green:
   ```bash
   cd fixtures/test-repositories/react-button-label
   ACCEPTANCE=1 npm run test:acceptance
   ```
3. No unrelated file churn.

### Desktop path

1. Export a provider key (`OPENAI_API_KEY` / …).
2. `pnpm dev` → Browse to fixture path → New session.
3. Paste agent prompt → verify tools + stream → run acceptance.

## Packaged smoke

```bash
pnpm package:dir
node scripts/smoke-packaged.mjs
```

Checks app bundle, main binary, and asar contents (main/preload/renderer + Pi deps).
