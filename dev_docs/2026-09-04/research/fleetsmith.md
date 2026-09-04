# FleetSmith deep-study (reference for AgentConcord)

Date: 2026-09-04. Subject: local checkout `/Users/jawwadzafar/repo/subhranshu/fleetsmith` (read-only; the CLI and tests were exercised from a copy in the session scratchpad because the checkout has no `node_modules`).

**Purpose.** FleetSmith is studied as a *reference for product ideas* (bootstrap UX, spec-to-files compilation, plan/apply safety, per-harness adapters, capability mapping, QA battery, packaging) — not as a codebase to copy. AgentConcord's problem is different: *inspect an existing repo's harness setup, converge it to one canonical architecture, project it natively into each harness, validate real behaviour, prevent drift.* FleetSmith generates a **new** multi-agent "fleet" from a spec; it does not read or adopt existing harness files (see §5). That gap is the most important finding.

All citations are `path:line` in the fleetsmith checkout unless stated otherwise.

---

## 0. Provenance: local revision vs upstream

| Item | Value |
|---|---|
| Remote | `origin  git@github.com:subhransusekhar/fleetsmith.git` (fetch + push) — same project as `https://github.com/subhransusekhar/fleetsmith` |
| Local HEAD | `5dde28b4fb78f9dcd399ad8feacc445c117f22be`, 2026-08-17 20:57:54 +0400, "Merge pull request #140 from subhransusekhar/feat/release-download-proxy" |
| `git describe --tags` | `v0.7.1-2-g5dde28b` (two commits past the v0.7.1 tag) |
| Upstream tip (`git ls-remote https://github.com/subhransusekhar/fleetsmith`) | `HEAD` = `refs/heads/main` = `5dde28b4fb78f9dcd399ad8feacc445c117f22be` — **local == upstream tip, no divergence** |
| Tag `v0.7.1` | tag object `a3bb8605…`, peeled commit `e49142ce` (2026-08-16 21:49 +0400, "Merge pull request #139 … release/v0.7.1") |
| History | 177 commits; first commit `5169e35` 2026-07-04 "fleetsmith: meta agent-fleet builder for Claude Code, opencode, and goose" — roughly six weeks old |
| `package.json` | name `fleetsmith`, version `0.7.1`, `"type": "module"`, `engines.node >=18`, `bin.fleetsmith = ./src/cli.js` |
| Working tree | clean (`git status --short` empty); `node_modules/` absent so `node src/cli.js` fails with `ERR_MODULE_NOT_FOUND: yaml` until `npm install` |

---

## 1. Problem solved, product shape, commands

**Problem statement (theirs).** "Meta agent-fleet builder: compile one fleet spec into coordinated agent teams, skills, and handover protocols for Claude Code, opencode, and goose" (`package.json` description; `src/spec/schema.js:1-18` design principles). The value proposition is *write one `fleet.yaml`, get a working multi-agent harness in three tools*, plus a self-evolution loop (v0.5), memory backends (v0.6), and an AGPL enterprise "Intelligence Grid" (v0.7, under `ee/`).

**Product shape.** A single-file-dependency Node ESM CLI (`src/cli.js`, 886 lines) wrapping a pure compiler: `spec → normalizeSpec → validateSpec → adapter(spec) → FileSet → write`. Adapters are pure (no I/O) and return a `FileSet` (`src/lib/fs-utils.js:4-9`), which is what makes dry-run, drift-detection and testing trivial. Also shipped: a library API (`src/index.js`), an opencode plugin exposing the compiler as in-session tools (`src/opencode-plugin.js:11-24`), and standalone binaries.

**Commands** (verbatim from `node src/cli.js --help`, run from a scratchpad copy; source `src/cli.js:34-62`):

```
fleetsmith — meta agent-fleet builder

Usage:
  fleetsmith init [name] --pattern <p> [--domain "..."] [--out fleet.yaml]
  fleetsmith validate <fleet.yaml>
  fleetsmith qa <fleet.yaml> [--built DIR] [--target ...] [--installed]
  fleetsmith evolve <fleet.yaml> [--budget N] [--apply] [--model M] [--force]
  fleetsmith evolve <fleet.yaml> --review [--accept BRANCH | --reject BRANCH --reason R]
  fleetsmith protected <fleet.yaml> [--check-diff BASE] [--json FILE]
  fleetsmith health <fleet.yaml> [--json FILE]
  fleetsmith playbook <fleet.yaml> add|helpful|harmful|dedupe|show <agent> [text|id]
  fleetsmith eval <fleet.yaml> [--stage 1|2|3] [--fleets DIR] [--baseline FILE] [--calibrate] [--json FILE]
  fleetsmith eval <fleet.yaml> --judge [--ratings FILE] [--model M] [--concurrency N]   (advisory; gates nothing)
  fleetsmith eval <fleet.yaml> --exec [--target T] [--repeat N] [--fresh] [--concurrency N]  (live sessions; gates nothing)
  fleetsmith migrate-workspace <fleet.yaml> [--dry-run]
  fleetsmith patch <fleet.yaml> --ops ops.json [--dry-run] [--allow-contract-change]
  fleetsmith build <fleet.yaml> [--target claude-code|opencode|goose|all] [--out DIR] [--dry-run] [--force] [--force-preserved]
  fleetsmith install <fleet.yaml> [--target ...] [--scope project|user] [--into DIR] [--dry-run] [--force]
  fleetsmith patterns
  fleetsmith version

Patterns: pipeline, fanout, generate-verify, supervisor, expert-pool
Targets:  claude-code, opencode, goose, all
          claude-workflow (experimental; opt-in, not part of "all")

install scopes:
  project  install into a target app repo (default; layout the tools discover in a project)
  user     install reusable agents/skills/recipes into your user-global tool config
```

`fleetsmith --version` → `0.7.1`. Unknown verbs fall through to a plugin registry so an installed `fleetsmith-ee` can add commands (`src/cli.js:193-212`); the enterprise loader is fail-soft (`src/cli.js:115-155`).

Hand-rolled arg parser (`src/cli.js:867-886`): `--k v` or boolean `--k`; no `=` form, no short flags.

---

## 2. Canonical source of truth and what it generates

### 2.1 `fleet.yaml` — what it can express

Normalisation fills defaults in `normalizeSpec` (`src/spec/schema.js:80-148`); semantic checks in `validateSpec` (`src/spec/validate.js:17-192`) plus design lint (`src/spec/lint.js`). Reference doc: `docs/spec.md`.

