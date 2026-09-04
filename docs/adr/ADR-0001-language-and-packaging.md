# ADR-0001 — Implementation language and packaging

**Status:** Accepted · **Date:** 2026-09-04

## Context

AgentUnison is a repository-scoped CLI that must: run wherever coding-agent harnesses
run (macOS, Linux, Windows); create relative symlinks and junctions and detect when they
are unavailable; read/write YAML preserving comments; parse Markdown frontmatter, TOML
(Codex agents/config, read-only in v1) and JSON; spawn harness binaries with timeouts;
ship as a single easy install (`npx agentunison init` is the target experience); and be
testable with fixtures, including idempotency and tamper tests.

Candidates evaluated against those needs (research in `dev_docs/2026-09-04/research/`):

| Criterion | TypeScript / Node | Go | Rust |
|---|---|---|---|
| Install experience for this audience | `npx agentunison` works on every machine that runs Codex (npm), Copilot CLI (npm), Gemini CLI (npm), Claude Code (npm/native); no extra runtime to explain | single static binary; needs a download/brew/`go install` step; no `npx`-style zero-install | same as Go |
| Cross-platform symlinks | `fs.symlink(target, path, 'junction'|'dir'|'file')`, `lstat`, `readlink`, `realpath` — all built in; Windows junction type explicit | excellent (`os.Symlink`, Windows needs privilege or junction via syscall) | excellent |
| YAML with comment preservation | `yaml` package: Document API edits in place, keeps comments/order (FleetSmith's `patch` proves it) | `gopkg.in/yaml.v3` node API works but is clumsy for round-trips | `serde_yaml` drops comments; alternatives immature |
| Filesystem safety / atomic writes | temp + rename via `fs.promises`; adequate | strong | strong |
| CLI UX | `node:util.parseArgs` built in (no dependency); colors via ANSI codes | cobra ecosystem | clap |
| Distribution | npm registry + optional Node SEA single binary (FleetSmith ships both, with a smoke-tested artefact) | goreleaser binaries | cargo-dist |
| Testing | `node --test` built in; Node ≥ 22.18 runs `.ts` directly (type stripping) so tests need no transpile step | `go test` | `cargo test` |
| Harness adapters / ecosystem fit | the harness tools, the Agent Skills reference validator's peers, FleetSmith, agent-sync, agents-skills-sync are all JS/TS; contributors overlap | fine | fine |
| Dependency footprint | one runtime dependency (`yaml`) | zero | zero |

Prior art: FleetSmith (Node ESM, one dep, SEA binary) demonstrates the exact packaging
path; agents-skills-sync (Deno compiled binary) shows the friction of a non-npm runtime for
this audience; hana (Rust) is Unix-only in practice despite the language's capability.

## Decision

**TypeScript on Node.js**, ESM, strict, restricted to erasable syntax (no enums,
namespaces, or parameter properties) so that:

- development and tests run directly with `node --test` on Node ≥ 22.18 (native type
  stripping), no transpiler in the test loop;
- `tsc` emits `dist/` for publishing, and the published package supports Node ≥ 20;
- the only runtime dependency is `yaml`; argument parsing uses `node:util.parseArgs`;
- a Node SEA single binary is a later distribution channel, not an MVP requirement.

## Consequences

- `npx agentunison init` is the one-command experience; `npm i -g agentunison` for daily use.
- Windows support is implemented in code (junction/copy fallbacks) and tested through
  policy overrides and probe simulation; native Windows CI is a follow-up.
- Performance is not a concern at this scale (thousands of files, not millions).
- Rejected: Go (no zero-install path for the target audience; YAML round-trip friction),
  Rust (same, plus comment-preserving YAML immaturity). Both remain viable if the tool
  ever needs to be embedded in environments without Node.

## Amendments (post-review, see dev_docs/2026-09-04/agentunison/008)
- Type-stripping constraints made explicit: relative imports carry `.ts` extensions in source;
  `tsconfig` sets `allowImportingTsExtensions`, `rewriteRelativeImportExtensions` (TS ≥ 5.7),
  `erasableSyntaxOnly` (TS ≥ 5.8), `verbatimModuleSyntax`; tests run with
  `node --disable-warning=ExperimentalWarning --test "test/**/*.test.ts"` (explicit glob).
- `yaml`: `lineWidth: 0`; block style for maps; ledger via plain sorted `stringify`.
- Every child process uses `AbortSignal.timeout`; binary detection uses `where` on win32.
- CI: `ubuntu-latest`, `macos-latest`, `windows-latest` (junction / copy / CRLF paths cannot be
  exercised by policy overrides alone).
