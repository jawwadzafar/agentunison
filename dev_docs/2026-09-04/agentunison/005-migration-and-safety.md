# 005 — Migration and safety

## 1. Invariants (enforced by code and tests, not by prose)

1. `apply` is the only writer, and it writes only actions present in the plan it executes.
2. No path is removed before its content has landed elsewhere and been re-read and hashed
   (land → verify → remove). MOVE and ADOPT are implemented as COPY + verify + remove.
3. DELETE never appears in a plan unless the user asked (`--allow-delete`); the default
   for anything displaced is QUARANTINE.
4. A real directory is never replaced by a symlink unless it is empty or every entry was
   adopted into the canonical location first (each entry ledgered with `origin`).
5. Only ledgered paths are ever modified or removed. Foreign files are reported, never
   touched, never "repaired".
6. User-owned files are modified only inside marker-delimited managed blocks or by an
   explicitly approved ADOPT/MOVE with the diff shown.
7. All symlinks are relative, cycle-checked (depth ≤ 8, realpath identity), and refused
   if the target escapes the repository.
8. No writes outside the repository root; never under `.git/` (except `git mv` via git).
9. Every fallback (symlink → junction → copy) is recorded as the mechanism actually used
   and reported; results never say "linked" when a copy was made.
10. A second `apply` with no intervening change produces a byte-identical tree and ledger.

## 2. Discovery mode for existing repositories

`init` on a repo with any harness surface present never applies review-class actions
without approval. The flow:

1. **Inventory** every known surface: `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`,
   `GEMINI.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`,
   `.cursorrules`, `.cursor/rules/*.mdc`, `.claude/{skills,agents,commands,rules,settings*.json,launch.json}`,
   `.codex/{config.toml,agents,hooks.json,skills}`, `.opencode/{agents,agent,commands,skills}`,
   `opencode.json`, `.agents/skills`, `.github/{agents,skills,prompts,hooks}`, `.cursor/{skills,agents,commands,hooks.json}`,
   `.gemini/{settings.json,commands,skills,agents}`, nested `AGENTS.md`/`CLAUDE.md`, and
   the vendored-skill signals (`skills-lock.json`, plugin caches) which mark trees read-only.
2. **Classify** each item (see 003 §2) using the ledger (own) and path/format knowledge
   (native/legacy), never adopting by path match alone.
3. **Audit** (rules in 006 §2) → findings with evidence.
4. **Plan** → actions with risk classes and stable ids (`kind:path[:detail]`).
5. **Approve** → interactive per group, or `apply --approve`. Decisions persist in
   `agentunison.yaml` so re-runs do not re-ask.

## 3. Convergence rules per situation

