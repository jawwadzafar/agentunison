# 008 — Independent design review: findings and resulting changes

Reviewer: independent, read-only, adversarial pass over 001–007 + ADR-0001 with 12 attack
axes. Verdict: **APPROVE WITH CHANGES**. 54 findings (7 blocking). Every finding is listed
with the decision taken. Where a decision changes 003–007 or the ADR, that document carries
an "Amendments (post-review)" section pointing here; the implementation follows this file.

## Blocking → all fixed in the design

| # | Finding | Decision |
|---|---|---|
| 1 | Writing/moving through a symlinked `CLAUDE.md`/`AGENTS.md` destroys the canonical file | `lstat` before every write; refuse to write through a symlink; MOVE/COPY require `realpath(src) ≠ realpath(dst)`; new convergence rows for "root file is a symlink" (unmanaged link → `ADOPT-MANAGED` review, or unlink-then-write review) |
| 2 | `foreign` vs "adopt-as-managed" contradiction; taking ownership of a user file as a `safe` action | New class **`unmanaged-compatible`** (unledgered path whose type+target/content equals what policy would create). `ADOPT-MANAGED` is a **review** action. `foreign` stays untouchable |
| 8 | Quarantine paths/timestamps in the committed ledger → post-clone drift, merge conflicts, non-determinism | Quarantine removed from the committed ledger; the per-run local `MANIFEST.yaml` is the only index |
| 13 | No precondition re-validation between plan and apply | Every action carries preconditions (source sha256, destination absent or hash X, path type). Apply is **two-phase**: verify all preconditions, then execute; any mismatch → exit 7, nothing written |
| 14 | Similarity-based drops lose content; `.github/copilot-instructions.md` is read by Copilot surfaces that do not read `AGENTS.md` | "Shared" paragraphs = byte-equal after whitespace normalization only. Near-duplicates are *reported* pairwise, never acted on. `copilot-instructions.md` is PRESERVE + finding, never auto-quarantined |
| 24 | Junctions are absolute and get committed as directory copies on `core.symlinks=false` | Mechanism **class** (`link`) is committed; the mechanism actually used on a machine (symlink / junction / copy) is recorded in local state. When a machine-local fallback replaces a committed symlink, `apply` prints a loud "do not commit `<path>`" warning, `verify` uses the local record for that machine, and the report suggests `git update-index --skip-worktree` (never executed by the tool). Native Windows CI is added to the plan |
| 54 | "Lossless" agent adapters are not lossless; Codex needs config registration in a file we refuse to edit | **Codex adapter cut.** OpenCode adapter kept **opt-in only**, emitting `description`, `mode: subagent`, body, and a header listing every dropped field; refuses reserved OpenCode names (`plan`, `build`, `general`, `explore`). Lowest-priority milestone |

## Should-fix → accepted unless stated

