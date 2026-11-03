# Security

Forge is experimental local orchestration tooling. It is not an operating
system sandbox and does not make a model-generated change trustworthy.

The operator trusts the installed provider CLIs, their authentication stores,
the OS account, Git configuration, executable search path and verification
command. Selected source and the task are disclosed to both configured
providers. Review that disclosure before running Forge. Credential-pattern
screening is incomplete; it does not replace secret management.

Use a dedicated checkout. Source hashes and Git checkpoints detect observed
changes, but cannot prevent another process from changing and restoring files
between checks. Verification commands can have ordinary local side effects.
There is no multi-file transaction or automatic rollback; inspect the diff
after any failure, cancellation or partial write.

Report a suspected vulnerability confidentially to **info@altitudstudio.ad**.
Include a minimal synthetic reproduction, the Forge revision, OS, Node and
provider CLI versions. Do not send tokens, account exports, private source or
raw provider session logs. Avoid public issues for undisclosed vulnerabilities.
Support focuses on the current default branch; no response-time guarantee is
offered.