| Block | Fields (source) |
|---|---|
| `version` | `1` (`schema.js:84`) |
| `fleet` | `name`, `domain`, `pattern` ∈ pipeline/fanout/expert-pool/generate-verify/supervisor/hierarchical (`schema.js:20-27`), `execution` ∈ team/subagents/hybrid (`:29`), `workspace` (default `_fleet`, split into `shared/` committed + `local/` gitignored, `:89-103`), `schedule {cron, interval, note}` (`:274-277`), `mcp {name → type,url|command,args,env}` (`:218-233`), `grid` (ee passthrough, `:108-112`), `allowParallelWrites` (`:113-115`) |
| `defaults` | `model` tier, `capabilities`, `claudeModels`/`opencodeModels`/`gooseModels` tier→id maps (`:117-132`) |
| `agents[]` | `name` (kebab), `role`, `goal`, `model` tier ∈ smart/fast/cheap/inherit (`:35`), `capabilities {read,edit,run,web,spawn}` (`:32`, `:73`), `skills[]`, `principles[]`, `prompt`, `effort` ∈ minimal/low/medium/high/max (`:44`), `turns` int cap, `hidden`, `memory`, `origin` human/evolved + `protected` (`:293-299`), `handoff {to[], protocol file/task/message, artifact, accepts[], criteria[], schema}` (`:175-201`; default 4-field schema `:66-71`) |
| `skills[]` | `name`, `description` (the only trigger), `body`, `references{}`, `scripts{}`, `assets{}`, `freedom` high/medium/low (`:47`), `triggers {should[], shouldNot[]}`, `evals[] {query, expect{mentions,notMentions,file}, grade}` (`:301-348`) |
| `orchestrator` | `name` (default `run-<fleet>`), `trigger`, `phases[] {name, mode, agents[], parallel, gate, loop{until,max,check,noProgress}}` — derived from pattern when omitted (`:137-140`, `:351-394`, loop `:258-265`) |
| `handover` | `strategy` file, `ledger` bool, `dir` (default `<local>/handoffs`) (`:142-145`) |

Validation errors/warnings are enumerated in `docs/spec.md:149-155`; notable: path-injection guard for `workspace`/`handover.dir` because they are interpolated into a generated shell hook (`validate.js:33-49`, `:198-204`); Agent Skills spec limits on skill names/descriptions (`validate.js:139-148`); parallel-writers is a hard lint **error** (`lint.js:53-68`); skill-description budget 1536 chars / 8000 total (`lint.js:19-27`, `:70-89`).

### 2.2 Outputs per target (exact paths, formats)

Combined `--target all` uses `buildAll` (`src/adapters/index.js:31-52`), which emits skills **once** to `.claude/skills/` (opencode and goose read that directory natively, `:27-30`) and dedupes shared files (AGENTS.md, workspace) by asserting identical content (`:42-45`).

**Claude Code** (`src/adapters/claude-code.js:11-18`, `:44-75`):

| Path | Format | Notes |
|---|---|---|
| `.claude/agents/<agent>.md` | Markdown + YAML frontmatter (`name, description, tools, model, skills, effort, maxTurns, permissionMode, memory, isolation, color, x-fleetsmith-origin`) | `:96-128` |
| `.claude/skills/<skill>/SKILL.md` (+ `references/`, `scripts/`, `assets/`, `evals/evals.json`) | Markdown + frontmatter (`name, description, allowed-tools, x-fleetsmith-origin`) | `:207-233` |
| `.claude/skills/<orchestrator>/SKILL.md` | orchestrator playbook skill with `argument-hint`, optional `disallowed-tools: AskUserQuestion`, and `` !`cmd` `` live-state injection | `:263-321` |
| `.claude/settings.json` | JSON: `permissions.allow[]` + `hooks.SubagentStop` | `src/adapters/claude-settings.js:31-74` |
| `.claude/loop.md` | only when `fleet.schedule` set | `claude-settings.js:199-218` |
| `CLAUDE.md` | **whole-file** pointer (Harness / Goal / Trigger / Handover gate / Changelog) | `claude-code.js:336-347` |
| `_fleet/local/handoffs/HANDOFF.template.md`, `_fleet/local/LEDGER.md`, `_fleet/shared/CHANGELOG.md` (preserve class), `_fleet/local/scripts/log-event.sh`, `_fleet/local/scripts/validate-handoff.sh` | Markdown / POSIX sh | `:323-334`, `:64-66` |

**opencode** (`src/adapters/opencode.js:11-20`, `:40-91`): `.opencode/agents/<agent>.md` (frontmatter `description, mode: subagent, temperature, model, variant, steps, hidden, permission{}`; `:93-111`), `.opencode/agents/<orch>.md` (`mode: primary`, `:148-165`), `.opencode/commands/<orch>.md` (`subtask: true`, `$ARGUMENTS`; `:167-179`), `.opencode/commands/fleet-status.md` (uses `` !`…` `` and `@file` inlining; `:223-249`), `opencode.json` (`$schema`, `default_agent`, `subagent_depth` 2 or 3, `instructions: [AGENTS.md]`, optional `compaction`, `small_model`, `mcp`; `:188-216`), `AGENTS.md` pointer (`src/compile/pointers.js:12-33`), same workspace files.

**goose** (`src/adapters/goose.js:12-22`, `:53-102`): `.goose/recipes/<agent>.yaml` (recipe v1.0.0: `title, description, instructions, prompt, parameters[task_brief], extensions[], settings{goose_model,max_turns}, response.json_schema`; `:104-165`), `.goose/recipes/<orch>.yaml` (with `sub_recipes[]`, `retry{}` when a phase loop has a shell `check`; `:232-293`), `.agents/checks/<verifier>.md` (`goose review` checks for verifier roles; `:175-204`), `AGENTS.md`, workspace files.

**claude-workflow** (experimental, opt-in, excluded from `all`): `.claude/workflows/<orch>.js` (`src/adapters/claude-workflow.js:6-49`).

Observed `build --target all` on a 3-agent pipeline: **24 files** (list in the scratchpad run; matches the table above).

### 2.3 Headers / markers on generated files

