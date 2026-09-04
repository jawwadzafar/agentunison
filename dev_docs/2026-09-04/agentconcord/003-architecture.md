# 003 — Architecture

## 1. Conceptual model

```
                 ┌──────────────────────┐
  repository ───▶│ inventory (facts)    │  what exists, classified, with evidence
                 └─────────┬────────────┘
                           ▼
                 ┌──────────────────────┐   capability matrix (data, versioned)
                 │ audit (findings)     │◀── platform probe (symlinks? junctions?)
                 └─────────┬────────────┘   manifest (intent + recorded decisions)
                           ▼
                 ┌──────────────────────┐
                 │ plan (actions)       │  ADD MODIFY MOVE COPY SYMLINK GENERATE ADOPT
                 └─────────┬────────────┘  PRESERVE QUARANTINE DEPRECATE DELETE
                           ▼   approvals
                 ┌──────────────────────┐
                 │ apply (single writer)│──▶ ledger (.agentconcord/state.yaml)
                 └─────────┬────────────┘
                           ▼
                 ┌──────────────────────┐
                 │ verify (structural)  │  + verify --live (real harness probes)
                 └──────────────────────┘
```

Every stage is a pure function of its inputs except `apply`, which is the only code that
writes to the repository, and it writes only what the plan lists.

## 2. Content classes (the ownership model)

