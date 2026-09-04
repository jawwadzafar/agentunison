# AGENTS.md — AgentConcord

Canonical instructions for coding agents working on AgentConcord itself (the CLI that
converges a repository's agent harness). Keep this file short; procedures go in
`.agents/skills/`, design and evidence live in `dev_docs/2026-09-04/`.

## Hard rules
- Never write outside the repository root or under `.git/`; the tool's own invariants apply to
  its development too (see `dev_docs/2026-09-04/agentconcord/005-migration-and-safety.md`).
- Every compatibility claim about a harness must cite evidence in `matrix/<harness>.yaml`
  (`evidence`, `checkedOn`, `platforms`). No folklore in code or docs.
- No feature lands without a fixture test; `npm test` must be green; `npm run typecheck` clean.
- Erasable TypeScript only (no enums/namespaces/parameter properties); relative imports carry `.ts`.
- Do not add runtime dependencies beyond `yaml` without an ADR under `docs/adr/`.

## Orientation
- `src/` — pipeline stages: `inventory/` → `audit/` → `policy/` → `plan/` → `apply/` → `verify/`;
  `matrix/` loader + platform probe; `adapters/` (shims, managed block, OpenCode agent adapter);
  `commands/` + `cli.ts` (thin). `model/types.ts` is the JSON output contract (schema 1).
- `matrix/*.yaml` — the capability matrix (data). Changing a fact = re-verify + update date.
- `test/` — unit, clean-repo, messy-legacy (`test/fixtures/make-messy.sh`), safety, opt-in live.
- Design + review record: `dev_docs/2026-09-04/agentconcord/001…008`, ADRs in `docs/adr/`.

## Commands
```bash
npm test                                  # all suites (node --test on .ts, Node ≥ 22.18)
npm run typecheck && npm run build        # tsc strict; emits dist/
AGENTCONCORD_LIVE=1 npm run test:live     # probes installed harness binaries (opt-in)
node --disable-warning=ExperimentalWarning src/cli.ts <cmd> --cwd <repo>   # run from source
```

## Verification expectations
- A change to plan/apply behavior adds or updates a fixture assertion in `test/messy.test.ts`
  or `test/safety.test.ts`; idempotency (`treeHash` before/after second apply) must hold.
- A change to a matrix fact is accompanied by the fixture/binary probe that established it.
- `node bin/agentconcord.js verify` on this repository must pass (CI runs it).

<!-- agentconcord:begin id=f3cbe27a -->
## Agent assets (managed by AgentConcord)
- Repository instructions: this file (`AGENTS.md`) is the only always-loaded instruction file. CLAUDE.md is a managed shim that imports this file — never add instructions there.
- Skills: `.agents/skills/<name>/SKILL.md` (Agent Skills spec: `name` = directory, precise `description`). Claude Code reads them through `.claude/skills` links — do not create skills there.
- Harness-native config (subagents, settings, hooks, rules) stays in each tool's own directory; it is inventoried, never converged.
- Check the layout with `agentconcord verify`; change it by editing `agentconcord.yaml` and running `agentconcord plan`.
agentconcord: f3cbe27a
<!-- agentconcord:end -->
