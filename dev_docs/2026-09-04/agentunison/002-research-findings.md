# 002 — Research findings that shape the design

Sources: `../research/*.md` (per-project reports, harness docs, comparison, links). This
document keeps only the findings that changed a design decision, and states the decision.

## A. Harness behavior (verified 2026-09-04; version-sensitive)

| Finding | Evidence | Decision |
|---|---|---|
| `AGENTS.md` is read natively by Codex, OpenCode, Copilot (cloud/CLI/VS Code root), Cursor; not by Claude Code (`@AGENTS.md` import or symlink is the official interop) nor Gemini CLI by default (`context.fileName` or `GEMINI.md`) | docs + fixture (Codex, OpenCode, Claude) | Canonical instructions = `AGENTS.md`. Claude and Gemini get **shims** (`@AGENTS.md` import — both support `@` imports); never a duplicate. |
| `.agents/skills` is read natively by Codex, OpenCode, Copilot, Cursor, Gemini; not by Claude Code (`.claude/skills` only); a `.claude/skills → ../.agents/skills` directory symlink **is** followed by Claude Code | docs + fixture; Claude debug log | Canonical skills = `.agents/skills`. Claude projection = dir symlink where the platform allows, else per-skill copies recorded in the ledger. |
| Codex does not read `.claude/skills`; OpenCode reads `.claude/skills` **and** `.agents/skills` and dedups by name (first wins, warning); Codex shows duplicates unmerged | docs + fixture | Convergence must remove/replace duplicate skill trees, not just add the canonical one. |
| OpenCode uses `CLAUDE.md` only when `AGENTS.md` is absent; OpenCode 2 reads only `AGENTS.md` | docs | A `CLAUDE.md` shim is invisible to OpenCode/Codex — safe and cheap. |
| Symlinked instruction files and skill folders are followed by Claude, Codex, OpenCode (macOS); Copilot/Cursor/Gemini do **not** document symlink following and have Windows breakage reports; Gemini offers `gemini skills link` instead | docs, fixtures, issue trackers | Symlink policy is **per harness × platform**, driven by the matrix plus a runtime probe; default to copy/shim when unverified; never silently fall back. |
| A symlink materialized as a text file on Windows makes Claude "discover nothing" and would make a symlinked `CLAUDE.md` load a one-word instruction set | Adobe guide + reasoning | `CLAUDE.md`/`GEMINI.md` are **shims (regular files)**, never symlinks. Skills fall back to copies. |
| Subagent formats: Claude Markdown (`tools`, `model`, `permissionMode`, …), Codex TOML + `[agents.<name>]` registration, OpenCode Markdown (`mode`, `permission`), Copilot `.agent.md`, Cursor, Gemini — no standard | docs; agentsync found Codex registration by testing | No canonical agent format. Native agent files stay the source; cross-harness forms are **generated adapters**, opt-in, with a degradation list. |
| Non-interactive verification exists: `codex debug prompt-input`, `opencode debug skill` / `agent list`, `claude -p --debug-file`, `copilot skill list`, `gemini skills list`; none dumps "which instruction files loaded" except Codex's composed prompt and Claude's debug log | docs + fixtures | `verify --live` runs per-harness probes with timeouts (OpenCode hung once); reports *verified / structural-only / not installed*, never fakes. |
| Claude Code advises `CLAUDE.md` < ~200 lines; Codex caps concatenated instructions at 32 KiB; Codex skill descriptions truncate | docs | Audit reports line/byte budgets per harness; never rewrites content to fit. |
| Agent Skills spec: `name` = directory, `^[a-z0-9]+(-[a-z0-9]+)*$` ≤64, `description` ≤1024, optional `license/compatibility/metadata/allowed-tools`; other fields are tool extensions (ignored by others) | spec | Skill lint = spec rules; non-portable fields are a *warning*, not a blocker (they are ignored elsewhere). |

## B. Prior art (what to adopt, what to avoid)

