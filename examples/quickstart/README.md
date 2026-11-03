# First run: fix a small function

This synthetic example starts with `sum(a, b)` subtracting its operands. It creates a fresh temporary Git repository on `fix/addition`, commits the failing baseline locally, and keeps its task and evidence outside that repository. Your project and Git configuration are not changed. The deliberate failure is an input fixture, not part of Forge's test suite.

## Prepare without provider access

Install Node 24 and Git, clone Forge, and run from its root:

```sh
node examples/quickstart/run.mjs --prepare
```

Expected: `Baseline: failed as expected` and `Preparation complete; no provider was called`. Each invocation creates a separate directory under your OS temporary directory and prints its location. Files remain there for inspection; remove only that printed example directory when finished.

## Run with both providers

Install and authenticate Codex CLI and Claude Code in the usual way. Record the versions with `node --version`, `git --version`, `codex --version` and `claude --version`; see the [compatibility reference](../../README.md#cli-compatibility).

```sh
node examples/quickstart/run.mjs --live
```

This uses your existing provider accounts and their usage limits. Only the synthetic `sum.mjs` and task are sent. Codex proposes a replacement; Forge runs the unchanged Node test; Claude independently reviews the actual change and test outcome. No provider double is used by this command.

Expected on success:

- A result with `status: "ready-for-human-review"` and a passed check.
- A diff replacing subtraction with addition in `sum.mjs`.
- `Verified: tests pass, test file unchanged, only sum.mjs changed, nothing staged or committed.`

The script verifies those invariants and exits nonzero on failure. The printed `result` path contains Forge's evidence. Inspect the diff yourself: a model verdict is not proof. The same source, task and tests are used each time; provider responses, model defaults, latency and review verdicts can vary.

If the result is blocked, check the bounded error code, installed CLI versions and normal CLI sign-in outside Forge. Unknown response formats fail closed. Authentication problems, account limits or timeouts are failures, not successful demo outcomes. There is no automatic retry and nothing is pushed or published.
