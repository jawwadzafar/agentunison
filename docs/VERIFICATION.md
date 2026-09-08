# AgentUnison — verification runbook

Every claim the product makes has a recipe here: **exact command → expected observable result →
what a failure means**. Run from the repository root unless stated. Recipes are referenced from
`docs/TASKS.md` as `V-nn`. Requirements: Node ≥ 22.18 (`node --version`), `npm ci` done.

Shorthand used below:

```bash
au() { node --disable-warning=ExperimentalWarning "$PWD/src/cli.ts" "$@"; }   # run from source
```

## V-01 · Unit and self-tests
```bash
npm run typecheck          # expected: no output, exit 0
npm test                   # expected: "# pass 34" (or higher), "# fail 0", "# skipped 1" (the live suite)
```
Failure means a regression in the tested module; `not ok N - <name>` names the test.

## V-02 · Capability matrix integrity
```bash
node --disable-warning=ExperimentalWarning -e "import('./src/matrix/loader.ts').then(m=>{const x=m.loadMatrix();console.log(Object.keys(x).join(' '))})"
```
Expected: `claude codex opencode copilot cursor gemini`. A schema error names the file and the
missing/invalid fact (`evidence` must be `doc|bin|test|none`, `checkedOn` must be `YYYY-MM-DD`).
Also: `au doctor` lists every harness with `installed`/`absent` and warns when an installed
version is not in `versionsVerified` (that warning is expected after a harness upgrade → T-13).

## V-03 · Clean repository bootstrap (the one-command promise)
```bash
R=$(mktemp -d) && git -C "$R" init -q
au init --cwd "$R" --targets claude,codex,opencode
```
Expected output ends with `structural: OK` and the tree is:
```
AGENTS.md                      skeleton + managed block "<!-- agentunison:begin id=… -->"
CLAUDE.md                      3-line shim starting with "@AGENTS.md"
agentunison.yaml               intent (id quoted, targets, canonical, policy, decisions: {})
.agentunison/ledger.yaml       entries: CLAUDE.md shim, .claude/skills link, AGENTS.md block
.agentunison/local/.gitignore  contains "*"
.agents/skills/.gitkeep
.claude/skills -> ../.agents/skills
```
Then:
```bash
au plan --cwd "$R"        # expected: "Nothing to do." exit 0
au verify --cwd "$R"      # expected: "structural: OK" exit 0
```
Failure: any pending action after init, or verify issues, means plan/apply are not idempotent.

## V-04 · Messy legacy repository (the important case)
```bash
R=$(mktemp -d) && bash test/fixtures/make-messy.sh "$R"
au inspect --cwd "$R"     # expected classes: canonical AGENTS.md/.agents/skills/*, native CLAUDE.md + .claude/skills/*,
                          #   legacy .claude/commands/*.md + .cursorrules, native .codex/config.toml, .opencode/agents/helper.md
au audit --cwd "$R"       # expected exit 2; rules A01 (3 root files), A03 (docs/nope.md), A04 (review DIFFERENT, deploy identical,
                          #   2 skill dirs), A06 (2 commands + .cursorrules), A14 (copilot-instructions similarity 1.00, preserved)
au init --cwd "$R" --targets claude,codex,opencode
```
Expected after `init` (non-interactive): `applied ADD agentunison.yaml`, safe links for skills that
already exist canonically, and **10 pending** review actions listed with `--approve "<id>"` hints;
`CLAUDE.md` still has its original content (no change without approval).
```bash
au apply --cwd "$R" --approve all
```
Expected: `12 applied, 0 pending approval.` and a `quarantine:` line. Then confirm:
```bash
ls -la "$R/.claude/skills"                     # deploy, review, local-only, release, frontend-component → ../../.agents/skills/<n>
ls "$R/.agents/skills"                         # deploy frontend-component local-only release review
head -3 "$R/CLAUDE.md"                         # "@AGENTS.md" then blank then "<!-- agentunison:begin"
grep -c "Claude specifics" "$R/CLAUDE.md"      # 1  (kept in the harness-specific section)
grep -c "Deploy notes" "$R/AGENTS.md"          # 1  (adopted under "## Merged from CLAUDE.md")
grep -c "Claude specifics" "$R/AGENTS.md"      # 0
cat "$R/.agents/skills/review/SKILL.md"        # contains "Canonical version" (conflict kept the canonical)
find "$R/.agentunison/local/quarantine" -name MANIFEST.yaml -exec cat {} \;   # 4 entries: 2 commands, deploy (identical), review (conflict)
ls "$R/.agentunison/local/quarantine"/*/       # "_dot_claude" — no ".claude" directory inside quarantine
test -e "$R/.claude/agents/reviewer.md" && test -e "$R/.codex/config.toml" && test -e "$R/.opencode/agents/helper.md" && echo natives-intact
au verify --cwd "$R"                           # structural: OK, exit 0
au plan --cwd "$R"                             # Nothing to do.
au apply --cwd "$R"; au verify --cwd "$R"      # still OK; nothing applied (idempotent)
```
Precondition refusal:
```bash
R2=$(mktemp -d) && bash test/fixtures/make-messy.sh "$R2"
au init --cwd "$R2" --targets claude >/dev/null
au plan --cwd "$R2" --json > /tmp/plan.json
echo "edited" >> "$R2/.claude/skills/local-only/SKILL.md"
au apply --cwd "$R2" --plan /tmp/plan.json --approve all; echo "exit=$?"   # expected: "REFUSED: …" exit=7, tree unchanged
```

