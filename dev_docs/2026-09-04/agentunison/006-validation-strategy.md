# 006 — Validation strategy

Validation has three layers. Each answers a different question, and the report never
lets one stand in for another.

| Layer | Question | Mechanism | Gates CI? |
|---|---|---|---|
| **Structural** (`verify`) | Does the repository match what the ledger and manifest say, and does it satisfy the architecture invariants? | filesystem + hashes + frontmatter parsing | yes (exit 4/5) |
| **Behavioral** (`verify --live`) | Does each *installed* harness actually see the canonical instructions and skills? | real CLI probes from the matrix, with timeouts | optional (exit 6); skipped loudly when a binary is absent |
| **Self-tests** (`npm test`) | Does AgentUnison itself behave: idempotency, safety, fallbacks, migrations, tamper detection? | fixtures + unit tests; opt-in live suite | yes for the product repo |

## 1. Structural checks (`verify`)

For each ledger entry: exists; type matches mechanism (symlink vs file vs dir); symlink
target equals the recorded relative target and resolves inside the repo; copy/generated
hash equals recorded hash (and, for generated, source hash unchanged — else "stale
adapter, run `apply`"); shim managed part byte-equal (harness-specific section excluded
and line-counted against a budget).

Architecture invariants: exactly one root instruction canonical; for each targeted
harness the projection required by policy exists; no non-shim `CLAUDE.md`/`GEMINI.md`
when those are targets; no duplicate skill `name` across `.agents/skills` and any native
skills dir; every `.agents/skills/*/SKILL.md` passes the Agent Skills spec (name = dir,
regex, lengths, description present, ≤ 500 lines) — non-portable extra fields are
*warnings*; managed blocks present exactly once with intact markers; ledger sorted and
schema-valid; no ledgered path is also foreign-owned (co-ownership marker detection for
other tools' banners).

Exit codes: 0 clean · 4 drift (ledger/filesystem mismatch or invariant violation) · 5
managed block damaged (markers broken) — distinct because it usually means a human or
agent edited the block.

## 2. Audit rules (`audit`) — deterministic, evidence-carrying

| Id | Rule | Severity |
|---|---|---|
| A01 | Multiple root instruction files with non-shim content (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`/copilot-instructions); report pairwise paragraph similarity | high |
| A02 | Root instruction file exceeds the harness line/byte budget (matrix) | medium |
| A03 | Instruction text references paths that do not exist in the repo | medium |
| A04 | Skill trees in more than one location; per-name identical / differing hashes | high |
| A05 | Skill frontmatter: spec violations (blocking) / non-portable fields (degraded) / description lacking trigger vocabulary ("use when", verbs) (info) | varies |
| A06 | Legacy surfaces present (`.claude/commands`, `.cursorrules`, `.opencode/agent` singular) | medium |
| A07 | Agents with the same name across harness dirs; body similarity ≥ 0.8 → adapter candidate | info |
| A08 | Agent body ≈ skill body (≥ 0.8) → "why not a skill?" question | info |
| A09 | Generic-template signals in agents/skills: opens with "You are a…", ≥ 4 of the known boilerplate headings, no repo identifiers (paths/commands present in the repo) | info |
| A10 | Instruction file contains the same paragraph twice or a paragraph also present in a skill | low |
| A11 | Symlink-hostile signals: ledgered symlink materialized as file; `core.symlinks=false` | high |
| A12 | Foreign managed markers (other tools) inside harness dirs → co-ownership warning | medium |
| A13 | Vendored skill trees detected (lock file / plugin cache) → excluded, informational | info |

Each finding carries `evidence` (paths, line numbers, similarity scores) and, where a
plan action follows, the action id. The "delete test" and "why not the main agent?"
questions are emitted as structured `questions` attached to findings for a human or agent
to answer; the tool never answers them itself.

## 3. Behavioral probes (`verify --live`), from the matrix

| Harness | Probe | Assertion | Notes |
|---|---|---|---|
| Codex | `codex debug prompt-input "<nonce>"` | composed prompt contains a nonce line from `AGENTS.md`'s managed block and each `.agents/skills/*/SKILL.md` path | no model call; cheap; timeout 60 s |
| OpenCode | `opencode debug skill`, `opencode agent list` | each canonical skill name appears once (project location); generated agents listed | no model call; **must** run under a timeout (observed hang) |
| Claude Code | `claude -p --model haiku --debug-file <f> "<prompt>"` | debug log `Loading skills from … project=[<.claude/skills>]` and `project: N` equals the canonical count; optional model answer includes the nonce | one API call; opt-in (`--live` prints the cost class before running) |
| Copilot CLI | `copilot skill list` | canonical skills listed | structural for instructions (no dump available) |
| Gemini CLI | `gemini skills list --all` | canonical skills listed | structural for instructions |
| Cursor | — | structural only (no documented listing) | reported as such |

The nonce is a stable line inside the `AGENTS.md` managed block (`agentunison: <hash8>`),
so probes need no model reasoning to succeed. Results per harness are one of
`verified | structural-only | not-installed | failed`, with the raw evidence saved to
`.agentunison/verify/<harness>.log` (gitignored).

## 4. Self-test matrix (product repository)

| Suite | What it proves | Fixtures |
|---|---|---|
| unit | frontmatter parser, similarity, relative-link math, cycle detection, matrix schema, plan risk classification, YAML doc editing preserves comments | none |
| fixture: clean | `init` on an empty git repo produces the documented tree; second run is a no-op (byte-identical tree + ledger) | `fixtures/clean` |
| fixture: messy-legacy | the v1 success criterion: `CLAUDE.md`+`AGENTS.md` differing, `.claude/skills` real dir with 2 skills (one duplicated in `.agents/skills`, one conflicting), `.claude/commands/x.md`, `.claude/agents/*`, `.codex/config.toml`, `.opencode/agents/*`, `.cursorrules`, stale path references → expected inventory, findings, plan; apply with approvals → expected tree, ledger, quarantine; verify clean | `fixtures/messy-legacy` |
| fixture: real-repo | a snapshot of the converged previous repository's harness files (`AGENTS.md`, shim, `.agents/skills`, `.claude/agents`) → inventory recognizes it as already converged with an unmanaged (pre-existing) shim and symlink → plan = adopt-as-managed only | `fixtures/real-repo-converged` (files copied from git history, no live dependency on the frozen repo) |
| idempotency | for every fixture: apply twice → identical | all |
| dry-run | `plan` never writes (tree hash before == after) | all |
| collision | native skill same-name identical → quarantine; differing → conflict, no action without choice | messy-legacy |
| tamper | after apply: append text to the shim; replace the symlink with a dir; edit a generated adapter; break a managed block; add a duplicate skill in `.claude/skills` → `verify` exits 4/5 with the exact path | clean, messy-legacy |
| rollback | kill-switch fault injection mid-apply → journal reverse restores tree; `uninstall` after apply restores quarantined items and removes only ledgered paths | messy-legacy |
| symlink / no-symlink | `policy.symlinks: never` → copies with hashes; probe failure simulation → junction/copy fallback recorded, never "linked" | clean |
| live (opt-in, `AGENTUNISON_LIVE=1`) | runs the behavioral probes against installed harnesses on the clean fixture; skipped loudly otherwise | clean |

The messy-legacy fixture is checked in as plain files plus a small script that creates
the symlinks at test time (so the product repo itself has no committed symlinks that
break on Windows checkouts).
