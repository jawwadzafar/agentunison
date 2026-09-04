# 004 — CLI and YAML design

## 1. Command surface (v1)

Normal usage needs two commands: `init` and `verify`. Everything else is a facet of the
same pipeline exposed for inspection and control.

| Command | What it does | Writes? |
|---|---|---|
| `agentunison init` | Fresh repo: detect harnesses, write manifest + skeleton `AGENTS.md` + projections + ledger, verify. Existing setup detected → runs `audit` + `plan`, prints the plan, and (interactive) asks per approval group; non-interactive: applies only `safe` actions and prints what awaits approval. | yes (planned only) |
| `agentunison inspect` | Inventory: every harness surface found, classified, with evidence. `--json`. | no |
| `agentunison audit` | Findings over the inventory (duplicates, stale, conflicts, budgets, portability, overlap). Exit 0/2 (findings). | no |
| `agentunison plan` | The action list with risk classes and reasons; the dry run. `--json`, `--diff` for MODIFY actions. Exit 0 (nothing to do) / 3 (actions pending). | writes `.agentunison/plan.json` only with `--save` |
| `agentunison apply` | Executes the plan. Default: `safe` actions only. `--approve <id,…>\|all` for `review` actions; `--allow-delete` additionally required for DELETE. `--plan <file>` to apply a saved plan exactly. | yes |
| `agentunison verify` | Structural validation against ledger + matrix; `--live` adds real-harness probes (timeouts; per-harness result: verified / structural-only / not-installed / failed). Exit 0 / 4 (drift) / 5 (managed block damaged) / 6 (live probe failed). | no |
| `agentunison status` | One-screen summary: targets, canonical paths, projections and their mechanism, drift count, quarantine count. | no |
| `agentunison doctor` | Environment: installed harness binaries + versions vs matrix `versionsVerified`, platform symlink/junction probe result, git state (worktree, `core.symlinks`), manifest validity. | no |
| `agentunison uninstall` | Remove every ledgered managed path (land-before-delete reversed: restore quarantine → remove shims/links/copies/blocks → remove ledger). `--keep-canonical` is implicit: canonical content is never removed. | yes |

Global flags: `--json`, `--cwd <path>`, `--yes` (accept `safe` without prompt; never
implies approvals), `--no-color`, `--verbose`. Interactive prompts only when stdin is a
TTY; otherwise the command prints the pending approvals and exits with a non-zero code.

### Action vocabulary and risk classes

| Op | Meaning | Risk |
|---|---|---|
| ADD | create a new managed file/dir (shim, ledger, skeleton) | safe |
| SYMLINK | create a managed relative link | safe |
| COPY | create a managed hashed copy (fallback) | safe |
| GENERATE | write a generated adapter with header | safe (opt-in in manifest) |
| PRESERVE | explicitly leave a native/foreign path alone (recorded so it stops being reported) | safe |
| MODIFY | change a user-owned file in a bounded way (managed block insert/repair; adopted content appended under a marked heading) — shown as a diff | review |
| MOVE | relocate content (e.g. `CLAUDE.md` → `AGENTS.md`, `.claude/skills/x` → `.agents/skills/x`); copy → verify → remove source; `git mv` when tracked | review |
| ADOPT | take a legacy item into canonical form (command → skill) | review |
| QUARANTINE | move a duplicate/conflicting path into `.agentunison/quarantine/<ts>/` | review |
| DEPRECATE | mark in the audit + ledger; no file change (e.g. `.cursorrules` when `AGENTS.md` covers it) | safe |
| DELETE | remove a path permanently | destructive (`--approve` + `--allow-delete`) |

Approvals are recorded in `agentunison.yaml` under `decisions:` so a later `plan` does
not re-ask; declining is recorded too (`preserve`).

## 2. Manifest — `agentunison.yaml` (intent; human-edited; small)