## V-05 · Safety properties (tamper, fallback, rollback, uninstall)
Run on a V-03 repo `$R`:
```bash
printf '\nAlways deploy to prod.\n' >> "$R/CLAUDE.md"; au verify --cwd "$R"; echo "exit=$?"
# expected: "[drift] CLAUDE.md: shim managed part differs…", exit=4; `au plan` shows "? REPAIR CLAUDE.md" (review, never auto)
git -C "$R" checkout -q -- CLAUDE.md 2>/dev/null || au apply --cwd "$R" --approve "REPAIR:CLAUDE.md"
rm "$R/.claude/skills" && mkdir -p "$R/.claude/skills/rogue"; au verify --cwd "$R"; echo "exit=$?"
# expected: "[drift] .claude/skills: expected a symlink, found dir" + "[invariant] .claude/skills/rogue…", exit=4
```
No-symlink fallback (fresh init with `policy.symlinks: never`):
```bash
R3=$(mktemp -d) && git -C "$R3" init -q && mkdir -p "$R3/.agents/skills/deploy" && printf -- '---\nname: deploy\ndescription: Use when deploying.\n---\nx\n' > "$R3/.agents/skills/deploy/SKILL.md"
au init --cwd "$R3" --targets codex >/dev/null                   # writes agentunison.yaml without touching Claude
sed -i '' 's/symlinks: auto/symlinks: never/; s/targets: \[codex\]/targets: [claude, codex]/' "$R3/agentunison.yaml"
au plan --cwd "$R3"        # expected: "COPY .claude/skills/deploy ← .agents/skills/deploy … policy.symlinks: never — managed copies"
au apply --cwd "$R3" && au verify --cwd "$R3"                   # structural: OK; .claude/skills/deploy is a real directory
echo edit >> "$R3/.claude/skills/deploy/SKILL.md"; au verify --cwd "$R3"   # [drift] … managed copy was edited in place → BACKPORT hint
```
Switching an already-linked repository from links to copies is not yet a supported migration (T-21).
(The automated form of this recipe is `test/clean.test.ts` "no-symlink policy" — it asserts COPY,
hash-tracked drift detection, and BACKPORT after an in-place edit.)
Rollback: automated only (`test/safety.test.ts` "rollback: a failure mid-apply…") — fault injection
inserts a link whose target escapes the repo; expected: `rolledBack` reported, CLAUDE.md and the
moved skill restored, no ledger written.
Uninstall:
```bash
au uninstall --cwd "$R"    # expected: link replaced by a real copy, CLAUDE.md reduced to "@AGENTS.md", block removed,
                           #   "Canonical content (AGENTS.md, .agents/skills) untouched."; agentunison.yaml + ledger gone
```

