# Forge

[![Node.js 24](https://img.shields.io/badge/Node.js-24-43853d?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime_dependencies-0-245b78)](package.json)
[![Security policy](https://img.shields.io/badge/security-policy-44546a)](SECURITY.md)

```text
  _____ ___  ____   ____ _____
 |  ___/ _ \|  _ \ / ___| ____|
 | |_ | | | | |_) | |  _|  _|
 |  _|| |_| |  _ <| |_| | |___
 |_|   \___/|_| \_\\____|_____|

 explicit context -> proposal -> check -> independent review
```

Forge coordinates an installed Codex CLI and Claude Code CLI using their existing local authentication. It runs on Node 24 without npm dependencies. One provider proposes a bounded code change and the other independently reviews it; their roles are interchangeable. Nothing commits, pushes, merges or deploys.

Developer tooling by [Altitud Studio](https://altitudstudio.ad). The package is not published to npm. Use a Git checkout with both provider CLIs installed and already authenticated; provider usage is subject to those accounts' limits. A passing model review is an opinion, not proof of correctness.

## Run

Start with the [executable quickstart](examples/quickstart/README.md): prepare a failing synthetic project without provider access, then run a real Codex proposal and Claude review. It checks the resulting diff, unchanged test and uncommitted state. For a fixed source snapshot, use the [versioned releases](https://github.com/Altitud-Studio-S-L-U/forge/releases).

Read the target repository's instructions first. Put the task and evidence outside Git checkouts, then select the exact UTF-8 files to disclose. A selected path may be a new file. Each file is limited to 64 KiB, the complete captured context to 256 KiB, and a run to twelve files. Credential files, private-key formats, links and common credential-like content are rejected. Selected source is sent to the two providers through their CLIs; do not include secrets or unrelated private information.

```sh
node /absolute/forge/src/cli.mjs --help

node /absolute/forge/src/cli.mjs research \
  --repo /absolute/project --task-file /private/task.txt \
  --file src/example.js --output /private/evidence

node /absolute/forge/src/cli.mjs review \
  --repo /absolute/project --task-file /private/task.txt \
  --file src/example.js --reviewer claude --output /private/evidence

node /absolute/forge/src/cli.mjs implement \
  --repo /absolute/project --task-file /private/task.txt \
  --file src/example.js --coder claude --reviewer codex \
  --verify-json '["node","--test","test/example.test.js"]' \
  --output /private/evidence
```

`--verify-json` is one executable/argv array, executed directly without a shell. The operator supplies it; no model response can choose a command. Use an absolute executable when PATH is unsuitable. Shell interpreters are rejected. Verification commands execute in the target checkout and can have the normal side effects of its test/build tools; only run commands and repositories you trust. The task is not an authorization to publish changes externally.

`research` runs both providers concurrently with complementary local-analysis questions. It preserves their individual responses and disagreements; it does not perform live web research. `review` assesses the selected current files against the task. It does not implicitly include the entire repository, Git history or an unprovided diff; select tests, contracts and related files when relevant.

`implement` requires a clean checkout on a `feat/`, `fix/` or `hotfix/` branch. Both agents run with tools disabled in separate external working directories and receive captured files over stdin. The implementer returns complete replacement contents and the exact supplied precondition hashes. Forge validates these, checks the checkout and applies only selected paths. It executes the operator's check, then asks the other provider to review the exact before/after contents and actual check outcome. One repair is permitted, followed by another check and final independent review. Changes remain uncommitted, including when verification or review fails.

At implementation checkpoints, staged changes and non-ignored changes outside the selected files block the run. This includes an unselected test changed by a concurrent process or the verification command. Git-ignored build outputs are not monitored. These are checkpoint checks, not continuous filesystem isolation; use a dedicated checkout and inspect its full diff before committing.

## Architecture

The orchestration is a bounded state machine: proposal, check, review, optionally one repair/check/review, then a result. Provider-specific process arguments and decoding stay behind one adapter function. The core does not import a provider SDK or obtain credentials itself.

| Module | Responsibility |
| --- | --- |
| `src/cli.mjs` | Parse operator input, propagate cancellation and map results to exit codes. |
| `src/forge.mjs` | Coordinate phases, verification and the evidence report. |
| `src/providers.mjs` | Resolve installed executables and validate each CLI's response protocol. |
| `src/contracts.mjs` | Validate the closed response schemas and screen common credential patterns. |
| `src/files.mjs` | Capture bounded UTF-8 context and apply hash-bound file replacements. |
| `src/git.mjs` | Enforce branch, HEAD, clean-start and implementation scope preconditions. |
| `src/process.mjs` | Run explicit argv, bound output/deadlines and terminate owned child trees. |

The workflow accepts a provider function and process runner at its integration boundary. Tests can substitute responses while still using real Git repositories, file replacements and verification processes. There is no plugin registry, background service or persistent work queue.

## Results and process limits

Every run creates a new private-mode directory under `--output` (the OS temporary directory by default) and writes `result.json`. It records context hashes, provider results, check exit status, changed files and bounded error codes. It omits raw provider stdout/stderr, replacement source and task text. Codex's temporary final-answer file is removed after decoding. CLI-native authentication and session storage remain managed by those CLIs; Forge does not modify or inspect their credentials.

| Status | Meaning | Exit |
| --- | --- | --- |
| `research-complete` | Both local research responses completed. | 0 |
| `review-complete` | Independent review passed; no test or approval is implied. | 0 |
| `ready-for-human-review` | Implementation check exited successfully and final independent review passed. | 0 |
| `needs-verification` | Review passed but no independent check command was supplied. | 1 |
| `findings` | Review or verification still failed after at most one repair. | 1 |
| `blocked` | Provider, schema, permission, timeout, cancellation or checkout precondition failed. | 2 |

The per-process deadline defaults to 120 seconds (maximum 300); the workflow deadline defaults to 480 seconds (maximum 900). SIGINT/SIGTERM cancel the run. Output is capped across stdout and stderr; stderr is counted without being retained. Cancellation/deadline kills the owned process tree through Windows `taskkill /T /F` or a POSIX process group. A model verdict never overrides a nonzero exit, a denied permission, invalid/truncated JSON or failed verification. No automatic retry is added to provider calls.

Set `--codex-model` or `--claude-model` for an explicit model; otherwise the CLI default applies. `FORGE_CODEX_EXECUTABLE` and `FORGE_CLAUDE_EXECUTABLE` accept absolute `.exe` or JavaScript entrypoints. Default discovery uses PATH. On Windows, official npm wrappers resolve to their JavaScript entrypoint and run through the same Node executable; Forge never shell-interpolates prompts. Existing local credential stores are used. API-key/token environment variables are intentionally not forwarded; no new credentials are requested. External CLI hooks/MCP configuration are disabled for these bounded calls.

This is a cooperation harness, not an operating-system security boundary. Codex retains its read-only sandbox as an additional control; both agents are instructed to return data without tools, and unexpected Codex tool operations fail the run. The native CLIs, OS account, PATH executables, Git configuration and operator-selected verification command remain trusted. Credential screening cannot identify every possible secret. File replacements are individually atomic and preserve existing executable mode on POSIX; a multi-file change is not one filesystem transaction. Another process with access to the same checkout can race filesystem operations. Inspect the resulting diff and reported conflicts before committing.

Codex responses must include a started and completed turn. Unknown event/item types block the run instead of being treated as successful output. Only reasoning, agent messages and task-list items are admitted; this intentionally favors detection of incompatible CLI changes over silent compatibility. An exit-zero process and a plausible answer file alone are insufficient.

## Skills and local plugin

`skills/forge/SKILL.md` is shared instruction material for Codex and Claude Code. Claude can load this checkout for a single session without global installation:

```sh
claude --plugin-dir /absolute/forge
```

The `.claude-plugin/plugin.json` manifest exposes the local plugin. Loading a skill/plugin does not broaden permissions or authorize a deployment. No global configuration is changed by Forge.

## Validation

```sh
node --test test/*.test.mjs
claude plugin validate /absolute/forge
```

The tests exercise real child-process exits, split UTF-8, output limits, cancellation and descendant termination; real temporary Git repositories and Node tests verify scope, clean-branch restrictions, stale hashes, concurrent changes and bounded repair. Provider doubles cover failure contracts and do not establish real account/model access.

Adapter tests execute synthetic CLI processes through the real adapters, including argument handling, stdin, incomplete Codex streams, unknown tool operations and raw-answer cleanup. POSIX executable-link discovery is exercised on Linux; it is explicitly skipped on Windows because it describes POSIX npm installations. No account tokens or live project source are needed by the test suite.

Provider integration follows the installed CLI help and official [Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode) and [Claude Code CLI](https://code.claude.com/docs/en/cli-reference) contracts. Model availability, native CLI formats and permissions can change; test the installed versions before relying on a different release.

## CLI compatibility

The adapter checks concrete CLI flags and response schemas. Use the [manual quickstart](examples/quickstart/README.md) to check your installed pair before adopting it; a version outside this table is unverified, not automatically compatible or incompatible.

| Environment | Codex CLI | Claude Code | Checked integration |
| --- | --- | --- | --- |
| Windows, Node 24.11.1 | `0.166.0-alpha.5.1` | `2.0.59` | `--live`: Codex implementation, Node verification, Claude review; unchanged test and HEAD, one unstaged source change. |

This reference was checked on 2026-11-03 with the providers' configured default models. It does not establish compatibility with other CLI versions, account permissions, models or operating systems. The Codex build above is a pre-release CLI; record the exact version instead of relying on `latest`. The automated suite separately checks provider contracts with doubles and does not need provider accounts.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for local checks and [SECURITY.md](SECURITY.md) for the trust model and confidential reporting. Submit changes through pull requests. Releases and validation are manual; the repository has no CI/CD workflow.

[MIT license](LICENSE), copyright 2026 Altitud Studio S.L.U.
