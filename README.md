# AgentUnison

**Make every coding agent agree on your repository.**

One repository is worked on by many coding agents — Claude Code, Codex, OpenCode, Copilot,
Cursor, Gemini CLI — and each one grew its own instruction system: `CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`, `.claude/skills`, `.agents/skills`, `.claude/commands`, per-tool agents, settings.
They start as copies and end as forks. AgentUnison inspects what is there, audits it,
converges it to one canonical architecture without destroying anything, projects it into the
form each harness actually reads, verifies real harness behavior, and keeps it from drifting.

```
inspect → audit → plan (dry run) → approve what matters → apply → verify → protect
```

It is not a sync tool. Copying and symlinking are two of five projection mechanisms, chosen
per harness and platform from a versioned, evidence-tagged capability matrix.

## Quick start

```bash
cd your-repo
npx agentunison init            # fresh repo: done in one step
                                 # existing setup: audit + plan printed; safe actions applied;
                                 # changes to existing files wait for --approve
npx agentunison apply --approve all     # or --approve "MOVE:.agents/skills/x,QUARANTINE:…"
npx agentunison verify --live           # structural check + real probes of installed harnesses
```

Add `agentunison verify` to CI. It exits non-zero on drift.

## What you get

| Path | Role |
|---|---|
| `AGENTS.md` | canonical instructions — read natively by Codex, OpenCode, Copilot, Cursor; imported by Claude Code (and Gemini, opt-in) through a shim |
| `.agents/skills/<name>/SKILL.md` | canonical skills (Agent Skills spec) — read natively by Codex, OpenCode, Copilot, Cursor, Gemini |
| `CLAUDE.md` | a pinned 3-line shim (`@AGENTS.md` + note). Claude-only text can live in a marked harness-specific section |
| `.claude/skills` | links to the canonical skills (whole-dir link when empty, per-skill links otherwise, managed copies where symlinks are unavailable) |
| `.claude/agents`, `.codex/`, `.opencode/agents`, settings, hooks, rules | **preserved**: inventoried and audited, never converged |
| `agentunison.yaml` | intent: targets, canonical paths, policy, recorded approvals |
| `.agentunison/ledger.yaml` | committed ownership ledger: every managed path, mechanism, hash/target |
| `.agentunison/local/` | machine-local (self-ignored): platform probe, fallbacks used, write-ahead journal, quarantine |

## Safety model

- **Plan first.** Every action carries preconditions (hashes, path types) captured at plan time;
  `apply` re-checks all of them before writing anything and refuses the whole run on a mismatch. <!-- test:safety.test.ts+resume.test.ts -->
- **Never destroy.** Displaced content is quarantined under `.agentunison/local/quarantine/<ts>/`
  with a manifest. `DELETE` never appears in a plan unless you ask (`--allow-delete`). <!-- test:safety.test.ts rollback -->
- **Own only what you create.** The ledger is the boundary. Foreign files (other tools' markers,
  plugin caches, vendored skill trees) are listed and left alone. <!-- test:safety.test.ts foreign+vendored -->
- **Approval for anything that changes an existing file** (`MOVE`, `MODIFY`, `ADOPT`,
  `QUARANTINE`, `REPAIR`, `BACKPORT`). Approvals are recorded so re-runs do not re-ask. <!-- test:resume.test.ts T-14 -->
- **Exact-match merges only.** When `CLAUDE.md` and `AGENTS.md` diverge, shared paragraphs are
  byte-equal after whitespace normalization; paragraphs only in `CLAUDE.md` are adopted into
  `AGENTS.md` under a review heading or kept as Claude-specific — your call, per paragraph. <!-- test:safety.test.ts exact-match -->
- **Loud fallbacks.** If a symlink cannot be made, a copy is made, recorded as a copy, and reported. <!-- test:safety.test.ts symlink -->
- **Rollback.** A failure mid-apply reverses the completed operations; a write-ahead journal
  records every step. <!-- test:safety.test.ts rollback -->
- **Idempotent.** A second `apply` is a byte-identical no-op. <!-- test:clean.test.ts -->

## Commands

| Command | Purpose |
|---|---|
| `init` | detect harnesses, write intent, converge (plans first; approvals for existing files) |
| `inspect` | inventory of every harness surface, classified with evidence |
| `audit` | findings: divergent instruction files, duplicate/conflicting skills, legacy commands, stale paths, budgets, spec violations |
| `plan` | the dry run — every action with risk class, reason, and the matrix evidence it relied on |
| `apply` | execute the plan (`--approve`, `--allow-delete`, `--plan <file>`) |
| `verify` | ledger + invariants; `--live` runs real probes (`codex debug prompt-input`, `opencode debug skill`, Claude debug log with `--allow-api-calls`) |
| `doctor` | installed harnesses and versions vs the verified matrix, platform symlink probe |
| `uninstall` | leave every harness working (links materialized, shims reduced), remove what is managed; canonical content is never removed |

`--json` on every command emits the same objects (schema 1) for agents to consume.

## Capability matrix

`matrix/<harness>.yaml` holds every compatibility fact the tool relies on, each with an
evidence class (`doc` · `bin` · `test`), the date it was checked, and the platforms it was
verified on. Unknown facts take the conservative branch. `doctor` warns when an installed
version differs from the versions the matrix was verified against.

## Status

v0.1 — MVP. Verified end to end against Claude Code 2.1.x, Codex CLI 0.144, OpenCode 1.18 on
macOS; Copilot/Cursor/Gemini have matrix entries and structural projections (Gemini opt-in).
Windows paths (junction/copy fallbacks, CRLF hashing) are implemented and exercised through
policy overrides in tests; native Windows CI runs in GitHub Actions.

Working on it: `docs/TASKS.md` (task board: goal → steps → acceptance → validate → verify),
`docs/VERIFICATION.md` (every claim → command → expected result), `CONTRIBUTING.md`.
Design records: `dev_docs/2026-09-04/` (research with sources and revisions, architecture,
CLI/YAML design, migration safety, validation strategy, independent design review).

MIT.