- Agent and skill frontmatter carry `x-fleetsmith-origin: human|evolved` (`claude-code.js:118-122`, `:219`) — provenance for the evolution loop, **not** a "do not edit" marker.
- Generated shell scripts start with a comment `# … (generated by fleetsmith)` (`claude-settings.js:111`, `src/compile/telemetry.js:55`, `src/compile/orchestrator.js:62`).
- `CLAUDE.md` / `AGENTS.md` carry prose: "append a row [to CHANGELOG] rather than editing this file, which is regenerated on every build" (`claude-code.js:345`; `pointers.js:31`).
- Nothing else: opencode/goose files have **no** generated-by marker; there is no managed-block delimiter anywhere.
- `mdWithFrontmatter` prunes undefined keys and normalises to `---\nyaml\n---\n\nbody\n` (`src/lib/md.js:8-12`), so output is byte-stable across builds ("pointers are byte-stable across rebuilds" test, `test/fleetsmith.test.js:1472`).

### 2.4 Are generated files meant to be committed?

Yes. `docs/architecture/multi-user-context.md:217` — "the compiled harness (`.claude/`, `.opencode/`, `.goose/`) … is derived output guarded by `fleetsmith qa --built` drift detection" and the layout at `:228-247`. `.gitignore:11-12` commits `_fleet/shared/` and ignores the rest of `_fleet/`. The repo's own meta-fleet output is committed (`.claude/`, `.opencode/`, `.goose/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `opencode.json` all tracked). CI enforces no drift on `main` (`.github/workflows/ci.yml:80-94`).

---

## 3. Handling EXISTING files at generation targets

All writing goes through one function, `FileSet.write` (`src/lib/fs-utils.js:37-59`):

```js
if (fs.existsSync(abs)) {
  if (isPreserved) { if (!forcePreserved) continue; }          // seeded once, fleet-owned
  else if (!force) {
    const existing = fs.readFileSync(abs, 'utf8');
    if (existing === content) continue;                          // unchanged, skip silently
    throw new Error(`Refusing to overwrite existing file: ${abs} (pass --force to overwrite)`);
  }
}
```

| Concern | Behaviour | Evidence |
|---|---|---|
| Overwrite | **Never silently.** Identical → skip; different → hard error unless `--force`; `--force` then replaces the whole file. | `fs-utils.js:42-52`; observed: after appending `# tampered` to `CLAUDE.md`, `build` exited 1 with the refusal; `--force` rewrote 23 files |
| Merge | **None.** No three-way merge, no section-level merge, no protected/managed blocks. A pre-existing user `CLAUDE.md` with unrelated content blocks the build; `--force` would clobber it. | observed in scratchpad `demo2`: `error: Refusing to overwrite existing file: CLAUDE.md`; `claude-code.js:336-347` emits the *entire* file |
| Backups | **None.** No `.bak`, no snapshot before `--force`. | `fs-utils.js` (no such code) |
| Collision detection | Within one build: `FileSet.add` throws on the same path written twice (`fs-utils.js:23-25`); `buildAll` throws when two adapters disagree on a shared file (`adapters/index.js:42-45`). Orchestrator/agent name collision is handled explicitly per adapter (`opencode.js:43-58`, `goose.js:56-64`) and warned by the validator (`validate.js:70-75`). Against the *environment*: `qa --installed` scans `~/.claude` and `./.claude` for rival/shadowed skills and agents (`src/qa/installed.js:46-51`, `:128-224`). | |
| Dry-run | `build --dry-run` and `install --dry-run` list paths only (`cli.js:766-770`, `:789-791`); `patch` defaults to dry-run when stdin is not a TTY (`cli.js:361`); `migrate-workspace --dry-run` (`cli.js:315-318`). | |
| Idempotency | Rebuild of unchanged spec writes 0 files (observed: `wrote 0 files`). Byte-stability is enforced by keeping run-varying data out of prompts (`src/compile/agent-prompt.js:10-15`, `telemetry.js:22-24`). | |
| Preserve class | `CHANGELOG.md` is seeded once and never overwritten even with `--force`; `--force-preserved` is the explicit opt-out (`fs-utils.js:12-19`; adapters mark it `{ preserve: true }`, e.g. `claude-code.js:328-332`). The flag survives `buildAll` and `planInstall` merges (`adapters/index.js:48`, `install.js:90`). | |
| Escape hatches not exposed | Adapters accept `options.claudeMd === false` / `options.agentsMd === false` to skip the pointer files (`claude-code.js:70`, `opencode.js:86`, `goose.js:97`), but **no CLI flag sets them** — a user who already owns `CLAUDE.md` has no supported path other than `--force`. | |

**Editing the spec itself** is treated as a first-class safety surface: `fleetsmith patch` applies typed ops through the YAML Document API so comments/key order survive, refuses protected targets, is all-or-nothing, and prints a unified diff (`cli.js:333-393`; `docs/spec.md:157-179`).

---

## 4. Capability → permission mapping per adapter; graceful degradation

Abstract capabilities: `read, edit, run, web, spawn` (`schema.js:32`), default `{read: true}` (`schema.js:73`).

### Claude Code (`src/adapters/claude-code.js`)

- `TOOL_MAP = { read: [Read, Grep, Glob], edit: [Write, Edit], run: [Bash], web: [WebSearch, WebFetch], spawn: [Agent] }` (`:20-26`); `Read` is always included (`:201`); tools Claude strips from subagents are filtered out (`SUBAGENT_FORBIDDEN_TOOLS = AskUserQuestion, ExitPlanMode, Workflow`, `:42`, `:204`).
- `permissionMode`: edit → `acceptEdits`; no edit and no run → `plan`; otherwise omitted (`:181-185`).
- `effort` tiers map near-verbatim, `minimal` collapses to `low` (`:32`); `turns` → `maxTurns`; `memory` → `memory: project`; parallel editors → `isolation: worktree` unless `allowParallelWrites` (`:97-101`, `:135-145`).
- Project `settings.json` allowlist is derived from the *union* of agent capabilities: `Read, Grep, Glob`, `Edit(<workspace>/**)` always, then `Write, Edit` / `Bash` / `WebSearch, WebFetch` if any agent has the capability, plus scoped `Bash(sh <validator>:*)` grants (`claude-settings.js:31-50`). Documented gotcha found by live execution: Claude Code matches scoped file permissions against `Edit(path)` rules only, `Write(path)` is inert (`:39-45`).
- Skills get `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/<f> *)` per bundled script (`:240-244`).

### opencode (`src/adapters/opencode.js:129-146`)

```
read: allow
edit: caps.edit ? allow : { '*': deny, '<workspace>/**': allow }   // handoffs stay writable
bash: run ? allow : deny
webfetch/websearch: web ? allow : deny
task: (spawn || handoff.to.length) ? { '*': deny, <each handoff target>: allow } : deny
skill: skills.length ? { '*': deny, <each attached skill>: allow } : deny
```