| # | Finding | Decision |
|---|---|---|
| 3 | Committed ledger records per-machine facts | Split: committed `.agentconcord/ledger.yaml` (path, kind, harness, mechanism class, target/hash) vs gitignored `.agentconcord/local/` (platform, actual mechanism, journal, quarantine, verify logs). `.agentconcord/local/.gitignore` contains `*` (self-ignoring) |
| 4 | Refresh clobbers hand-edited managed files | Hash-mismatched managed paths are never touched by `safe` actions. New review actions **REPAIR** (rewrite to expected, diff shown) and **BACKPORT** (copy edited content back to canonical) |
| 5 | Co-owned directory (foreign manifest/banner) falls through to copy | Foreign manager markers in a target dir ⇒ projection `none` + high-severity finding |
| 6 | Reversible adoption claimed, not implemented | Claim dropped; `origin` kept as provenance only |
| 7 | Ledger keyed by path; user renames canonical | `verify` reports "canonical moved/missing" with the suggested ledger fix (distinct message) |
| 9 | Content-derived nonce churns; tool version/platform in ledger | `id` (random, once, in `agentconcord.yaml`) is the nonce; ledger has no tool version or platform |
| 10 | `decisions:` semantics | Recorded decisions **are** approvals for `apply`; `plan` shows them as pre-approved. Ids: `<op>:<path>` and `merge:<file>:<paragraph-sha8>`. `--reconsider` deferred |
| 11 | YAML flow style / comment relocation | Block style forced; ledger serialized with plain sorted `stringify`; manifest edited via Document API with `lineWidth: 0` |
| 12 | `policy.budgets` duplicates matrix | Cut |
| 15 | Command→skill adoption collisions and Claude-only syntax | Slugify to spec regex (finding when changed); namespaced `a/b.md` → `a-b`; reuse skill CONFLICT rule; finding lists Claude-only syntax (`!`cmd``, `@file`, `$ARGUMENTS`, `context: fork`) |
| 16 | Whole-dir symlink forces adoption of everything | New mechanism **`symlink-entries`** (`.claude/skills/<n> → ../../.agents/skills/<n>`) is the default Claude projection when `.claude/skills` exists with content; whole-dir link only when absent/empty; untracked/ignored entries default to PRESERVE with a finding |
| 17 | Quarantining a symlink dereferences or dangles | Quarantine of a link records `linkTarget` and unlinks; never dereferences. Inventory proposes the user's existing link target as `canonical.skills` when `.agents/skills` is absent |
| 18 | Quarantined skills resurface (Cursor scans `.agents/skills` anywhere; Claude nested `.claude/skills`) | Quarantine layout is harness-neutral: leading dot of each path segment replaced by `_dot_` (`.claude/skills/x` → `_dot_claude/skills/x`); original path in MANIFEST |
| 19 | `git mv` on dirty trees | Cut. Plain fs rename; the tool never invokes git for writes |
| 20 | Case-insensitive filesystems | Inventory via `readdir` exact-name matching; case-variant names produce a finding |
| 21 | Copilot CLI / Cursor read shims literally | Shim text is harmless when read literally ("If you are reading this line, the instructions are in AGENTS.md"); finding on duplicate-load cost when copilot/cursor are targets |
| 22 | "identical hash → nothing" is a silent delete | Always quarantine |
| 23 | `.gitignore` managed block is a MODIFY that non-interactive `init` cannot apply | `.gitignore` block cut; `.agentconcord/local/.gitignore` = `*` |
| 25 | Probe in `os.tmpdir()` is wrong for bind mounts | Probe inside the repo (`.agentconcord/local/.probe-<pid>`), cleaned up |
| 26 | `platforms: [darwin]` starves Linux | Matrix platform key `posix \| win32`; darwin evidence covers posix (fs-level behavior) |
| 27 | Copy fallback degrades OpenCode/Cursor/Copilot (duplicates) | Plan states the degradation per harness when choosing `copy`; OpenCode dedup probe runs in the live suite on the standard layout |
| 28 | Copy tree needs a reverse path and a hash definition | BACKPORT (see 4); tree hash = content only, LF-normalized, codepoint-sorted, excluding `.DS_Store`/`Thumbs.db`; exec bits preserved on copy |
| 29 | CRLF checkouts break hashes | All hashes computed after LF normalization |
| 30 | Journal lacks write-ahead semantics | Intent record (with preconditions) written + fsynced before each op, marked done after; replay inspects the filesystem for intent-without-done |
| 31 | Uninstall deletes user text in shims and leaves Claude blind | Uninstall contract: every targeted harness still works. Shims are *unmanaged* (managed part stripped, harness-specific text kept; file removed only if nothing remains); skills link replaced by a materialized copy by default (`--keep-links` to keep); quarantine never removed; its path printed |
| 32 | Restore skipped silently when destination occupied | Each skipped item printed with reason and quarantine path |
| 33 | Gemini `@AGENTS.md` shim unverified; Gemini not installed | Gemini target **opt-in**, shim uses `@./AGENTS.md`, verification structural-only, documented as unverified until fixture-tested. `.gemini/settings.json` alternative documented as a manual option (the tool does not edit settings) |
| 37 | Claude debug-log format is a version-bound fact | Live probe reports `failed(unparseable)` on format change, never drift; `doctor` warns when installed version > `versionsVerified` |
| 41 | Inventory surfaces hard-coded outside the matrix | Each `matrix/<harness>.yaml` declares `surfaces:` (instructions/skills/agents/commands/rules/settings/hooks/mcp, with `legacy:` variants); scanners iterate the matrix |
| 42 | Closed mechanism enum | Mechanisms implement a small interface (plan/apply/verify/uninstall); `canonical:` kinds come from the matrix schema |
| 43–52 | Overengineering | Exit codes reduced to 0 ok · 1 usage/config · 2 findings or pending actions · 4 verify failed (reason field) · 7 refused. `DEPRECATE` → finding. `plan --save` cut (`--json > file`; `apply --plan` kept as the two-phase mechanism). `status` folded into `verify` output. Similarity findings A07–A10 and A09 template heuristics deferred; the similarity engine is report-only, never in a decision path. Interactive prompts minimal (y/N when TTY); non-interactive path is primary |
| 53 | ADR missing type-stripping constraints and Windows CI | ADR amended: explicit `.ts` import extensions, `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `--disable-warning=ExperimentalWarning`, explicit test glob; `yaml` `lineWidth: 0`; Windows CI job planned; `AbortSignal.timeout` on every spawn; `where`-based detection on win32 |

## Nits accepted
7, 11, 12, 22, 32, 42 (above). 35/36/40 confirmed as already handled.

## What did not change
The pipeline (inventory → audit → plan → single-writer apply → ledger → verify), the
ownership classes (plus the new `unmanaged-compatible`), canonical at ecosystem paths,
shims-not-symlinks for instructions, quarantine-over-delete, the evidence-tagged matrix,
the CLAUDE.md-delta model, and TypeScript/Node.

## Reviewer's differentiation check (recorded)
The steady state for Claude/Codex/OpenCode is the Adobe layout that hana and agent-smith
also reach; AgentConcord's identity lives in the **transition** (audit → plan → exact-match
merge with per-block decisions → precondition-checked apply) and **protection** (ledger,
`verify` in CI, live probes). Consequently structural `verify` is delivered together with
`apply` (same milestone), and `verify` output quality gets the polish budget.