### Root instructions
| Situation | Plan |
|---|---|
| Only `AGENTS.md` | ADD shims for claude/gemini targets; MODIFY `AGENTS.md` (append managed block, review). |
| Only `CLAUDE.md` | MOVE `CLAUDE.md` → `AGENTS.md` (`git mv` when tracked; content untouched), then ADD `CLAUDE.md` shim. Review. |
| Both, `CLAUDE.md` already a shim (`@AGENTS.md` first line) | ADOPT shim as managed (pin), ADD block. Safe. |
| Both, differing | Paragraph-level diff: shared blocks, `CLAUDE.md`-only blocks, `AGENTS.md`-only blocks. Plan offers per `CLAUDE.md`-only block: **adopt into `AGENTS.md`** (MODIFY, appended under `## Merged from CLAUDE.md` for the user to place), or **keep as Claude-specific** (moved into the shim's harness-specific section), or **quarantine**. Default proposal: adopt when the block contains no Claude-only vocabulary (`.claude/`, `subagent`, `/skill-name`, hooks), else keep-as-specific. Always review. |
| `GEMINI.md` present | same treatment as `CLAUDE.md`; shim uses `@AGENTS.md` (Gemini import). |
| `.github/copilot-instructions.md` present | Copilot reads `AGENTS.md` natively. If content ≈ `AGENTS.md` (≥ 0.9 similarity) → QUARANTINE (review); else PRESERVE + finding "duplicated guidance, consider adopting". |
| `.cursorrules` present | DEPRECATE finding; ADOPT into `AGENTS.md` only on approval. |
| Nested `CLAUDE.md` without nested `AGENTS.md` | finding only in v1. |

### Skills
| Situation | Plan |
|---|---|
| Skill only under a native dir (`.claude/skills/x`, `.cursor/skills/x`, …) | ADOPT: MOVE to `.agents/skills/x` (spec-validate frontmatter first; blocking violations → finding, no move). Review. |
| Same name in canonical and native, identical hash | QUARANTINE the native copy (or nothing, if the native dir will become a symlink). Review. |
| Same name, differing content | CONFLICT finding with a diff; plan offers keep-canonical / keep-native / quarantine-one. No default action. |
| `.claude/commands/x.md` | ADOPT → `.agents/skills/x/SKILL.md` (frontmatter synthesized: `name: x`, `description:` first sentence; body preserved; `$ARGUMENTS` left as-is with a finding). Review. |
| Vendored trees (lock file, plugin cache) | PRESERVE, read-only, excluded from convergence. |
| Claude projection | after adoption, `.claude/skills` is empty → SYMLINK dir (or COPY tree on symlink-hostile platforms). |

### Subagents, rules, settings, hooks, MCP
PRESERVE. Findings: duplicate agent names across harnesses with ≥ 0.8 body similarity
("candidate for a single source + generated adapter"), agents whose body ≈ a skill body,
Claude-only fields used, rule text duplicated in `AGENTS.md`.

## 4. Quarantine

`.agentunison/quarantine/<UTC timestamp>/<original relative path>`; a `MANIFEST.yaml`
per timestamp lists `from`, `to`, `reason`, `sha256`. The directory is gitignored via the
managed `.gitignore` block (the displaced content is in git history when it was tracked;
quarantine protects untracked/uncommitted content and enables immediate rollback). Never
auto-purged; `status` shows its size and age.

## 5. Rollback and uninstall

- `apply` writes a per-run journal (`.agentunison/journal/<ts>.yaml`, gitignored) with
  each operation and its inverse. On a mid-run failure the journal is replayed in reverse
  (best effort, reported).
- `uninstall`: restore quarantined items whose destination is free; remove managed
  blocks; remove shims, links, copies, generated adapters that still match their ledger
  hash (changed ones are reported and kept); remove the ledger. Canonical files stay.
- Anything AgentUnison cannot undo mechanically (a user later edited a moved file) is
  reported with the exact `git` command that restores the pre-migration state.

## 6. Cross-platform behavior

| Platform / situation | Behavior |
|---|---|
| macOS / Linux | relative symlinks for the Claude skills projection when verified in the matrix. |
| Windows, symlinks unavailable (no Developer Mode) | directory projections try a junction (`fs.symlink(..,'junction')`) if the matrix marks junctions verified for that harness; otherwise COPY tree with hashes; file projections are never links. Shims are regular files everywhere. |
| Git worktree / submodule | repo root = `git rev-parse --show-toplevel`; links stay relative so worktrees share nothing by accident. |
| `core.symlinks=false` checkout of a repo that committed symlinks | `doctor`/`verify` detect a text file at a ledgered symlink path (mode/contents mismatch) and report the fix (`git config core.symlinks true` + re-checkout) or offer `plan` with `policy.symlinks: never` → COPY. |
| Editors/tools that materialize symlinks into files | same detection; `verify` exit 4 with the path. |
| Containers/devcontainers | no special casing; probe decides at run time. |

## 7. What makes future duplicates hard to recreate

- `AGENTS.md` managed block states, in ≤ 12 lines, where each asset kind lives and that
  `CLAUDE.md`/`GEMINI.md` are managed shims — read by every agent on every session.
- Shims carry a one-line "managed by AgentUnison; run `agentunison plan`" notice.
- `verify` (CI) fails on: shim content changed outside its harness-specific section, a
  real directory where a ledgered symlink should be, a new skill tree in a native dir
  while a canonical dir exists, duplicate skill names across dirs, a second root
  instruction file with non-shim content for a targeted harness.

## Amendments (post-review, see 008)
- Invariant 1 gains: apply is two-phase — all action preconditions (source hash, destination
  state, path type) are verified before any write; mismatch ⇒ exit 7, nothing written.
- Invariant 7 gains: `lstat` before every write; never write through a symlink;
  MOVE/COPY require `realpath(src) ≠ realpath(dst)`.
- Invariant 8 simplifies: the tool never invokes git for writes (no `git mv`).
- Invariant 10 qualifier: byte-identical second run holds for the same tool version and
  platform (mechanism fallbacks are recorded locally, not in the committed ledger).
- Root instructions table gains rows: root file is a symlink to the other (`unmanaged-compatible`
  or `wrong-target`) ⇒ `ADOPT-MANAGED` / unlink-then-write, both review.
  `.github/copilot-instructions.md` ⇒ PRESERVE + finding only (never quarantined by similarity).
  "Shared" paragraphs = byte-equal after whitespace normalization; near-duplicates reported.
- Skills: default Claude projection `symlink-entries`; whole-dir link only if `.claude/skills`
  is absent/empty; untracked or ignored entries PRESERVE with a finding; identical duplicates
  always quarantined (never "nothing"); foreign manager marker ⇒ projection `none`.
- Commands → skills: slugify to the spec regex (finding when changed); `a/b.md` → `a-b`;
  CONFLICT rule applies; Claude-only syntax listed in a finding.
- Quarantine: `.agentunison/local/quarantine/<UTC ts>/` with a harness-neutral layout (leading
  dot of each segment → `_dot_`) and `MANIFEST.yaml` (from, to, reason, sha256, linkTarget for
  links — links are unlinked, never dereferenced). Not in the committed ledger.
- Journal is write-ahead: intent (+preconditions) fsynced before each op, done-mark after.
- Uninstall contract: every targeted harness still works afterwards — shims are unmanaged
  (managed part stripped, harness-specific text kept), skills link materialized as a copy by
  default (`--keep-links` to keep), quarantine never removed, skipped restores printed.
- Cross-platform: probe runs inside the repo; when a machine-local fallback (junction/copy)
  replaces a committed symlink the tool warns "do not commit <path>" and suggests
  `git update-index --skip-worktree` (never executed by the tool). Inventory uses `readdir`
  exact-name matching (case-insensitive filesystems) and hashes after LF normalization.
- §7 drops the `.gitignore` block; shim wording is harmless when read literally by harnesses
  that do not expand `@` imports (Copilot CLI, Cursor).
