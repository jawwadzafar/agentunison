# AgentUnison — progress record

Started 2026-09-04. Project root: `/Users/jawwadzafar/repo/jawwadzafar/agentunison`.
Research clones: `/Users/jawwadzafar/repo/jawwadzafar/ideas/`. Local reference (read-only):
`/Users/jawwadzafar/repo/subhranshu/fleetsmith`.

## Phase 0 — freeze previous work (done)
The previous repository (`~/cloned_repos/ai-gateway-platform`, branch
`chore/agent-harness-agents-md`, PR #304 open) was **frozen**: no git operations that alter it,
no file writes. Confirmed untouched at the end of this work (read-only `git status`). Every
command in this project used absolute paths because the sandbox shell resets its cwd there.

## Phase 1 — research (done)
- FleetSmith studied in place (v0.7.1, `5dde28b4` = upstream tip) → `research/fleetsmith.md`.
- Cloned + studied under `ideas/`: agent-smith, agent-sync, agentsync, hana, sync-skills
  (`research/sync-tools.md`); wshobson/agents, cc-agents (byte-identical fork), agents-skills-sync,
  Adobe harness guide (`research/agent-collections.md`). Exact revisions in `research/SOURCE-LINKS.md`.
- Harness docs re-verified with fixture probes on installed binaries → `research/harness-docs-*.md`.
- Synthesis → `research/PROJECT-COMPARISON.md` (11-column table; gaps that define the product).

## Phases 2–4 — discovery, architecture, product plan (done)
`001-product-vision.md` · `002-research-findings.md` · `003-architecture.md` ·
`004-cli-and-yaml-design.md` · `005-migration-and-safety.md` · `006-validation-strategy.md` ·
`007-implementation-plan.md` · `docs/adr/ADR-0001-language-and-packaging.md` (TypeScript/Node).

## Phase 5 — independent design review (done)
Adversarial read-only review, 54 findings (7 blocking). All decisions in
`008-design-review-and-changes.md`; 003/004/005/007 + ADR carry "Amendments (post-review)".
Headline changes: symlink-aware two-phase apply with preconditions and a write-ahead journal;
committed ledger split from local state; exact-match merges only; per-skill links instead of
whole-dir replacement; honest uninstall; Codex agent adapter cut, OpenCode adapter opt-in,
Gemini shim opt-in; commands/exit codes trimmed; Windows CI.

## Phase 6 — MVP (done) — commit `58784b9`, 67 tracked files
| Area | What was built |
|---|---|
| Matrix | `matrix/{claude,codex,opencode,copilot,cursor,gemini}.yaml` with `surfaces:` and evidence-tagged facts; `src/matrix/loader.ts` (schema validation, `verifiedFor(platform)`), `probe.ts` (in-repo symlink/junction/case probe) |
| Inventory | `src/inventory/scan.ts`: matrix-driven scanners, ledger-aware classifier (canonical / native / managed / unmanaged-compatible / legacy / vendored / foreign), exact-name matching, nested instruction files, foreign-marker and vendored-lock detection |
| Audit | `src/audit/rules.ts`: A01 divergent root files (exact shared paragraphs + report-only similarity), A02 budgets, A03 stale paths, A04 duplicate/conflicting skills, A05 spec lint (blocking/degraded/info), A06 legacy surfaces with the delete-test question, A07 cross-harness agents, A11 materialized links, A12 foreign markers, A13 vendored, A14 copilot-instructions (preserve), A15 literal shim reads |
| Policy | `src/policy/decide.ts`: native → shim → symlink-dir / symlink-entries → copy → none; every decision cites `harness.key[evidence date platforms]`; per-harness degradation text |
| Plan | `src/plan/build.ts`: stable ids `<op>:<path>[:detail]`, risk classes, preconditions (type + hash + link target), `dependsOn`, dependency-respecting order, decisions → pre-approved; merge of CLAUDE.md-only paragraphs (adopt vs keep-claude by vocabulary, overridable per paragraph); commands → skills with slugify; conflicts → QUARANTINE with explanation; REPAIR/BACKPORT/ADOPT-MANAGED |
| Apply | `src/apply/engine.ts`: single writer; phase 1 precondition check (refuse = exit 7, nothing written); lstat-guarded writes; realpath identity on MOVE/COPY; land-then-remove; quarantine with harness-neutral layout (`_dot_claude/…`) + MANIFEST.yaml; write-ahead journal; rollback of completed ops on failure; loud symlink→junction→copy fallback recorded in local state; committed ledger (`.agentunison/ledger.yaml`) has no machine facts |
| Verify | `src/verify/structural.ts` (ledger ↔ fs, invariants, spec; codes drift / block-damaged / environment / invariant / spec); `src/verify/live.ts` (Codex `debug prompt-input`, OpenCode `debug skill` under timeout, Claude `-p --debug-file` opt-in, `list-skills` for Copilot/Gemini; results verified / structural-only / not-installed / failed) |
| Adapters | `src/adapters/shim.ts` (pinned shim + harness-specific section, managed block ≤ 12 lines, CRLF-preserving upsert); `src/adapters/agents.ts` (Claude → OpenCode, dropped-field header, reserved-name refusal) |
| CLI | `init inspect audit plan apply verify doctor uninstall`, `--json`, exit codes 0/1/2/4/7; `bin/agentunison.js` over `dist/` |

## Phase 7 — validation (done, 2026-09-04)
| Check | Result |
|---|---|
| `npm run typecheck` | clean (strict, erasableSyntaxOnly, verbatimModuleSyntax) |
| `npm test` (node --test on .ts, Node v22.22.2) | **34 pass, 0 fail, 1 skipped (live, opt-in)** |
| unit | frontmatter/spec lint/slugify, paragraphs/similarity/diff, shim hash excludes harness-specific section, managed block idempotent + damage detection, matrix schema + `verifiedFor`, LF-normalized + content-only hashes, stable YAML, strict manifest (numeric-looking id coerced), OpenCode adapter |
| clean repo | init tree; byte-identical second apply; `plan` writes nothing; codex/opencode-only needs no shim/links; tamper (shim edit, link→dir, block markers) → verify 4; edited shim never overwritten by safe actions (REPAIR is review); `policy.symlinks: never` → copies + BACKPORT after in-place edit; uninstall leaves Claude working (links materialized, shim reduced, block removed, canonical kept) |
| messy legacy fixture (`test/fixtures/make-messy.sh`) | inventory classes; audit rules; plan ops (MOVE native-only skill, ADOPT two commands incl. namespaced rename, QUARANTINE identical + conflicting, per-skill links with `dependsOn`, MODIFY merge + to-shim, no DELETE); safe-only apply leaves nothing dangling; approve-all converges, verify clean, re-plan empty, quarantine complete and dot-free, decisions recorded; precondition refusal writes nothing; partial approval executes only the approved chain |
| safety | symlinked `CLAUDE.md → AGENTS.md` and `AGENTS.md → CLAUDE.md` never written through / moved onto themselves; only-CLAUDE.md MOVE keeps CRLF bytes; foreign marker → projection none; vendored lock → excluded; empty `.claude/skills` → dir link (new skills visible without re-apply); spec-violating skill preserved with reason; write-ahead journal; **rollback by fault injection restores CLAUDE.md and the moved skill, no ledger written** |
| live (`AGENTUNISON_LIVE=1 AGENTUNISON_LIVE_API=1`) on macOS | **claude verified** (debug log: project skills loaded via `.claude/skills` link), **codex verified** (composed prompt contains the managed-block nonce and every skill), **opencode verified** (skills listed once each) — Claude Code 2.1.260, Codex 0.144.4, OpenCode 1.18.27 |
| build | `tsc -p tsconfig.build.json` → `dist/`; `bin/agentunison.js --help` runs |
| dogfood | `agentunison init --approve all` on this repository: AGENTS.md (authored) + managed block, CLAUDE.md shim, `.claude/skills → ../.agents/skills`, ledger; `node bin/agentunison.js verify` OK; `verify --live`: codex + opencode verified, claude structural-only without `--allow-api-calls` |
| fresh clone | `git clone` of this repo: `.claude/skills` symlink and `.agents/skills/.gitkeep` survive; `tsc` build; `node bin/agentunison.js verify` → structural OK; 34 tests pass in the clone |

### Validation gaps (honest)
- Windows: junction/copy fallbacks and CRLF hashing are implemented and exercised via policy
  override and CRLF fixtures on macOS; native Windows CI (`windows-latest` in `.github/workflows/ci.yml`)
  first ran 2026-09-04 (run `33852363641`): ubuntu/macos green, windows failed 7 tests — see
  "Windows CI triage" below.
- Copilot, Cursor, Gemini: matrix entries + structural projections only; no binaries here except
  Cursor's `agent` (no non-interactive listing) — reported as `structural-only` / `not-installed`.
- Gemini `GEMINI.md` shim (`@./AGENTS.md`) unverified → target is opt-in.
- Interactive TTY prompting is minimal (non-interactive plan/approve is the primary path).

## Fixes found by tests during implementation (recorded for honesty)
init pre-wrote the manifest and then refused its own ADD (precondition working as designed) ·
YAML parsed a hex id like `83e51234` as a float (id now quoted + coerced) · shim ADD ran before
the MOVE of `CLAUDE.md` (explicit `dependsOn` + dependency-respecting order) · per-skill links
were created before their ADOPT (same fix) · managed block upsert normalized CRLF (now preserved)
· vendored-lock lookup was one level too shallow · empty `.agents/skills` not tracked by git
(`.gitkeep` on ADD) · managed block not ledgered on initial ADD.

## Rename (2026-09-04)
Renamed from AgentConcord to **AgentUnison** after checking 45 candidates against npm, PyPI, crates.io,
GitHub (users + repo-name search) and `.dev/.io/.com` DNS; `agentunison` was free on every surface
(so was `agentconcord`; the new name says the product idea — every agent reads one truth, in unison).
Rename covered package/bin, manifest `agentunison.yaml`, `.agentunison/`, markers
`<!-- agentunison:begin -->`, env vars `AGENTUNISON_*`, all docs and tests; the product repo was
unmanaged with the old tool and re-initialized with the new one; 34 tests pass; dogfood verify OK.
Task board and verification runbook added: `docs/TASKS.md`, `docs/VERIFICATION.md`, `CONTRIBUTING.md`.

## Windows CI triage (2026-09-04)
First Windows run (`33852363641`) failed 7 tests, one shared root cause, and it was test-side,
not product-side: on GitHub's windows-latest the in-repo probe reports `symlinks: false` (no
symlink privilege without Developer Mode), the policy then takes its designed conservative
branch — per-skill managed copies (all link-following evidence is `platforms: [posix]`; junction
stays an apply-time fallback per 003 §4) — while the tests asserted posix link outcomes
unconditionally (`SYMLINK:` op ids, `isLink`, relative `readlink` targets, `mechanism: link` in
the ledger, `unlinkSync` on the link).