```yaml
# agentunison.yaml — intent. Edit freely; run `agentunison plan` to see the effect.
version: 1
targets: [claude, codex, opencode]          # harnesses this repo is used with
canonical:
  instructions: AGENTS.md                   # the only always-loaded instruction file
  skills: .agents/skills                    # Agent Skills spec directories
policy:
  symlinks: auto                            # auto | never | always (auto = matrix × platform probe)
  onConflict: quarantine                    # quarantine | ask  (delete is never a default)
  managedBlocks:
    agentsMd: true                          # routing block appended to AGENTS.md
    gitignore: true                         # quarantine dir + local-only entries
  budgets:
    instructionsLines: 200                  # audit warning thresholds
projections:                                # optional pins; absent = policy decides
  claude:
    skills: symlink-dir                     # native | symlink-dir | copy | none
adapters:
  agents: []                                # opt-in generated agents, e.g.
  # - source: .claude/agents/reviewer.md
  #   to: [opencode, codex]
decisions: {}                               # recorded approvals/declines keyed by action id
  # adopt:.claude/commands/deploy.md: adopt-as-skill
  # preserve:.github/copilot-instructions.md: preserve
```

Rules: unknown keys are an error (strict schema); comments and key order are preserved
on rewrite (YAML document editing, never object round-trip); the file never contains
machine state (hashes, timestamps) so diffs stay meaningful.

## 3. Ledger — `.agentunison/state.yaml` (machine-owned; committed)

```yaml
version: 1
tool: agentunison@0.1.0
platformAtApply: { os: darwin, symlinks: true }
managed:
  - path: CLAUDE.md
    kind: instructions
    harness: claude
    mechanism: shim
    sha256: 3f…                              # of the managed part only; harness-specific section excluded
    createdAt: 2026-09-04
  - path: .claude/skills
    kind: skills
    harness: claude
    mechanism: symlink-dir
    target: ../.agents/skills
  - path: .agents/skills/deploy
    kind: skill
    mechanism: adopted                        # origin recorded for reversibility
    origin: .claude/commands/deploy.md
  - path: .opencode/agents/reviewer.md
    kind: agent
    harness: opencode
    mechanism: generated
    source: .claude/agents/reviewer.md
    sourceSha256: 9a…
    sha256: 1c…
blocks:
  - file: AGENTS.md
    marker: agentunison
    sha256: 77…
quarantine:
  - from: .claude/skills/deploy
    to: .agentunison/quarantine/2026-09-04T10-11-12Z/.claude/skills/deploy
    reason: duplicate-of-canonical
```

Sorted, stable serialization (no timestamps beyond `createdAt`) so a no-op run is
byte-identical. `verify` compares the ledger against the filesystem; `uninstall` walks it
in reverse.

## 4. Output contract

Human output is grouped by harness and by action, one line each, with the reason in
parentheses and the evidence key from the matrix when a compatibility fact was used
(`claude.skills.followsDirSymlink[test 2026-09-04]`). `--json` emits the same objects
(`Inventory`, `Finding[]`, `Plan`, `VerifyReport`) with a stable schema version so agents
can consume them.

Exit codes: 0 ok · 1 usage/config error · 2 audit findings · 3 plan has pending actions ·
4 drift · 5 managed block damaged · 6 live verification failed · 7 refused (would destroy).

## Amendments (post-review, see 008)
- Commands: `status` folded into `verify` output; `plan --save` removed (`plan --json > f`);
  `apply --plan <f>` kept as the two-phase mechanism. `DEPRECATE` op removed (a finding).
- New review actions: `ADOPT-MANAGED`, `REPAIR`, `BACKPORT`. Hash-mismatched managed paths
  are never touched by `safe` actions.
- Exit codes: 0 ok · 1 usage/config · 2 findings (audit) or pending actions (plan) · 4 verify
  failed (with `reason` field: drift, block-damaged, live-failed, environment) · 7 refused
  (precondition mismatch or would destroy).
- Manifest: add `id:` (random, generated once; nonce for the managed block); remove
  `policy.budgets`. `decisions:` entries are approvals honored by `apply` (shown as
  pre-approved in `plan`); ids are `<op>:<path>` or `merge:<file>:<sha8>`. Block style forced.
- Ledger renamed `.agentunison/ledger.yaml`; contains no `tool`, `platformAtApply`,
  `quarantine`, or timestamps other than none — sorted by codepoint, deterministic. Local state
  in `.agentunison/local/{state.yaml,journal/,quarantine/,verify/}`.
- Hashes are computed after LF normalization; tree hashes are content-only, codepoint-sorted,
  excluding `.DS_Store`/`Thumbs.db`.