The handoff graph is compiled into `permission.task` and skill attachments into `permission.skill`, which the adapter notes makes both *enforced* rather than advisory (`:22-25`, `:118-128`). Orchestrator gets `mode: primary` with `task` allowing exactly the fleet's agents (`:156-161`). `effort` → `variant` only for `high`/`max`; lower tiers omitted because opencode has no built-in variant (`:32-38`). `turns` → `steps`. `hidden` honoured.

### goose (`src/adapters/goose.js`)

- goose has no per-tool permissions; capabilities map to *extensions*: `developer` always (needed to write handoffs), `run`/`edit` → `developer`, `web` → `computercontroller`, `spawn` → platform `summon` (re-injected because declaring `extensions:` suppresses defaults) (`:47-51`, `:214-230`).
- Read-only intent becomes a **prose** "Access constraint" clause, explicitly not a sandbox (`:24-27`, `:206-212`).
- `turns` → `settings.max_turns`; `effort` ignored (`schema.js:39-43`); `handoff.schema` → native `response.json_schema` (`:151-165`); `loop.check` → native `retry` block (`:285-293`); parallelism must be requested in the *prompt* because no YAML key exists (`:260-277`).

### Graceful degradation summary

| Feature | Claude Code | opencode | goose |
|---|---|---|---|
| Per-tool permission | native allowlist + settings.json | native `permission` map | prose only |
| `team` execution | native (experimental teams) | degrades to primary + subagents (`opencode.js:27-30`) | degrades to sub_recipes |
| `effort` | native | `high`/`max` only | dropped |
| Handoff contract gate | SubagentStop hook (deterministic) | `permission.task` + prose | `response.json_schema` + `retry` |
| Loop `check` | prose (+ workflow target) | prose | native `retry` |
| `memory` | `memory: project` | prose "Durable notes" (`agent-prompt.js:65-71`) | prose |
| `hidden` | no-op | native | no-op |
| MCP servers | **not emitted** (see below) | `opencode.json.mcp` (`opencode.js:204-213`) | **not emitted** |

**Doc/code drift found:** `docs/spec.md:29` and `schema.js:213-217` state `fleet.mcp` "compiles to `.mcp.json` (Claude Code), `opencode.json` `mcp`, and goose recipe `extensions`", but `grep -rn "fleet\.mcp" src` hits only `src/adapters/opencode.js:204-206`. The Claude Code and goose adapters silently ignore `mcp`. A lesson for AgentConcord: every "we project X into harness Y" claim needs a compile-check test per target.

---

## 5. Repository analysis / discovery — does it inspect an existing repo?

**No, not in code.** There is no module that reads an existing repo's `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `.opencode/`, `.goose/`, `.agents/skills`, or anything else in a target project to seed or adapt a spec.

