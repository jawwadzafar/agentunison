# AgentConcord — progress record

Started 2026-09-04. Project root: `/Users/jawwadzafar/repo/jawwadzafar/agentconcord`.
Research clones: `/Users/jawwadzafar/repo/jawwadzafar/ideas/`. Local reference (read-only):
`/Users/jawwadzafar/repo/subhranshu/fleetsmith`.

## Phase 0 — freeze previous work
- The previous repository (`~/cloned_repos/ai-gateway-platform`, branch
  `chore/agent-harness-agents-md`, PR #304 open) is **frozen**: no git operations,
  no file writes. It is used only as read-only reference for what a real
  convergence looked like (AGENTS.md canonical, CLAUDE.md `@AGENTS.md` shim,
  `.agents/skills` + `.claude/skills` symlink, Claude-native subagents, validator).
- Caveat noted: the sandbox shell's cwd resets to that repo between commands, so every
  command in this project uses absolute paths.

## Phase 1 — research (complete)
- [x] Directories created (`agentconcord/`, `ideas/`).
- [x] FleetSmith located (v0.7.1, HEAD `5dde28b4` 2026-08-17, remote
  `subhransusekhar/fleetsmith`) — deep study delegated; report → `research/fleetsmith.md`.
- [x] Clone + study delegated: agent-smith, agent-sync, agentsync, hana, sync-skills →
  `research/sync-tools.md`; wshobson/agents, cc-agents, agents-skills-sync, Adobe guide →
  `research/agent-collections.md`.
- [x] Harness docs: Claude Code / Codex / OpenCode facts re-verified today with fixture
  probes → `research/harness-docs-claude-codex-opencode.md` (new findings: Codex follows a
  symlinked `AGENTS.md` file and per-skill symlinks; OpenCode follows `.opencode/agents`
  dir symlink and does not read `.claude/agents`; Claude follows a chained
  `CLAUDE.md -> AGENTS.md -> canon/AGENTS.md`; `opencode debug skill` can hang — wrap
  in a timeout).
- [x] Copilot / Cursor / Gemini CLI docs → `research/harness-docs-copilot-cursor-gemini.md`
  (all three read `.agents/skills` natively; Copilot+Cursor read `AGENTS.md`; Gemini needs
  `context.fileName` or a `GEMINI.md` shim; none documents symlink following; Windows
  breakage reports on all three).
- [x] Reports landed: `fleetsmith.md` (366 lines), `sync-tools.md` (497), `agent-collections.md` (299).
- [x] `research/PROJECT-COMPARISON.md` (11-column table + synthesis) and `research/SOURCE-LINKS.md`
  (exact revisions for 9 clones + fleetsmith, doc URLs, standards).
- Note: cc-agents is a byte-identical fork of wshobson/agents (0 ahead/0 behind) — not a separate data point.

## Phases 2–4 — discovery, architecture, product plan (complete)
- `001-product-vision.md` (problem, loop, non-goals, journeys, principles, v1 scope)
- `002-research-findings.md` (findings → decisions; adopted/rejected patterns; gaps; brief corrections)
- `003-architecture.md` (ownership classes, asset kinds, projection policy ladder, capability
  matrix as YAML data, owned files, module layout)
- `004-cli-and-yaml-design.md` (9 commands, action vocabulary + risk classes, manifest, ledger, exit codes)
- `005-migration-and-safety.md` (10 invariants, discovery mode, convergence rules per situation,
  quarantine, rollback/uninstall, cross-platform table, anti-drift)
- `006-validation-strategy.md` (structural / behavioral / self-test layers; audit rules A01–A13;
  live probes per harness; fixture matrix)
- `007-implementation-plan.md` (M0–M10 milestones, acceptance mapping, non-goals, risks)
- `docs/adr/ADR-0001-language-and-packaging.md` — TypeScript on Node (ESM, erasable syntax;
  `node --test` on `.ts` natively on Node ≥ 22.18 — verified locally with a probe test on
  v22.22.2; publish via `tsc` for Node ≥ 20; single runtime dep `yaml` 2.9.0).

## Phase 5 — independent design review (complete)
Read-only adversarial review over 12 axes. Verdict **APPROVE WITH CHANGES**, 54 findings
(7 blocking). All recorded with decisions in `008-design-review-and-changes.md`; 003/004/005/007
and ADR-0001 carry "Amendments (post-review)" sections. Headline changes: symlink-aware,
precondition-checked two-phase apply with a write-ahead journal; committed ledger split from
local state (platform, fallbacks, quarantine, journal); exact-match merges only (no
similarity-driven actions); per-skill links instead of whole-dir replacement; honest uninstall;
Codex agent adapter cut, OpenCode adapter opt-in, Gemini shim opt-in; exit codes and commands
trimmed; Windows CI added.

## Phases 6–7 — MVP and validation (in progress)
Implementation order follows 007 (as amended): M0 scaffold → M1 matrix+probe → M2 inventory →
M3 audit → M4 policy+plan → M5 apply+ledger+quarantine+journal+verify → M7 live probes →
M9 init → M8 OpenCode adapter → M10 dogfood/docs/CI.

## Decisions so far
- Date-scoped working docs under `dev_docs/2026-09-04/` (mirrors the convention that worked
  in the previous repo).
- Harness compatibility is treated as version-sensitive data; every fact carries an
  evidence class (doc / bin / test) and date.

## Decisions (design phase)
- Language: TypeScript/Node (ADR-0001). Rejected Go/Rust for install friction and YAML round-trip.
- Canonical content lives at the ecosystem paths (`AGENTS.md`, `.agents/skills`), not in a
  dedicated directory: 4–5 of 6 harnesses read them natively, so most projections are
  "native, nothing to do". A dedicated dir would force projections for everyone.
- No canonical subagent format; native files are the source, cross-harness forms are opt-in
  generated adapters.
- Shims (regular files) for Claude and Gemini instructions; never symlink an instruction file.
- Ledger committed; quarantine and journal gitignored via a managed block.

## Open questions (to the reviewer)
- Ledger merge conflicts in teams; stability of decision ids; Windows fallback soundness.
