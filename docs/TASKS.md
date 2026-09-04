# AgentUnison — task board

Every task here is self-contained: **goal → why → scope → steps → acceptance → validate → verify**.
Pick one, do the steps, run the validation commands, confirm the verification outcome, then
tick it in a PR. Definition of done is in `CONTRIBUTING.md`. Verification recipes referenced
as `V-nn` live in `docs/VERIFICATION.md`.

Status legend: `DONE` · `OPEN` · `BLOCKED(<on>)` · `DEFERRED`.
Size: S (< 2 h) · M (half day) · L (1–2 days).

## 0. What already exists (reference, all DONE at commit `85296e2` + rename)

| Id | Capability | Where | Verified by |
|---|---|---|---|
| D-01 | Capability matrix (6 harnesses, evidence-tagged) + loader + in-repo platform probe | `matrix/*.yaml`, `src/matrix/` | V-01, V-02 |
| D-02 | Inventory scanner + ownership classifier | `src/inventory/scan.ts` | V-03 |
| D-03 | Audit rules A01–A15 (report-only similarity) | `src/audit/rules.ts` | V-03 |
| D-04 | Projection policy ladder | `src/policy/decide.ts` | V-03, V-05 |
| D-05 | Plan builder (ids, risk, preconditions, dependsOn, merge, adopt) | `src/plan/build.ts` | V-03, V-04 |
| D-06 | Single-writer apply: two-phase preconditions, quarantine, journal, rollback, ledger | `src/apply/engine.ts` | V-03, V-04, V-05 |
| D-07 | Structural verify + live probes (Codex, OpenCode, Claude, list-skills) | `src/verify/` | V-02, V-06 |
| D-08 | Shims, managed block, OpenCode agent adapter | `src/adapters/` | V-01 |
| D-09 | CLI `init inspect audit plan apply verify doctor uninstall`, `--json`, exit codes | `src/cli.ts`, `src/commands/` | V-03, V-07 |
| D-10 | Test suites: unit, clean, messy-legacy, safety, live (opt-in) | `test/` | V-01…V-05 |
| D-11 | CI matrix (ubuntu/macos/windows) incl. dogfood verify | `.github/workflows/ci.yml` | V-08 |
| D-12 | Dogfood: this repo is managed by the tool | `AGENTS.md`, `CLAUDE.md`, `agentunison.yaml`, `.agentunison/ledger.yaml` | V-07 |

## 1. Release readiness

### T-01 · Push to GitHub and turn CI green on all three OSes — `OPEN` · S · owner
- **Goal:** the repo lives at a public/internal remote and `ci.yml` passes on ubuntu, macos, windows.
- **Why:** Windows behavior (junction fallback, CRLF hashing, `where`-based detection) is implemented but has never executed natively.
- **Scope:** no code unless CI fails; `.github/workflows/ci.yml`.
- **Steps:** create the remote → `git remote add origin <url>` → `git push -u origin main` → open Actions → fix any Windows-only failure in a PR.
- **Acceptance:** three green jobs; the `dogfood — verify` step passes on Windows (expect `environment` issues if the runner checks out without symlink support — that is a finding, see T-05).
- **Validate:** `gh run list --limit 3`, `gh run view <id> --log-failed`.
- **Verify:** V-08.

### T-02 · Publish `agentunison` to npm — `BLOCKED(T-01)` · S · owner
- **Goal:** `npx agentunison init` works from a clean machine.
- **Steps:** `npm login` → confirm `package.json` `files` covers `bin/ dist/ matrix/` → `npm run build` → `npm pack --dry-run` (inspect the file list) → `npm publish --access public` → in a temp dir: `npx agentunison@latest --help`.
- **Acceptance:** `npx agentunison init` on a clean temp git repo produces the V-03 clean tree.
- **Validate:** `npm pack --dry-run`, the temp-dir run.
- **Verify:** V-07 executed via `npx` instead of `node src/cli.ts`.

### T-03 · Reserve the name surfaces — `OPEN` · S · owner
- **Goal:** `agentunison` on npm (T-02), GitHub org/user, and `agentunison.dev/.io/.com` (all free as of 2026-09-04 DNS/registry checks).
- **Acceptance:** registrar confirmations recorded in `dev_docs/<date>/agentunison/PROGRESS.md`.

## 2. Correctness and safety

### T-04 · Journal resume for a partially applied plan — `OPEN` · M
- **Goal:** `agentunison apply --resume` finishes (or rolls back) a run that died between `intent` and `done`.
- **Why:** rollback covers exceptions inside the process; a killed process (power loss, Ctrl-C) leaves `intent` records with no reverse applied.
- **Scope:** `src/apply/engine.ts` (read the last journal, classify each `intent` record by inspecting the filesystem), `src/commands/index.ts` (`--resume`), `src/cli.ts`.
- **Steps:** (1) on `apply`, if the newest journal has an `intent` without `done` and no `rolled-back` record → refuse with exit 7 and the hint `--resume`; (2) `--resume`: for each incomplete record decide *completed-but-unmarked* vs *not started* from the filesystem (path type + hash vs the plan action) → either mark done or reverse; (3) then continue with the saved plan if `--plan` was given, else re-plan.
- **Acceptance:** fault injection test that kills mid-apply (spawn a child process running apply with an env var that triggers `process.exit(1)` after the MOVE) → `apply` refuses; `apply --resume` restores or completes; verify clean afterwards.
- **Validate:** `npm test` (new `test/resume.test.ts`).
- **Verify:** V-04 plus the new test; the journal's last record is `resumed` or `rolled-back`.