| Class | Meaning | Who edits | AgentConcord may |
|---|---|---|---|
| **canonical** | The single source for an asset kind (`AGENTS.md`, `.agents/skills/<n>/`) | user / agents | validate; append/repair its *managed block* only; MODIFY content only via an approved ADOPT action |
| **native** | Harness-specific content with no canonical equivalent (`.claude/agents/*.md`, `.codex/config.toml`, `.cursor/rules/*.mdc`, settings, hooks) | user | inventory, audit, PRESERVE; use as a *source* for opt-in generated adapters |
| **managed** | Created by AgentConcord: shims, symlinks, copies, generated adapters, managed blocks | AgentConcord | create, refresh, remove — always recorded in the ledger with a content hash or link target |
| **legacy** | Superseded location (`.claude/commands/*.md`, `.cursorrules`, a real `.claude/skills/<n>` when the canonical exists) | user | propose ADOPT / QUARANTINE / DEPRECATE; never act without approval |
| **foreign** | Anything else inside a harness directory (plugin caches, unknown files, other tools' managed markers) | others | list; never touch |
| **quarantined** | Displaced content under `.agentconcord/quarantine/<ts>/` | AgentConcord | restore on `uninstall`/`rollback`; never auto-purge |

"Own-ness" is decided by the ledger, not by path pattern or link-target heuristics. A
symlink AgentConcord did not record is `foreign` even if it points at the canonical dir.

## 3. Asset kinds and their canonical/projection rules (v1)

| Kind | Canonical location | Projection per harness (from matrix) |
|---|---|---|
| Root instructions | `AGENTS.md` | codex/opencode/copilot/cursor: **native**. claude: **shim** `CLAUDE.md` (`@AGENTS.md` + managed block + optional harness-specific section). gemini: **shim** `GEMINI.md` (`@AGENTS.md`, same shape). |
| Nested instructions | `<dir>/AGENTS.md` (user-authored, optional) | native for codex/copilot/cursor/opencode; claude: optional nested `CLAUDE.md` shim (not created automatically in v1; audited). |
| Skills | `.agents/skills/<name>/SKILL.md` (+ `scripts/ references/ assets/`) | codex/opencode/copilot/cursor/gemini: **native**. claude: **symlink-dir** `.claude/skills → ../.agents/skills` when the probe says symlinks work and `.claude/skills` is empty/absent or fully adopted; else **copy** per skill (ledger-hashed). |
| Legacy commands | — (`.claude/commands/<n>.md`) | propose **ADOPT → skill** (`.agents/skills/<n>/SKILL.md` with frontmatter synthesized from the first paragraph; user confirms description). |
| Subagents | native per harness | PRESERVE. Opt-in **GENERATE**: `.claude/agents/<n>.md` → `.opencode/agents/<n>.md`, `.codex/agents/<n>.toml` (+ `[agents.<n>]` registration note) with header marker and degradation list. |
| Rules / settings / hooks / MCP | native | PRESERVE; audited (e.g. rule text duplicating `AGENTS.md`). |
| Routing policy | managed block inside `AGENTS.md` | tells agents where assets belong and that shims are managed. |

## 4. Projection mechanisms and the decision policy

Mechanisms: `native` (harness reads the canonical path) · `symlink-dir` · `symlink-file` ·
`shim` (tiny native file importing/pointing to canonical) · `copy` (ledger-hashed
duplicate) · `generated` (format translation, header-marked) · `none` (preserve).

Decision for (kind, harness):

1. If the matrix says the harness reads the canonical path natively → `native`.
2. Else if the harness supports an import syntax for that kind → `shim`.
3. Else if the harness reads a different path with identical format:
   a. platform probe says symlinks work **and** matrix `followsSymlink` for that kind is
      `verified` for this harness → `symlink-dir` (or `-file`);
   b. else → `copy` (loud: plan says "copy — symlinks unavailable/unverified: <reason>").
4. Else if a lossless mapping exists and the user opted in → `generated`.
5. Else → `none`, and the audit lists what that harness cannot see.

Overrides in `agentconcord.yaml` (`policy.symlinks: never|auto|always`, per-target
`projection:` pins) are honored and recorded. `always` still refuses when the probe fails.

Symlink rules: relative targets only; resolve and cycle-check (depth ≤ 8, realpath
identity) before creating; never replace a real directory; a symlink whose target is not
the canonical path is `wrong-target` (foreign unless ledgered); Windows: directory
symlink → try `symlink(type:'junction')`, file symlink → copy; both recorded as the
mechanism actually used.

## 5. Capability matrix (data, not code)

`matrix/<harness>.yaml`, one per harness, loaded at runtime and unit-tested against
fixtures. Every leaf fact carries `evidence: doc|bin|test`, `checkedOn`, and the
`versions` it was verified against; unknown facts default to the conservative branch.

```yaml
harness: claude
displayName: Claude Code
detect:
  binaries: [claude]
  projectDirs: [.claude]
  files: [CLAUDE.md, CLAUDE.local.md]
versionsVerified: ["2.1.259"]
instructions:
  native: [CLAUDE.md, .claude/CLAUDE.md]
  readsAgentsMd: { value: false, evidence: doc, checkedOn: 2026-09-04 }
  importSyntax: { value: "@path", maxDepth: 4, evidence: doc, checkedOn: 2026-09-04 }
  followsSymlink: { value: true, evidence: test, checkedOn: 2026-09-04, platforms: [darwin] }
  lineBudget: 200
skills:
  paths: [.claude/skills]
  readsAgentsSkills: { value: false, evidence: bin, checkedOn: 2026-09-04 }
  followsDirSymlink: { value: true, evidence: test, checkedOn: 2026-09-04, platforms: [darwin] }
  extraFrontmatter: [disable-model-invocation, user-invocable, allowed-tools, model, context, agent, hooks, paths]
agents:
  path: .claude/agents
  format: claude-md
verify:
  live: { command: ["claude","-p","--model","haiku","--debug-file","{debugFile}","--output-format","text","{prompt}"], timeoutMs: 180000, cost: api-call }
```

## 6. Files AgentConcord owns

```
agentconcord.yaml            intent: version, targets, canonical paths, policy, recorded decisions (committed)
.agentconcord/state.yaml     ledger: every managed path with kind, mechanism, source, target/hash, origin, createdAt (committed)
.agentconcord/quarantine/    displaced content, timestamped (gitignored via managed block; git history is the durable copy)
CLAUDE.md / GEMINI.md        shims (only when those harnesses are targets)
.claude/skills               symlink or copy tree (only when claude is a target)
<AGENTS.md managed block>    <!-- agentconcord:begin --> … <!-- agentconcord:end --> (≤ 12 lines)
<.gitignore managed block>   # >>> agentconcord >>> … # <<< agentconcord <<<
```

Nothing else is written. In particular AgentConcord never edits settings, hooks, MCP,
rules, or native agent files, and never writes under `.git/` or `$HOME`.

## 7. Module layout (implementation)

```
src/
  cli.ts            command parsing (node:util parseArgs), output (text/json), exit codes
  commands/         init, inspect, audit, plan, apply, verify, status, doctor, uninstall
  matrix/           loader + schema for matrix/*.yaml; platform probe (symlink/junction capability)
  inventory/        scanners per surface → InventoryItem[] (path, kind, class, harness, evidence)
  audit/            rules → Finding[] (id, severity, message, evidence, suggestedAction)
  policy/           projection decision (kind × harness × platform × manifest) → ProjectionDecision
  plan/             build Action[] from inventory+findings+decisions; risk classes; approvals
  apply/            single writer: fs ops with land-before-remove ordering; ledger updates; quarantine
  verify/           structural checks; live probes per harness (from matrix.verify)
  adapters/         generators: shims, managed blocks, agent-format translations (claude→opencode, claude→codex)
  model/            types: Manifest, Ledger, InventoryItem, Finding, Action, Report
  util/             fs (relative links, atomic writes), frontmatter, hashing, similarity, yaml io
matrix/*.yaml       capability data (shipped with the package)
test/               unit + fixture + idempotency + tamper + live (opt-in) tests
```

Dependencies: `yaml` (runtime). Everything else from Node's standard library.

## Amendments (post-review, see 008)
- New content class **`unmanaged-compatible`**: an unledgered path whose type + target/content
  equals what policy would create. Becomes managed only via the review action `ADOPT-MANAGED`.
  Everything else unledgered inside a harness dir remains `foreign`.
- Mechanisms: add **`symlink-entries`** (per-skill relative links inside `.claude/skills`), the
  default Claude skills projection when `.claude/skills` exists with content; whole-dir
  `symlink-dir` only when the dir is absent or empty. Mechanisms implement a small interface
  (plan/apply/verify/uninstall) so new ones (e.g. Gemini `skills link`) add without core edits.
- Committed vs local state: `.agentconcord/ledger.yaml` (committed: path, kind, harness,
  mechanism **class**, target or hash) and `.agentconcord/local/` (gitignored by its own `*`
  `.gitignore`: platform, mechanism actually used, journal, quarantine, verify logs).
- Owned files list (§6) changes: no `.gitignore` managed block; no `state.yaml`; `id:` in the
  manifest is the nonce used in the `AGENTS.md` managed block.
- Policy ladder (§4): step 3 uses matrix platform key `posix|win32`; a foreign manager marker
  in the target directory forces `none`; copy fallbacks state per-harness degradation.
- Matrix (§5): each harness file declares `surfaces:` (with `legacy:` variants) that the
  inventory scanners iterate; `verify.live` results are `verified | structural-only |
  not-installed | failed(reason)`.
- Generated adapters: Codex cut; OpenCode opt-in with dropped-field header and reserved-name
  refusal. Gemini instructions shim opt-in (`@./AGENTS.md`), structural-only until fixture-tested.
