# Acceptance Tests

Source of truth for eval tasks: plan §13.2 / §19.

## M0 deterministic fixture health

The complete non-LLM fixture matrix is documented in
[`fixtures/test-repositories/README.md`](../fixtures/test-repositories/README.md).
Run this before an agent evaluation to verify task metadata and all passing
baseline suites:

```bash
pnpm verify:fixtures
```

Each fixture's `task.json` contains the exact prompt, baseline command,
acceptance command, and Git reset command. Copy a fixture before a run, invoke
`bash setup-git.sh`, then use that metadata rather than changing the tracked
baseline fixture.

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

1. Prefer OpenCode Go login (`~/.local/share/opencode/auth.json`) or `OPENCODE_API_KEY`.
2. `pnpm dev` → Browse to fixture path → Trust workspace → New session → select `opencode-go/*` model.
3. Paste agent prompt → verify tools + stream → run acceptance.

### Headless path (CI / automated)

```bash
pnpm eval:fixture
# optional: EVAL_MODEL=opencode-go/glm-5.2 pnpm eval:fixture
```

## Packaged smoke

```bash
pnpm package:dir
node scripts/smoke-packaged.mjs
```

Checks app bundle, main binary, and asar contents (main/preload/renderer + Pi deps).