### T-05 · Windows: junction/copy fallback and symlink-hostile checkout paths — `BLOCKED(T-01)` · M
- **Goal:** on a Windows runner without Developer Mode: `init` chooses junction (dir) or copy, records the mechanism in `.agentunison/local/state.yaml`, prints the "do not commit" warning; `verify` reports `environment` (not `drift`) for a materialized committed symlink.
- **Scope:** `src/util/fs.ts` (`makeSymlink`), `src/apply/engine.ts`, `src/verify/structural.ts`, `test/` (Windows-only assertions guarded by `process.platform`).
- **Steps:** run the suite on Windows CI → collect failures → fix; add `test/windows.test.ts` that asserts fallback recording when `platform.symlinks === false`.
- **Acceptance:** CI green on windows; `doctor` shows `symlinks=false junctions=true` on that runner; a checkout with `core.symlinks=false` of a repo with a committed link yields `verify` exit 4 with code `environment` and the documented fix text.
- **Verify:** V-08, V-09.

### T-06 · Precondition drift for actions with empty preconditions — `OPEN` · S
- **Goal:** `ADD` shim after MOVE and dependent links carry a precondition on their *dependency's result* (destination must be missing at apply time is impossible to pre-check; instead verify at execution that the path is still missing and refuse otherwise).
- **Scope:** `src/apply/engine.ts` (`ADD`/`SYMLINK` cases: if target exists and is not what we expect → throw → rollback).
- **Acceptance:** test: create `CLAUDE.md` again between plan and apply of an only-CLAUDE.md MOVE chain → apply rolls back, nothing lost.
- **Verify:** V-04.

### T-07 · Case-insensitive filesystem collisions — `OPEN` · S
- **Goal:** two skills `Deploy` and `deploy` (possible on Linux) → audit finding A16 and plan refuses to project both onto a case-insensitive target dir.
- **Scope:** `src/audit/rules.ts`, `src/plan/build.ts`.
- **Acceptance:** unit test with both names present (create via `fs` on a case-sensitive FS or simulate through inventory items).
- **Verify:** `npm test`.

### T-08 · Ledger entry for a moved/renamed canonical skill — `OPEN` · S
- **Goal:** `verify` says "canonical moved: `.agents/skills/x` → likely `.agents/skills/y` (same hash)" instead of generic missing; `plan` offers `MODIFY ledger` to re-point the `adopted` entry.
- **Scope:** `src/verify/structural.ts`, `src/plan/build.ts`.
- **Acceptance:** test renames an adopted skill dir; verify message names the candidate; apply fixes the ledger with approval.

## 3. Harness coverage

### T-09 · Gemini CLI: verify the `GEMINI.md` `@./AGENTS.md` shim and `.agents/skills` discovery — `OPEN` · S · needs a Gemini install
- **Goal:** promote `matrix/gemini.yaml` facts from `doc`/`none` to `test`; drop `optIn: true` if the shim works.
- **Steps:** install `gemini`; fixture repo with `AGENTS.md` containing a nonce, `GEMINI.md` = `@./AGENTS.md`, one skill in `.agents/skills`; run `gemini -p "print the nonce"` and `gemini skills list --all`; record results + version + date in the matrix `note:` fields; add a live probe kind if a non-interactive instruction dump exists.
- **Acceptance:** matrix facts updated with `evidence: test`, `checkedOn`, `versionsVerified`; `verify --live` returns `verified` for gemini on the fixture.
- **Verify:** V-06 with `--targets claude,codex,opencode,gemini`.

### T-10 · Copilot CLI live probe — `OPEN` · S · needs `copilot` install
- **Goal:** `copilot skill list` probe validated; `.agents/skills` fact promoted to `test`.
- **Steps/Acceptance:** as T-09 with `copilot`; record whether AGENTS.md is read by the CLI (`copilot -p` with a nonce).

### T-11 · Cursor: structural-only stays honest — `OPEN` · S
- **Goal:** `verify --live` for cursor prints `structural-only` with the reason; `doctor` detects `agent`/`cursor-agent`.
- **Acceptance:** already the case; add a test asserting the status and reason text so it cannot regress.

### T-12 · Nested `AGENTS.md` / nested `CLAUDE.md` shims — `DEFERRED` · M
- **Goal:** for a nested `AGENTS.md` at `<dir>/AGENTS.md`, offer an opt-in nested `CLAUDE.md` shim (`@AGENTS.md`) for Claude when `claude` is a target.
- **Why deferred:** OpenCode's nested behavior is source-level only; Claude nested loading is lazy; needs fixture verification first (record in matrix).