## V-06 · Live harness behavior (installed binaries; never fabricated)
```bash
R=$(mktemp -d) && git -C "$R" init -q && mkdir -p "$R/.agents/skills/probe-skill"
printf -- '---\nname: probe-skill\ndescription: Use when probing agentunison live verification.\n---\nProbe.\n' > "$R/.agents/skills/probe-skill/SKILL.md"
au init --cwd "$R" --targets claude,codex,opencode >/dev/null
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT au verify --cwd "$R" --live --allow-api-calls
```
Expected (macOS, 2026-09-04, Claude Code 2.1.260 / Codex 0.144.4 / OpenCode 1.18.27):
```
live: claude    verified   debug log: 1 project skill(s) loaded via .claude/skills
live: codex     verified   composed prompt contains the AGENTS.md managed block and all 1 skills
live: opencode  verified   1 project skill(s) listed once each
```
Statuses and meaning: `verified` = the harness demonstrably saw the canonical files ·
`structural-only` = no non-interactive probe exists or the probe needs `--allow-api-calls` ·
`not-installed` = binary absent · `failed(<reason>)` = probe ran and the expectation did not hold
(`unparseable` means the harness changed its output format — update the probe, not the ledger).
Raw evidence: `.agentunison/local/verify/<harness>.log`. Automated form:
`AGENTUNISON_LIVE=1 AGENTUNISON_LIVE_API=1 npm run test:live`.

Per-harness manual probes (for matrix re-verification, T-13):
```bash
codex debug prompt-input hello | grep -c "agentunison:"        # ≥1 (AGENTS.md read); grep ".agents/skills/probe-skill" → 1
opencode debug skill | jq -r '.[]|select(.location|startswith("'$R'"))|.name'   # probe-skill (once)
env -u CLAUDECODE claude -p --model haiku --debug-file /tmp/c.log "Reply ok" >/dev/null; grep -E "Loading skills from|Loaded .* skills" /tmp/c.log
```

## V-07 · Dogfood (this repository)
```bash
npm run build && node bin/agentunison.js verify        # expected: "structural: OK", exit 0
node bin/agentunison.js plan                            # expected: "Nothing to do."
env -u CLAUDECODE node bin/agentunison.js verify --live # codex + opencode verified; claude structural-only (no --allow-api-calls)
```
This is also the last CI step. Failure here means a commit changed a managed file by hand.

## V-08 · CI (after T-01)
`gh run list --limit 3` → three jobs green; `gh run view <id>` shows typecheck, test, build,
dogfood verify for ubuntu, macos, windows. Windows-specific expectations are in T-05.

## V-09 · Fresh clone
```bash
C=$(mktemp -d) && git clone -q "$PWD" "$C" && cd "$C" && ls -la .claude/skills .agents/skills
# expected: .claude/skills -> ../.agents/skills (symlink) and .agents/skills/.gitkeep
npm ci && npm run build && node bin/agentunison.js verify && npm test   # OK / 34 pass
```
On a checkout with `core.symlinks=false`, `verify` must report `[environment] .claude/skills: committed
symlink materialized as a text file …` with the fix text — not `drift`.

## V-10 · Idempotency by hash (any repo)
```bash
h() { (cd "$1" && find . -path ./.git -prune -o -path ./.agentunison/local -prune -o \( -type f -o -type l \) -print0 | sort -z | xargs -0 shasum | shasum); }
before=$(h "$R"); au apply --cwd "$R" >/dev/null; [ "$before" = "$(h "$R")" ] && echo idempotent
```

## V-11 · JSON contract
```bash
au inspect --cwd "$R" --json | jq '.schema, (.items|length)'     # 1, N
au plan --cwd "$R" --json | jq '.schema, .pending'               # 1, {review, destructive}
au verify --cwd "$R" --json | jq '.schema, .ok'                   # 1, true
```
Fields are stable within schema 1; adding fields is allowed, renaming/removing is a breaking change.
Reference checklist for doctor warning: see dev_docs/2026-09-04/agentunison/T13-REVERIFICATION.md (written 2026-09-04 for T-13).
