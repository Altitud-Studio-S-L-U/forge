# Contributing

Use Node.js 24. The project has no npm dependencies and requires no install
step to run its local tests:

```sh
node --test test/*.test.mjs
node src/cli.mjs --help
```

Read the README's scope and trust model before changing file, process or
provider boundaries. Work on a `feat/`, `fix/` or `hotfix/` branch and submit a
pull request to `main`. Keep model/provider input separate from executable
arguments, and retain the bounded repair and explicit verification contracts.

For a correctness fix, add a regression that fails on the previous behavior
when practical. Exercise observable behavior through the real boundary; use
synthetic fixtures for credentials, repository contents and CLI responses.
Do not weaken existing tests or claim live provider validation from doubles.
Platform-specific process changes need Windows and POSIX validation; the CI
workflow runs the tests on Linux, macOS and Windows for every pull request.

Include the problem, resulting behavior, checks actually run and remaining
limits in the PR. Keep logs, run evidence, credentials and downloaded tools
outside Git. Do not include another person's source code in examples.