- `fleetsmith init` writes an **archetype template** chosen by `--pattern` with the `--domain` string interpolated (`cli.js:222-238`; templates in `src/patterns/index.js:7-113`). It refuses to overwrite an existing `fleet.yaml` without `--force` (`cli.js:228-230`). It does not look at the repo.
- **The "domain-analyst" flow is entirely LLM-side.** The repo's own meta-fleet (`fleet.yaml:24-38`) defines a `domain-analyst` agent with `read + web` capabilities whose `domain-decomposition` skill instructs it to do reconnaissance by hand, including the row "What automation exists? → `.claude/`, `.opencode/`, `.goose/`, `AGENTS.md`, `CLAUDE.md`" and a required "existing harness inventory … so the new fleet extends rather than collides" (`fleet.yaml:34-36`, skill body table under "## 1. Reconnaissance"). That is a prompt, not a tool: the analysis quality depends on the model, and nothing is machine-checked.
- **The bootstrap prompt** (`docs/assets/bootstrap-prompt.txt`; README §"One-paste start") is a pasted instruction to Claude Code: check `node`/`git` versions; `git clone --depth 1` the fleetsmith repo and copy its `.claude/` into the current folder, delete the clone; run the CLI with `npx --yes github:subhransusekhar/fleetsmith …` (binary fallback if no Node); ask **one** question ("what domain or project should this agent fleet target?"); then `init → show fleet.yaml → validate → build --target all`; finally explain how to run in each tool. It is explicitly for an **empty** folder ("Set up fleetsmith in this empty folder"). Constraint: never install globally.
- **No "adopt existing files" logic.** The nearest things: (a) `qa --installed` reads `./.claude/{skills,agents}` and `~/.claude/{skills,agents}` frontmatter to detect *rival* skills (same vocabulary, different name) and *shadowed* copies (same name, other scope) — a real, well-motivated ambient-hygiene check (`src/qa/installed.js:14-43`, `:83-115`, `:128-224`); (b) `install --scope user` deliberately *skips* shared singletons (`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `opencode.json`, `.claude/loop.md`, `_fleet/`, `.agents/checks/`) so it never clobbers user-global config (`src/install.js:33-62`); (c) `detectTools` probes `~/.claude`, `~/.config/opencode`, `~/.config/goose` or PATH binaries, purely informational (`install.js:100-115`).
- The opencode plugin adds an `autobuild` hook (`file.edited` on `fleet.yaml` → rebuild) — opt-in via `FLEETSMITH_OPENCODE_AUTOBUILD=1` (README §"Use fleetsmith inside opencode"; test `fleetsmith.test.js:1390`).

Conclusion for AgentConcord: FleetSmith is a *greenfield generator*; the inspect/understand/converge half of AgentConcord's problem has no counterpart here except the ambient-install scanner and the LLM reconnaissance checklist.

---

## 6. Validation / QA: what is actually checked and how

| Command | What it checks | Deterministic? | Source |
|---|---|---|---|
| `validate` | Structural + semantic rules (enums, kebab names, unknown handoff targets/skills, graph cycles/orphans, Agent Skills limits, safe paths, MCP shape, loop bounds) then lint smells (parallel writers, description budgets, first-person descriptions, missing "use when", Windows paths, dated wording, unqualified `mcp__` refs, chained references, same-context phases) | yes | `src/spec/validate.js:17-192`, `src/spec/lint.js:29-166` |
| `qa` | The gate battery: spec gate, design lint, **compile per target** (adapter must not throw and must emit >0 files), **handoff graph on compiled output** (receiver has an agent file; unreachable agents), **capability leaks** (Claude Code `tools:` frontmatter vs declared caps — Claude Code only), **loop bounds** (max/until/noProgress all present), **origin markers** (frontmatter matches spec), and with `--built DIR` **drift** (recompile with the same playbooks and compare on disk; preserve-class files exempt; missing `local/` tier tolerated, differing local file still reported; CRLF-normalised) | yes, no LLM | `src/qa/index.js:33-46`, `:74-84`, `:92-117`, `:124-146`, `:153-163`, `:171-185`, `:203-232` |
| `qa --installed` | Ambient rival/shadow scan of `./.claude` + `~/.claude`; advisory, never part of the gate because it is machine-dependent | yes | `src/qa/installed.js`, `cli.js:259-268` |
| `eval` (stage 1/2/3) | (1) **Trigger tests**: each `triggers.should` prompt is scored by IDF-weighted vocabulary overlap against every skill description; intended skill must win, ties reported (`src/eval/index.js:64-80`; honest-limits note `:26-33`); (2) **eval fleets**: held-out specs under `test/eval-fleets/` built and checked against `expect:` blocks (`test/eval-fleets/README.md`); `--calibrate` measures a noise floor; `--baseline` compares | yes | `src/eval/index.js:37-58` |
| `eval --judge` | LLM rubric grading of skills; advisory, "gates nothing", exit code never set; kappa agreement vs human ratings | no | `cli.js:714-740`, `src/eval/judge.js` |
| `eval --exec` | **Live harness sessions.** Runners: `claude -p <query>`, `opencode run <query>`, `goose run --recipe .goose/recipes/<orch>.yaml --params task_brief=<query>` (`src/eval/exec.js:50-65`); binary presence via `command -v` (`:67-76`); per-case 120 s timeout (`:94`); deterministic assertions `mentions`/`notMentions`/`file` (`:183-206`); detects Claude's "has not been trusted" warning and reports the case as *skipped* because an untrusted workspace has no settings.json gate (`:47`, `:195-204`); `--fresh` builds into a temp dir per case; `--repeat` computes a flip-rate floor (`:240-258`). Never gates (`:19-24`). | no | |
| `health` | Aggregates `_fleet/local/runs/*/events.jsonl` into per-agent utility/failure-risk/validation-gap, per-skill redundancy (token overlap), ΔH early-exit; no LLM | yes | `src/health/index.js:45-119` |
| `protected --check-diff BASE` | Refuses evolution branches touching hard-coded referee paths (`src/spec/**`, `src/qa/**`, `src/eval/**`, `test/**`, workflows, the handover gate, key docs) | yes | `src/evolve/protected.js:39-55`, `:94-112` |

**"protocol grid"** = `test/protocol-grid.test.js`: five tests asserting that the handover protocol's grid-awareness section is compiled into all three targets only when the spec has a `grid:` block and is byte-absent otherwise (`test/protocol-grid.test.js:10-16`, `:32-91`). It is about the enterprise grid feature, not a general validation matrix.

**Real-harness smoke tests.** Yes, but opt-in only: `test/grid-eval-exec.test.js:41` gates two live Claude Code sessions behind `FLEETSMITH_GRID_EVAL_LIVE=1` and `runnerAvailable('claude-code')` (`:119-151`). In the default `npm test` they show as skipped. Measured in the scratchpad copy: `node --test` → **791 tests, 759 pass, 0 fail, 32 skipped, ~13.6 s** (skips are the live/opt-in cases and ee fixtures).

**CI** (`.github/workflows/ci.yml`): `test` matrix ubuntu/macos/windows × Node 18/20/22; `qa` job runs `node src/cli.js qa fleet.yaml --built .` and `eval fleet.yaml --stage 2` on the repo's own meta-fleet (`:80-94`); `protected-paths` job on `fleet-evolve/*` branches (`:61-72`); a RelataDB live job that self-skips without a registry token. Note `contract-pin.yml` comments (~line 588) record that the `ci` workflow was **disabled at the GitHub level on 2026-08-16** to save runner time.

---

## 7. Enforcement: hooks and permission maps

**Claude Code — the only deterministic runtime gate** (`qa/index.js:11-13` says so explicitly).

- `.claude/settings.json` registers one `SubagentStop` hook with `matcher: "<agent1>|<agent2>|…"` running `sh "$CLAUDE_PROJECT_DIR/_fleet/local/scripts/validate-handoff.sh"`, timeout 15 s (`claude-settings.js:56-69`).
- The gate script (`claude-settings.js:89-177`) reads the hook JSON on stdin, extracts `agent_type` with `sed`, and: exits 0 for unknown or terminal agents; **exit 2** (blocks the stop and feeds stderr back as instructions) when no `<dir>/*-<agent>-to-*.md` handoff exists, when any required section heading (from `handoff.schema` or the default four fields, `:99-108`) is missing (`grep -qi "^#\{1,6\}[[:space:]]*<Section>"`, `:150-152`), or when the ledger has no row mentioning the agent (`:162-173`). Every verdict is logged via `log-event.sh` but telemetry is fail-soft and never changes the verdict (`:125-128`).
- Caveat the tool itself documents: project hooks are inert until the workspace trust dialog is accepted, so the gate silently degrades to advisory (`claude-settings.js:17-20`; surfaced in the generated `CLAUDE.md`, `claude-code.js:343`; `eval --exec` refuses to measure untrusted workspaces, `exec.js:32-39`).
- Defence in depth: the interpolated dir is single-quote-escaped (`:92-97`, `:184-186`) even though `validateSpec` already rejects unsafe paths; a test injects shell metacharacters (`fleetsmith.test.js:579`).

**opencode** — contracts enforced through the permission model, not hooks: `permission.task` limits delegation to the handoff graph (a denied subagent is dropped from the task tool's description, `opencode.js:124-127`), `permission.skill` limits methodology, `edit` is denied everywhere except the workspace for read-only agents (`:134`), and `opencode.json.subagent_depth` is raised to 2/3 because the default 1 silently disables nested delegation (`:181-193`). Long-running fleets get `compaction: {prune: true, tail_turns: 4}` (`:196-200`).

**goose** — `response.json_schema` makes goose validate the final message and re-prompt on non-conformance (`goose.js:144-165`); `retry` block re-runs the recipe until shell checks pass (`:279-293`); `.agents/checks/*.md` run as parallel `goose review` checks (`:167-204`).

**Cross-target** — the same protocol prose is compiled into every agent body (`src/handover/protocol.js:120-178`), and the orchestrator playbook tells the coordinator to verify handoff files exist before the next phase (`src/compile/orchestrator.js:165`). Telemetry (`log-event.sh`) records `gate_pass`/`gate_block` events in OpenTelemetry-GenAI-flavoured JSONL (`src/compile/telemetry.js:27-40`, `:52-110`).

---

## 8. Symlinks, Windows, `ee-selflink`

- **Generated output uses no symlinks** (`find . -type l` on the checkout returns nothing; `grep -rni symlink src` only hits a comment in `pointers.js:10` noting Claude Code reads `AGENTS.md` "only via @import or symlink"). Skills are shared across tools by *emitting once* into `.claude/skills/` and relying on opencode/goose reading that directory natively — not by linking (`adapters/index.js:27-30`, `goose.js:35-37`).
- **`scripts/ee-selflink.mjs`** is a dev-only `pretest` script (`package.json` `"pretest"`). It creates `node_modules/fleetsmith → <repo root>` so the AGPL `ee/` tree can `import 'fleetsmith/...'` by package name exactly as a real customer install would, instead of a relative path across the licence boundary (`ee-selflink.mjs:2-19`). It is idempotent, replaces a stale link, and uses `fs.symlinkSync(root, link, 'junction')` because junctions work on Windows without admin/Developer Mode while POSIX ignores the type (`:29-39`). Failure only warns (`:40-42`).
- **Windows handling elsewhere:** CI runs `windows-latest`; drift check normalises CRLF (`qa/index.js:219-232`); `detectTools` uses `where` on win32 (`install.js:103`); `publish-check` spawns `npm.cmd` with `shell: true` because `.cmd` shims cannot be `execFile`d (`publish-check.mjs:18-25`); `build-binary` invokes postject's JS entry via `node` for the same reason and emits `fleetsmith.exe` (`build-binary.mjs:115-122`, `:51-54`); lint warns on Windows-style paths in skill bodies (`lint.js:104-106`).
- **Not handled:** the emitted `SubagentStop` hook command is `sh "$CLAUDE_PROJECT_DIR/…/validate-handoff.sh"` and the telemetry logger is POSIX `sh` — nothing addresses a Windows host without `sh`, and the `where`-based probe is the only Windows accommodation in the runtime path.

---

## 9. Packaging / runtime and lessons for a single install experience

| Aspect | Value |
|---|---|
| Runtime | Node ≥ 18 (`package.json` engines), ESM (`"type": "module"`), Node 22 used in CI/release |
| Dependencies | **1 runtime** (`yaml ^2.9.0`), **2 dev** (`esbuild ^0.28.1`, `postject ^1.0.0-alpha.6`), 1 optional peer (`@opencode-ai/plugin`) |
| Tests | `node --test` (built-in runner); `pretest` = self-link; 791 tests across 11 files, largest `test/fleetsmith.test.js` (3997 lines) |
| Binary | esbuild bundles `src/cli.js` + `yaml` to one CJS file with `__FLEETSMITH_VERSION__` injected and `import.meta.url` defined as `undefined` (`scripts/bundle.mjs:11-35`); then **Node SEA**: write `sea-config.json`, `node --experimental-sea-config`, copy `process.execPath`, on macOS `lipo -thin` + `codesign --remove-signature`, detect the `NODE_SEA_FUSE_*` sentinel from the binary, inject with `postject`, ad-hoc re-sign, `chmod 755` (`scripts/build-binary.mjs:60-134`). Intel macOS is **cross-built on the arm64 runner** by downloading the matching official node tarball, because Intel runners queued for 24 h (`build-binary.mjs:9-16`, `:144-161`; `release.yml:15-19`). Not `pkg`. |
| Release | tag `v*` → `release.yml`: `npm ci`, `npm test`, `build:binary`, **`smoke:binary`**, attach `fleetsmith-linux-x64`, `fleetsmith-macos-arm64`, `fleetsmith-macos-x64`, `fleetsmith-windows-x64.exe`; npm publish only if `PUBLISH_NPM=true` (not on the npm registry as of README §Installation) |
| Install channels | (A) download binary; (B) `npm install -g github:subhransusekhar/fleetsmith#v0.7.0`; (C) `npx --yes github:subhransusekhar/fleetsmith …`; (D) clone + `npm link`; (E) `curl -fsSL https://infinia-harness.adid.dev/install.sh \| sh` (POSIX sh installer covering OSS + EE, env/flag/prompt precedence, non-interactive defaults, `website/public/install.sh:1-60`); (F) the Claude Code bootstrap prompt |

**Lessons recorded in their own postmortem** (`CHANGELOG.md` §0.7.1; `scripts/smoke-binary.mjs:3-14`): every v0.7.0 binary was dead on arrival because `createRequire(import.meta.url)` ran on every command and esbuild leaves `import.meta` empty in CJS output; `npm test` exercised the ESM sources and could not see it. Fixes: route all `import.meta` through one `MODULE_URL` null-able constant (`cli.js:98-113`), make esbuild's `empty-import-meta` warning a build **error** (`bundle.mjs:32-35`), always re-bundle (`build-binary.mjs:60-69`), and **run the built artifact** (`version`, `patterns`, a real `init → validate → build --target all` in a temp dir, non-zero exit on unknown command) before attaching it to a release (`smoke-binary.mjs:64-117`). Also `publish-check.mjs` verifies tarball contents and licence boundaries without publishing.

Takeaways for AgentConcord: one runtime dependency and a pure core make SEA feasible; the artefact you ship must be executed in CI; "zero install" via `npx github:` plus a paste-able bootstrap prompt is a cheap, effective onboarding path; the `install --scope user|project` split with an explicit skip-list and detected-tools banner is a good UX shape.

---

## 10. Manifest / state / uninstall

- **No manifest of generated files.** `FileSet.write` returns the written paths to the caller (`fs-utils.js:38`, `:56-58`) and the CLI prints them, but nothing is persisted. Ownership is recovered by **recompiling the spec** and comparing (`qa --built`, `qa/index.js:203-230`), which requires the spec and the same playbook inputs; a file the spec no longer produces (renamed agent) is *not* detected as orphaned — there is no "stale generated file" check.
- **No `uninstall`/`revert`/`clean` command.** Removal is manual. `--scope user` at least documents what it wrote and skipped (`install.js:69-93`).
- **State that does exist** (all under `_fleet/`, two tiers, `schema.js:89-103`; `docs/architecture/multi-user-context.md:228-247`): committed `shared/` — `CHANGELOG.md` (preserve class), `playbooks/<agent>.md` (learned bullets with stable ids and counters), `evolution/decisions.jsonl`, `evolution/proposals/*.md`, `evolution/protected.json`, `evals/noise.json`; gitignored `local/` — `LEDGER.md`, `handoffs/`, `runs/<actor>-<ts>/events.jsonl`, `health.json`, `scripts/`. The `.gitignore` rule pair `_fleet/*` + `!_fleet/shared/` implements the tiers (`.gitignore:11-12`).
- **Revert of harness evolution** uses git, not a manifest: proposals live on `fleet-evolve/*` branches, acceptance merges `--no-ff` and tags `fleet-gen/N`, rollback is `git revert fleet-gen/N` (`cli.js:543-568`).
- `migrate-workspace` is a one-off migration of the pre-tier layout that refuses to run while a `CURRENT-*` marker indicates a run in flight (`cli.js:281-324`).

---

## 11. Patterns worth adopting; things not to copy

### Strong patterns to adopt (adapted, not copied)

1. **Pure compiler → `FileSet` → single writer.** Adapters never touch disk; one `write` implements all safety policy; dry-run and drift detection fall out for free (`fs-utils.js`; `cli.js:838-840` keeps I/O in the CLI). AgentConcord should add a *plan* object on top (per-file `create|update|skip|conflict|delete` with reasons) since it must also handle pre-existing files.
2. **Refuse-by-default on divergent existing files, skip identical, explicit `--force`, plus a "preserve/seed-once" class** (`fs-utils.js:37-59`). Extend with managed blocks / three-way merge for user-owned files like `CLAUDE.md`.
3. **Capabilities, not tool names, with per-harness maps and documented degradation** (`claude-code.js:20-26`, `opencode.js:129-146`, `goose.js:47-51`). The commentary style — each mapping records the *observed* platform quirk (`Edit(path)` vs `Write(path)`, `subagent_depth`, `summon` re-injection, goose parallelism only in the prompt) — is exactly the knowledge base AgentConcord needs per harness.
4. **A deterministic, LLM-free QA battery that runs in CI on the repo's own harness**, with checks on *compiled output* rather than the spec, and drift detection with EOL normalisation and tier-aware exemptions (`qa/index.js`). Keep "a judge may advise but never gate" (`qa/index.js:17-21`).
5. **Ambient-install collision scan** (`qa/installed.js`): reading `./.claude` and `~/.claude` frontmatter, scoring trigger prompts, flagging rivals/shadows with file evidence. This is the seed of AgentConcord's "inspect existing harness" step — generalise to `.codex/`, `.opencode/`, `.goose/`, `.agents/skills`, `AGENTS.md`, `CLAUDE.md`.
6. **Live-harness execution as an explicit, non-gating, skip-loud measurement** with runner detection, untrusted-workspace detection, timeouts, and a repeat-based noise floor (`eval/exec.js`). AgentConcord's "validate real behaviour" should copy the *posture* (opt-in, skip ≠ pass, report degraded environments) even if the assertions differ.
7. **Ship the artefact, then run the artefact** (`smoke-binary.mjs`, `release.yml`), one runtime dependency, SEA binary + `npx github:` + paste-able bootstrap prompt, `install --dry-run`, detected-tools banner, user/project scope with a documented skip-list (`install.js:33-62`).
8. **Provenance markers in generated frontmatter** (`x-fleetsmith-origin`) and a hard-coded protected-path list that the spec cannot widen (`protected.js:7-15`). For AgentConcord: mark generated files with a stable manager marker and keep the validator/config out of the agent's write reach.
9. **Cache-stability rule**: nothing run-varying in a compiled prompt; live state injected at expansion time via `` !`cmd` `` / `@file` (`agent-prompt.js:10-15`, `claude-code.js:288-321`, `opencode.js:218-249`).
10. **Path-injection validation for values interpolated into hooks/scripts** (`validate.js:33-49`; `claude-settings.js:92-97`) — AgentConcord will generate hooks too.
11. **Doc discipline**: per-harness format research docs with verification dates (`docs/research/claude-code-formats.md:1-5`) and a `test/eval-fleets` held-out corpus for the compiler itself.

### Things to explicitly NOT copy (and why)

1. **The fleet/pattern/handover model itself.** Patterns (pipeline/fanout/…), phases, handoff artifacts, ledger, `_fleet/` workspace, SubagentStop handoff gate: these solve *multi-agent orchestration of new work*, not *convergence of an existing harness config*. AgentConcord's canonical model should describe instructions, agents/subagents, skills, commands, hooks, permissions, MCP servers, and ignore/allow rules — the things that already exist in repos — not fleets. Only the *shape* (one spec, N adapters, capability abstraction) transfers.
2. **Whole-file ownership of `CLAUDE.md`/`AGENTS.md`** (`claude-code.js:336-347`, `pointers.js:12-33`). Real repos already have these files with human content; refusing/clobbering them is the opposite of "adopt existing". Need managed blocks, `@import`-style includes, or a separate file the pointer links to.
3. **No manifest / no uninstall / no orphan detection** (§10). A convergence tool must know what it owns to remove or rename safely.
4. **Ad-hoc arg parsing** (`cli.js:867-886`) — no `--k=v`, no validation of unknown flags (e.g. `--force-preserved` is documented for `build` but `install` also reads it silently). Use a real parser.
5. **Windows-blind runtime artefacts**: POSIX `sh` hooks and `command -v` probes (`exec.js:71`) with no Windows equivalent (§8).
6. **Docs that outrun code**: `fleet.mcp` promised for three targets, delivered for one (§4). AgentConcord needs per-target compile tests for every documented projection.
7. **The self-evolution loop, playbooks, health metrics, RelataDB grid** (`src/evolve/`, `src/health/`, `ee/`). Interesting research but orthogonal to harness convergence and heavy (git branch/merge automation, LLM proposers). If anything, borrow only the safety posture (propose-only default, protected referee, deterministic gate).
8. **Test suite as one 4k-line file** (`test/fleetsmith.test.js`) — hard to navigate; split by module.
9. **Lexical trigger scoring as "eval"** (`eval/index.js:26-33` admits it is a proxy). Fine as a smell detector; do not present it as behavioural validation.

### Is the fleet/pattern/handover model relevant to harness convergence at all?

Marginally. The relevant abstraction is *one canonical spec projected by adapters with explicit capability mapping and degradation notes*, plus *drift detection by recompilation*. The fleet-specific concepts (pattern archetypes, phases, handoff files, ledger, SubagentStop handoff gate, workspace tiers) are about running multi-agent jobs and would be noise in a harness-convergence spec. One exception worth keeping in mind: their observation that *hooks are the only deterministic enforcement layer in Claude Code* and that *opencode's permission maps can encode a contract* (`qa/index.js:11-13`, `opencode.js:22-25`) is directly relevant to AgentConcord's "prevent drift / validate real behaviour" — the enforcement primitives per harness are the same even if what they enforce is different.

---

## 12. Licence — can code be reused?

- Root `LICENSE`: **MIT**, "Copyright (c) 2026 Subhransu Sekhar". Everything outside `ee/` is MIT (`docs/licensing.md:5-12`), including all of `src/`, `scripts/`, `test/`, `docs/`, `website/`. Reuse (copy, modify, redistribute, commercial) is permitted provided the copyright and permission notice are retained in copies or substantial portions.
- `ee/` is **AGPL-3.0-only** (`ee/package.json` `license`, `ee/LICENSE`, `docs/licensing.md:9`, SPDX headers enforced by `test/ee-boundary.test.js:146`). Avoid copying anything from `ee/` into a proprietary or MIT product.
- `package.json` `files` for the npm tarball is `src/, README.md, LICENSE`; `publish-check.mjs:52-63` asserts no `ee/` content ships in the MIT package.

For AgentConcord: reading and re-implementing ideas is unrestricted; lifting code verbatim from `src/` requires keeping the MIT notice (e.g. a `THIRD_PARTY_NOTICES` entry); nothing from `ee/`.

---

## Adopt / Reject / Why

| Idea (FleetSmith source) | Verdict | Why |
|---|---|---|
| Pure adapters → `FileSet` → single writer (`src/lib/fs-utils.js`, `src/adapters/*`) | **Adopt** | Makes dry-run, tests, drift detection trivial; extend with a per-file plan (create/update/conflict/delete). |
| Refuse-on-divergence, skip-identical, `--force`, preserve/seed-once class (`fs-utils.js:37-59`) | **Adopt + extend** | Right default; add managed blocks / merge for user-owned files and backups before force. |
| Whole-file `CLAUDE.md` / `AGENTS.md` pointers (`claude-code.js:336-347`, `pointers.js`) | **Reject** | Incompatible with adopting existing repos; clobbers human content. |
| Capability abstraction + per-harness permission maps with quirk commentary (`claude-code.js:20-26`, `opencode.js:129-146`, `goose.js:47-51`) | **Adopt (as a knowledge base)** | The per-harness gotchas are the hard-won part; the abstraction shape transfers. |
| Documented graceful degradation table per feature per target (§4) | **Adopt** | AgentConcord must state what each harness cannot express. |
| Deterministic QA battery on compiled output + drift-by-recompile in CI (`src/qa/index.js`, `ci.yml:80-94`) | **Adopt** | Core of "prevent drift"; keep judges advisory. |
| Ambient install scan of `./.claude` and `~/.claude` (`src/qa/installed.js`) | **Adopt + generalise** | Closest thing to "inspect existing harness"; extend to all harness dirs and `AGENTS.md`/`CLAUDE.md`. |
| `eval --exec` posture: opt-in live runs, skip-loud, untrusted-workspace detection, noise floor (`src/eval/exec.js`) | **Adopt** | Right way to "validate real behaviour" without making CI flaky. |
| Lexical IDF trigger scoring (`src/eval/index.js:64-80`) | **Adopt as a lint only** | Cheap smell detector; not behavioural evidence. |
| Provenance frontmatter marker `x-fleetsmith-origin` (`claude-code.js:122`) | **Adopt (as a manager marker)** | Needed for ownership; add a stable "managed by AgentConcord" marker and a manifest. |
| No manifest / no uninstall / no orphan detection (§10) | **Reject** | A convergence tool must track what it owns. |
| Hard-coded protected paths the spec cannot widen (`src/evolve/protected.js`) | **Adopt (principle)** | Keep validators/config out of agent-writable scope. |
| Path-injection validation for interpolated hook values (`validate.js:33-49`, `claude-settings.js:184-186`) | **Adopt** | AgentConcord generates hooks too. |
| Cache-stable prompts + expansion-time live state (`agent-prompt.js:10-15`, `claude-code.js:288-321`) | **Adopt** | Cheap, correct, harness-native. |
| Fleet patterns / phases / handoffs / ledger / `_fleet/` tiers (`src/patterns`, `src/handover`, `src/compile/orchestrator.js`) | **Reject** | Multi-agent job orchestration, not harness convergence; would bloat the canonical model. |
| SubagentStop handoff gate script (`claude-settings.js:89-177`) | **Reject content, adopt mechanism** | The *hook-as-only-deterministic-layer* insight is right; the handoff-file contract is fleet-specific. |
| opencode `permission.task`/`permission.skill` as enforcement (`opencode.js:139-144`) | **Adopt mechanism** | Shows how to make a contract enforced rather than advisory on that harness. |
| Self-evolution loop, playbooks, health, RelataDB grid (`src/evolve`, `src/health`, `ee/`) | **Reject** | Orthogonal, heavy, AGPL in part. |
| SEA binary + smoke-test-the-artefact + `npx github:` + bootstrap prompt + `install.sh` (`scripts/*`, `release.yml`, `docs/assets/bootstrap-prompt.txt`, `website/public/install.sh`) | **Adopt** | Proven "single install experience" playbook, including the postmortem. |
| One runtime dependency (`yaml`) | **Adopt** | Keeps SEA and `npx` fast and the supply chain small. |
| `install --scope user|project` with explicit skip-list and detected-tools banner (`src/install.js`) | **Adopt** | Good UX; extend skip-list reasoning to conflicts. |
| Hand-rolled arg parser (`cli.js:867-886`) | **Reject** | Use a real parser with unknown-flag errors. |
| POSIX-only generated hooks / probes (§8) | **Reject** | Need Windows-safe hook commands or a Node shim. |
| `fleetsmith patch` typed YAML-Document edits with comment preservation, dry-run when non-TTY (`cli.js:333-373`) | **Adopt (pattern)** | AgentConcord will edit user config files; comment/format preservation and inert-by-default automation are the right rules. |
| Doc/code drift on `fleet.mcp` (`docs/spec.md:29` vs `opencode.js:204`) | **Learn from** | Every documented projection needs a per-target compile test. |
| MIT licence on core | **OK to reuse ideas; keep notice if copying code** | `ee/` is AGPL — do not copy. |