| Pattern | From | Adopted as |
|---|---|---|
| Adapters produce a `FileSet`; one writer applies it; skip identical, refuse divergent | FleetSmith | Plan/apply engine: every change is a planned file operation; apply is the only writer. |
| Five-way target classification `missing / own-link / foreign-link / real-file / real-dir` | agents-skills-sync | Inventory classifier, extended with `own-copy`, `own-shim`, `broken-link`, `wrong-target`. |
| Quarantine-never-delete, in-repo, timestamped, reported | agents-skills-sync (+ hana's regret) | `.agentunison/quarantine/<ts>/<relpath>`; DELETE only with explicit approval flag. |
| Ownership manifest + version stamp + upgrade ledger | agentsync | `.agentunison/state.yaml` ledger; `version` in manifest; upgrade notes. |
| Relative symlinks through one stable indirection point; cycle + inode/realpath checks | hana, sync-skills, agent-sync (incident) | All links relative; target resolved and cycle-checked before linking; refuse to replace a real directory. |
| Collection: real dir in harness path → move to canonical → link back | hana | ADOPT action for skills found only in a native dir. |
| Loud fallback ladder (symlink → junction → copy → fail), never "created" when it fell back | agent-smith vs agent-sync | Projection result records the mechanism actually used; plan shows it. |
| Marker-delimited managed block with strict parse + repair | agent-smith, agents-skills-sync | Managed blocks in `AGENTS.md` (routing) and `.gitignore`. |
| Origin marker enabling reversible release; land-before-delete | sync-skills | Ledger `origin` per adopted item; MOVE = copy → verify → remove source. |
| Frontmatter portability analysis (signal ≠ verdict; broken vs degraded) | sync-skills, agentsync | Skill lint categories: `blocking`, `degraded`, `info`. |
| Capability matrix as data with per-harness quirks and a degradation table | FleetSmith, wshobson | `matrix/*.yaml` with `evidence`, `checkedOn`, `versions`; every projection decision cites a matrix key. |
| CI gate: regenerate → tree must be clean; QA on produced output | wshobson, FleetSmith, agent-smith | `agentunison verify` exit codes; idempotency test asserts byte-identical second run. |
| Live-exec posture: opt-in, skip loudly, never gate CI on model output | FleetSmith | `verify --live` separate from structural `verify`. |
| Audit checklists (health check, budgets, before/after probe) | Adobe | Deterministic subset becomes audit rules; prompt-only checks are documented, not automated. |
| Runtime "installed ≠ active harness" detection | agent-smith | `doctor` detects installed binaries + versions + config presence; targets are confirmed, not assumed from PATH. |
| Node ESM + one runtime dep + SEA binary + smoke-test-the-artefact | FleetSmith | Packaging plan (ADR-0001). |

Rejected: fleet/handover orchestration model; OKF/OpenWiki LLM knowledge compiler;
LLM-authored adapters; prose-as-engine; N identical instruction copies; unconditional
`CLAUDE.md → AGENTS.md` symlink; absolute or chained symlinks; `--force` meaning
`rm -rf`; regex patching of TOML/JSON; `cp -f` of user settings; gitignore-everything;
`$HOME` side effects; marketplace data model; template agents/skills.

## C. Gaps confirmed (AgentUnison's differentiation)

1. No existing tool inventories and audits an existing harness setup before acting.
2. No tool combines an ownership ledger with symlink projections.
3. No tool models `CLAUDE.md = canonical + harness-specific delta`.
4. No tool ships a version-sensitive capability matrix backed by tests against real
   binaries, nor reports per-harness verification honestly (verified vs structural).
5. No tool treats Windows/symlink-hostile environments as a first-class, planned path.

## D. Corrections to the original brief

- The brief's reference layout (`.claude/skills -> ../.agents/skills`) is *one* valid
  projection, correct for Claude Code on macOS/Linux; on Windows or for Copilot/Cursor/
  Gemini it is either unnecessary (they read `.agents/skills` natively) or unverified.
- "Use symlinks where direct shared content is safe" turns out to apply mainly to Claude
  Code's skills dir; most other harnesses read the canonical paths directly, so the
  common case is **native, no projection at all** — the tool must recognise that state
  (hana's "same resolved path ⇒ native") and not manufacture links.
- cc-agents is a byte-identical fork of wshobson/agents and is not a separate reference.