Fixes (branch `t-01-windows-ci-green`):
- Tests branch on the probe result (`canSymlink(root)` helper), not `process.platform`, so a
  Developer-Mode Windows box still exercises the link path: `clean.test.ts` (init tree, tamper,
  uninstall), `messy.test.ts` (plan ops, converge, partial approval), `safety.test.ts`
  (empty-dir whole-dir link vs per-skill copies).
- New `test/windows.test.ts`: simulates the symlink-less probe on every host and locks the
  degradation contract — copy plan cites the probe, no `SYMLINK` ops, local state records
  `mechanism: copy` while the committed ledger stays machine-fact-free, verify clean, in-place
  copy edit → BACKPORT drift; a junction-style absolute link target passes verify only when
  local state records `junction` (drift otherwise); a committed link materialized as a text file
  (`core.symlinks=false` checkout) reports `environment`, never `drift`; copy-apply is idempotent.
- CI dogfood step now runs `scripts/dogfood-verify.mjs`: clean verify exits 0; an `environment`-only
  report (symlinkless checkout of the committed `.claude/skills` link) is tolerated with a loud
  note; anything else (drift, block-damaged, invariant, spec) fails the job. Verified all three
  paths against a scratch clone.

Still honest: no Windows machine has exercised `doctor` or a real junction with harnesses
installed; no `platforms: [win32]` matrix evidence exists yet (T-05 remains blocked on that).

## Remaining risks / follow-ups
- Symlink-hostile checkouts: `verify` reports `environment` with the fix; `apply` warns
  "do not commit" when a machine-local fallback replaces a committed link.
- Similarity findings are report-only by design; A07–A10 template heuristics deferred.
- `apply --plan <file>` executes a saved plan with its preconditions but does not yet resume a
  partially applied journal.
- Publish to npm (`npx agentunison`) and push to GitHub are pending the owner's go.