### T-13 · Re-verification procedure when a harness releases — `OPEN` · S (recurring)
- **Goal:** a checklist that turns `doctor`'s "installed version differs" warning into updated matrix facts.
- **Steps:** run the fixture probes in `docs/VERIFICATION.md` §V-06 against the new version → update `versionsVerified`, `checkedOn`, and any changed fact → run `npm test` → PR titled `matrix: <harness> <version>`.
- **Acceptance:** PR contains only matrix + PROGRESS changes unless a behavior changed.

## 4. Product surface

### T-14 · Interactive approvals (TTY) — `OPEN` · M
- **Goal:** when stdin is a TTY and `--yes` is absent, `init`/`apply` prompt per review action group (`y/N/all/quit`), showing the diff for MODIFY.
- **Scope:** `src/commands/index.ts` (prompt helper using `node:readline/promises`), keep non-interactive path unchanged.
- **Acceptance:** manual run + a test that pipes answers through a pseudo-TTY is out of scope; instead unit-test the decision mapping (`answers → approve set`).
- **Verify:** V-07 manual step.

### T-15 · `--diff` output for every MODIFY/REPAIR in `plan` — `OPEN` · S
- **Goal:** `plan --diff` prints unified diffs for shims/blocks/merges (already produced; ensure REPAIR of block and ADOPT-MANAGED include diffs).
- **Acceptance:** golden test asserts `diff` field present for all MODIFY/REPAIR/ADOPT-MANAGED actions in the messy fixture.

### T-16 · Reconsider a recorded decision — `OPEN` · S
- **Goal:** `agentunison plan --reconsider <id>` removes the decision so the action is re-proposed; `preserve:` decisions can be lifted.
- **Scope:** `src/commands/index.ts`, `src/model/manifest.ts` (`saveManifestDecisions`).
- **Acceptance:** test: approve → reconsider → action reappears as `?`.

### T-17 · Propose the user's existing canonical skills dir — `OPEN` · S
- **Goal:** when `.agents/skills` is absent and a native skills dir is a symlink to another in-repo dir (e.g. `skills/`), `init` proposes `canonical.skills: skills` instead of forcing `.agents/skills`, with the trade-off stated (Codex/OpenCode/Copilot/Cursor read `.agents/skills` natively only).
- **Scope:** `src/commands/index.ts` (`cmdInit` target/canonical detection), `src/inventory/scan.ts`.
- **Acceptance:** fixture with `.claude/skills -> ../skills` → init output names the proposal and the degradation.

### T-21 · Mechanism switch on an already-managed repo (link ↔ copy) — `OPEN` · M
- **Goal:** changing `policy.symlinks` (or a `projections.<h>.skills` pin) on a repo that already has managed links produces a plan that replaces the link with copies (or vice versa) instead of COPY actions that refuse with "source and destination resolve to the same file".
- **Scope:** `src/plan/build.ts` (compare ledger mechanism vs decision; emit `QUARANTINE`-free `REPLACE` sequence: unlink managed link → COPY, or remove managed copies → SYMLINK), `src/apply/engine.ts` if a new op is needed.
- **Acceptance:** test: init with links → set `symlinks: never` → plan shows the switch as review actions → apply → verify OK → switch back → identical to the original tree.
- **Verify:** V-05 (fresh-init form still passes) + the new test.

### T-18 · Agent adapter: Claude → Copilot `.agent.md` — `DEFERRED` · M
- **Why deferred:** needs the Copilot field mapping verified live (T-10) and a decision on `tools:` translation.

## 5. Documentation and hygiene

### T-19 · Keep `README.md` claims in sync with tests — `OPEN` · S (recurring)
- **Goal:** every bullet in README §Safety model maps to a named test; add the test name in an HTML comment next to each bullet.
- **Acceptance:** `grep -c "<!-- test:" README.md` equals the number of safety bullets.

### T-20 · Publish the research as a standalone guide — `OPEN` · S
- **Goal:** move `dev_docs/2026-09-04/research/PROJECT-COMPARISON.md` + the harness matrices into `docs/harness-compatibility.md` with a "last verified" table generated from `matrix/*.yaml`.
- **Scope:** a small script `scripts/matrix-table.ts` that renders the table; CI check that the rendered table matches the committed one.
- **Acceptance:** `node scripts/matrix-table.ts --check` exits 0.

## Picking a task

1. Choose an `OPEN` task whose `BLOCKED(...)` prerequisites are done.
2. Create a branch `t-<nn>-<kebab>`.
3. Do the steps; add or update tests first when the task changes behavior.
4. Run the task's **Validate** commands and the referenced **V-nn** recipe; paste both outputs in the PR.
5. Update this file's status and `dev_docs/<date>/agentunison/PROGRESS.md`.
