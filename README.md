# Forge

[![CI](https://github.com/Altitud-Studio-S-L-U/forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Altitud-Studio-S-L-U/forge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Altitud-Studio-S-L-U/forge/actions/workflows/codeql.yml/badge.svg)](https://github.com/Altitud-Studio-S-L-U/forge/actions/workflows/codeql.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-43853d?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime_dependencies-0-245b78)](package.json)
[![Security policy](https://img.shields.io/badge/security-policy-44546a)](SECURITY.md)

**Propose a code change, run your checks, and have a second coding agent review the result.**

Forge coordinates an installed Codex CLI and Claude Code CLI using their existing local authentication. It runs on Node 24 without npm dependencies. One provider proposes a bounded code change and the other independently reviews it; their roles are interchangeable. Nothing commits, pushes, merges or deploys.

Developer tooling by [Altitud Studio](https://altitudstudio.ad). The package is not published to npm. Use a Git checkout with both provider CLIs installed and already authenticated; provider usage is subject to those accounts' limits. A passing model review is an opinion, not proof of correctness.

## See the workflow

The included synthetic example starts with `sum(a, b)` subtracting its operands. A successful live run changes that function, passes the unchanged test and leaves the change uncommitted for review.

```text
Selected files + task → Codex or Claude proposal → your check command
                     → the other provider reviews → uncommitted diff + result.json
```

Try the fixture without calling either provider:

```sh
git clone https://github.com/Altitud-Studio-S-L-U/forge.git
cd forge
node examples/quickstart/run.mjs --prepare
```

Requires **Node.js 24 and Git**. Expected: `Baseline: failed as expected` and `Preparation complete; no provider was called`. The [full walkthrough](examples/quickstart/README.md) explains the temporary files and the optional `--live` run, which uses your authenticated provider accounts and their usage limits.

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

Forge captures selected files, obtains a proposal, applies hash-bound replacements, runs your check and requests independent review. At most one repair is attempted. See the [module map](docs/operation.md#architecture).

## Results and process limits

Each run writes `result.json`. Exit `0` means the requested workflow completed; implementation without a check, findings and blocked runs have distinct nonzero outcomes. Changes remain uncommitted even when a check or review fails.

Forge is not an OS security boundary: the installed CLIs, selected check command, Git configuration and OS account remain trusted. File replacements are individually atomic, not a multi-file transaction. Read the [status table and process limits](docs/operation.md#results-and-process-limits) before using it on a project.

## Skills and local plugin

Instruction material and an optional local Claude plugin are included. See [local plugin setup](docs/operation.md#skills-and-local-plugin); loading either does not broaden permissions.

## Validation

The suite exercises real processes and temporary Git repositories, with provider doubles for CLI contracts. See [test commands and coverage limits](docs/operation.md#validation). Live provider compatibility is checked separately.

## CLI compatibility

The recorded live reference uses Windows, Node 24.11.1, Codex CLI `0.166.0-alpha.5.1` and Claude Code `2.0.59`. Other combinations are unverified. See the [dated compatibility reference](docs/operation.md#cli-compatibility) and run the quickstart with your installed pair.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for local checks and [SECURITY.md](SECURITY.md) for the trust model and confidential reporting. Submit changes through pull requests. Every pull request runs the tests on Linux, macOS and Windows and a CodeQL scan; these use test doubles, so live provider runs remain manual, as do releases.

[MIT license](LICENSE), copyright 2026 Altitud Studio S.L.U.
