# 007 — Implementation plan (MVP)

Language/runtime: TypeScript on Node.js (see `docs/adr/ADR-0001-language-and-packaging.md`).

## Repository layout (product)

```
agentconcord/
  package.json            name agentconcord, bin agentconcord, type module, engines node >= 20
  tsconfig.json           strict, erasable-syntax-only, outDir dist/
  src/                    see 003 §7
  matrix/                 claude.yaml codex.yaml opencode.yaml copilot.yaml cursor.yaml gemini.yaml + schema.yaml
  test/                   *.test.ts (node:test), fixtures/, helpers/
  docs/adr/               ADR-0001 language & packaging (more as decisions land)
  dev_docs/2026-09-04/    research + design + PROGRESS (this set)
  AGENTS.md               the product repo's own instructions (dogfooded via `agentconcord init` at the end)
  README.md
```

## Milestones (each ends with tests green)

| # | Milestone | Deliverable | Tests |
|---|---|---|---|
| M0 | Scaffold | package.json, tsconfig, `node --test` runner, `yaml` dep, CLI skeleton with `parseArgs`, exit codes, `--json` | smoke: `agentconcord --help`, `doctor` |
| M1 | Matrix + probe | `matrix/*.yaml` for 6 harnesses with evidence fields; loader + schema validation; platform probe (symlink/junction capability in a temp dir); `doctor` | matrix schema tests; probe test |
| M2 | Inventory | scanners for all surfaces in 005 §2; classifier (ledger-aware); frontmatter parser; vendored detection | unit + `inspect` on clean and messy fixtures (golden JSON) |
| M3 | Audit | rules A01–A13; paragraph similarity (normalized shingles, Jaccard); budgets from matrix | golden findings on messy fixture |
| M4 | Policy + plan | projection decision engine; action builder with ids, risk classes, reasons, evidence keys; `plan --json/--diff`; decisions persistence | golden plan on both fixtures; dry-run no-write test |
| M5 | Apply + ledger + quarantine + journal | single writer; land-before-remove; relative symlinks with cycle check; junction/copy fallback; managed blocks (AGENTS.md, .gitignore); shims; ADOPT command→skill; MOVE via `git mv` when tracked; ledger serialization stable | apply on fixtures → golden tree; idempotency; collision; rollback (fault injection); symlink/no-symlink |
| M6 | Verify + status + uninstall | structural verify (exit 4/5); tamper tests; `status`; `uninstall` reverse walk | tamper suite; uninstall restores |
| M7 | Live verification | probes for codex / opencode / claude (+ copilot/gemini list commands) with timeouts and result classes; nonce in managed block | opt-in live suite run on this machine (all three installed); recorded in PROGRESS |
| M8 | Generated agent adapters | claude → opencode (Markdown) and claude → codex (TOML + registration note); header marker; degradation list; source-hash staleness | golden outputs; stale-adapter detection |
| M9 | `init` UX | fresh-repo path (skeleton AGENTS.md, manifest, projections, verify); existing-repo path (audit+plan+prompt/approvals) | clean fixture end-to-end; messy fixture non-interactive path |
| M10 | Dogfood + docs | run `agentconcord init` on the product repo itself; README with the two-command story; `verify` in CI workflow | product repo verify passes |

## Acceptance (v1 success criteria mapped)

1. Truthful inventory → M2 golden tests on messy fixture.
2. Proposed convergence plan → M4.
3. Clear ownership explanation → ledger + `status` (M5/M6).
4. Safe changes after approval → M5 approvals, quarantine, journal.
5. Canonical architecture → AGENTS.md + .agents/skills after apply (M5).
6. Harness-native compatibility → projections per matrix (M4/M5) incl. Windows fallback path tested by policy override.
7. Validation that it works → structural verify (M6) + live probes against installed Claude/Codex/OpenCode (M7).
8. Drift detection → tamper suite + exit codes (M6); managed block routing.
9. Fresh repo minimal friction → M9 clean path.

## Explicit non-goals for the MVP

User-global surfaces; MCP/hook/settings merging; Copilot/Cursor/Gemini agent adapters;
interactive TUI beyond y/n prompts; plugin/marketplace formats; an LLM in the loop.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Matrix facts go stale with harness releases | facts carry versions/dates; `doctor` warns when an installed version is newer than `versionsVerified`; live probes catch regressions |
| Paragraph similarity produces noisy findings | conservative thresholds, evidence shown, findings never auto-act |
| Windows behavior untested on this machine | policy override tests (`symlinks: never`, probe-failure simulation) exercise the fallback code paths; documented as a validation gap |
| `git mv` unavailable (not a git repo) | fall back to fs rename with the same land-before-remove ordering |
| Scope creep into a sync/marketplace tool | non-goals above; every new projection must cite a matrix fact and a fixture |

## Amendments (post-review, see 008)
- M5 and M6 merge: apply, ledger, quarantine, write-ahead journal **and structural verify**
  land together (verify is the product's protection half, not an afterthought).
- M8 (adapters): Codex cut; OpenCode opt-in only; moved after M9.
- New in M5: two-phase precondition check; `lstat`-guarded writes; `symlink-entries`;
  `ADOPT-MANAGED`/`REPAIR`/`BACKPORT`; local state split; exact-match paragraph merge.
- New in M1: matrix `surfaces:` per harness; probe inside the repo; `posix|win32` platform key.
- New in M10: GitHub Actions matrix incl. `windows-latest` (junction/copy/CRLF paths).
- Cut from MVP: `status`, `plan --save`, `DEPRECATE`, `policy.budgets`, `.gitignore` block,
  `git mv`, A07–A10 similarity findings (report-only engine kept for A01's near-duplicate list).
