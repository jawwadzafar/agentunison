# Sync-tool reference study for AgentConcord

Date: 2026-09-04. Five repositories cloned with `git clone --depth 50` into
`/Users/jawwadzafar/repo/jawwadzafar/ideas/<name>` (all five directories were absent
beforehand; fresh shallow clones, no pre-existing state). All file:line citations below
are relative to those clone roots at the HEAD recorded in each section header. GitHub
metadata (stars, pushed_at, license detection) fetched via `gh api` on 2026-09-04.

Context for reading: AgentConcord inspects an existing repo's coding-agent harness setup
(CLAUDE.md, AGENTS.md, GEMINI.md, `.claude/{skills,agents,commands,settings}`, `.codex/`,
`.opencode/`, `.agents/skills`, `.github/copilot-instructions.md`, `.cursor/rules`, ...),
audits it, converges to one canonical architecture, projects it natively into each harness
(symlink where safe, generated adapter where formats differ, preserve native-only),
validates real harness behavior, and prevents drift. None of the five tools below does
all of that; each does one or two pieces well and several pieces badly. The point of this
study is to harvest the good pieces with evidence and to name the bad ones so we do not
re-derive them.

---

## 1. agent-smith

**agent-smith** — https://github.com/rmonier/agent-smith — HEAD `f81f578e1a06766211579442b01157b538c442db` (2026-07-19 20:39:44 +0200, default branch `main`) — License: Apache-2.0 for code, CC-BY-4.0 for skill prose/docs, `LicenseRef-All-Rights-Reserved` for `okf/wiki/` (`REUSE.toml:9-67`, `LICENSING.md:3-27,49-67`) — Language: Python 3.11+ (PEP 723 scripts run via `uv`) + Markdown Agent Skills.

**Facts:** 3 stars, 0 forks, 2 open issues, created 2026-07-05, 11 commits in the shallow window (2026-07-13 → 2026-07-19). ~5,100 lines of Python across 9 scripts (`run_openwiki_staged.py` alone is 1,037 lines), 1,866 lines of `unittest` tests. Runtime dependency surface for the *full* pipeline: `git`, `uv`, Python 3.11+, `fnm`, Node.js >= 22, `pnpm` >= 11, `openwiki@0.2.0` (npm, pinned with sha512 in `AGENTS.md:49`), `markitdown[all]==0.1.6` (optional, sha256 pinned `AGENTS.md:50`), PyYAML for the validators (`validate_okf_bundle.py:4`). The three skills themselves are stdlib-only except PyYAML.

### The four-way split, progressive disclosure, repo-specific knowledge

The architecture (`README.md:66-77`, `okf/wiki/architecture.md:21-26`) splits a repository's agent surface into:

| Surface | Role | Authority |
|---|---|---|
| `AGENTS.md` | Orientation: routing map + the operational basics the agents.md spec expects in-file (toolchain versions, setup/build/test commands) | source of truth for operational basics |
| `okf/wiki/` | Context: durable knowledge, decisions, evidence, provenance; LLM-compiled by OpenWiki from a staged snapshot | "project truth" |
| `.agents/skills/` | Actions: repeatable procedures + scripts | portable |
| Harness adapters | Runtime projections for the *active* harness only | "never source of truth" (`.agents/skills/harness-profile-adapter/SKILL.md:31`) |

Progressive disclosure is enforced structurally: `AGENTS.md` may point only at `okf/wiki/index.md`, never deep-link individual pages (`references/workflow.md:108`: "pages get renamed and consolidated away by update passes, and no validator checks links outside the wiki"); `index.md` routes to `quickstart.md` (`validate_openwiki_bundle.py:22-37` fails if it does not); the AGENTS.md re-pass is "subtraction-first" (`workflow.md:110`: context that now has a wiki home is collapsed to a pointer, not duplicated).

Repo-specific knowledge generation is the OpenWiki pipeline: `git ls-files` corpus copied byte-for-byte into an isolated no-remote git repo under `okf/.okf-build/<run-id>/worktree/`, stock `openwiki code --init|--update` run there, output mapped to `candidate/`, a `review.diff` written, and promotion into `okf/wiki/` is a separate transactional Markdown-only step (`run_openwiki_staged.py:8-22`, `:374-411`, `:749-861`; `SKILL.md:51-59`). A zero-LLM fallback writes a skeleton (`build_okf_skeleton.py:7-15`) that refuses to overwrite any existing wiki (`:66-73`).

### The 21 answers

1. **Problem solved.** Turn any repo into an "agent-ready" one: concise `AGENTS.md`, an LLM-compiled knowledge wiki, portable skills, and bridging so the *active* harness can actually discover `AGENTS.md`/`.agents/skills/` (`README.md:61-77`; `harness-profile-adapter/SKILL.md:43-46`). It is a knowledge-compilation tool first and a harness-bridging tool second.
2. **Canonical source of truth.** Three canonical roots: `AGENTS.md`, `okf/wiki/` (front door `okf/wiki/index.md`), `.agents/skills/`. Harness-specific files are explicitly non-canonical projections (`harness-profile-adapter/SKILL.md:28-31, 65`). The managed section of `AGENTS.md` is code-owned between `<!-- okf:start -->`/`<!-- okf:end -->` (`merge_agents_md_okf_section.py:48-49`).
3. **Files it owns.** The marker-delimited section of `AGENTS.md` only (`merge_agents_md_okf_section.py:7-11`: "does not rewrite existing project-specific setup, style, test, or PR instructions"); `okf/wiki/**` via promotion; `okf/.okf-build/`, `okf/.openwiki/` (ignored, `.gitignore:3,11`); local alias paths it creates plus their `.git/info/exclude` lines (`ensure_local_alias.py:56-69, 222`); `okf/wiki/tooling/harnesses/<harness>.md` local pages plus the committed `tooling/index.md` stub (`.gitignore:6-8`; `tooling-context-policy.md:29-38`).
4. **Files it merely reads.** Every Git-tracked file as producer corpus (`run_openwiki_staged.py:187-220`), minus structural excludes `.git`, `okf`, `openwiki` (`:67-71`) and user `--exclude` prefixes; the rest of `AGENTS.md` outside the markers; harness docs (web or local) for adapter authoring (`references/harness-docs.md:5-9`).
5. **Symlinks used?** Yes, for harness bridging only: a *relative* symlink from the harness-required path to the canonical file or directory (`ensure_local_alias.py:111-113` computes `os.path.relpath`, `:210-212` for files). Always local-only via `.git/info/exclude` unless the user opts into tracking (`references/git-tracking-policy.md:7-18`).
6. **When does it copy instead of symlink?** Never for bridging ("a bridge is always a local alias pointing back at them, never a copy — one place to edit either way", `harness-profile-adapter/SKILL.md:65`). Fallback ladder when a symlink cannot be created: file → small Markdown *pointer file* naming the canonical path (`ensure_local_alias.py:51, 213-219`); directory → NTFS junction on Windows (`:118-128`) → hard failure with instructions, because "a harness scanning a directory for skills has nothing to scan" in a text pointer (`:27-30, 195-207`). The only copy in the codebase is `adopt_generated_skill.py:55` (`shutil.copytree`) when adopting an LLM-generated skill into `.agents/skills/`, and the byte-for-byte corpus staging (`run_openwiki_staged.py:365-371`).
7. **Handling of existing files.** Alias path already a symlink/junction to the same target → idempotent no-op and re-register exclude (`ensure_local_alias.py:169-178`); points elsewhere → error unless `--force` (`:179-182`); is a *real directory* → refuse **even with `--force`** (`:183-185`); is a real file → error unless `--force` (`:186-190`). `AGENTS.md`: managed section replaced in place, append if absent, create if file absent; corrupted marker state (stray/duplicate/reversed markers) self-heals by removing the first complete pair wholesale and stripping strays, matching markers by *whole line* not substring so prose quoting the marker is not mistaken for it (`merge_agents_md_okf_section.py:13-41, 93-167`; regression tests `tests/test_openwiki_adapter.py:1576-1640`). Skeleton refuses to touch a non-empty wiki (`build_okf_skeleton.py:66-73`). `adopt_generated_skill.py` refuses to replace an existing skill without `--force` and rolls back a fresh copy if validation fails (`:45-66`). `.gitattributes` merge: append missing rules, ask on conflicts, never silently override (`workflow.md:18`).
8. **Collision detection.** Near-duplicate sibling pages by normalized slug (`validate_okf_bundle.py:52-54, 218-230`); unclosed code fence as truncation/bad-merge signal (`:57-69, 208-209`); citation gate: every generated page must cite paths that existed in the immutable pre-run stage, same-run onboarding files rejected as evidence (`run_openwiki_staged.py:523-556, 629-654`; test `:552`); timestamp contract: body change without timestamp bump, or timestamp churn without body change, both rejected (`:696-728`; tests `:630, :655`).
9. **Quarantine of conflicting files.** Yes, and it is the strongest of the five: all LLM output lands in `okf/.okf-build/<run-id>/{worktree,baseline,candidate,review.diff}` (`workflow.md:10`); promotion is a separate `--promote` action that is transactional and Markdown-only (`run_openwiki_staged.py:814-861`; test `:762, :812`); the stage is retained on failure for inspection (`:473`). Local tooling pages are quarantined from the committed bundle by `.gitignore` with a committed navigation stub so committed links never dangle (`tooling-context-policy.md:29-58`).
10. **Dry-run.** `run_openwiki_staged.py` *defaults* to a dry-run inventory; `--execute` is opt-in (`:10-13`; test `:185`). `build_okf_skeleton.py --dry-run` (`:59, 74-76`). No dry-run for `ensure_local_alias.py` or the AGENTS.md merge.
11. **Idempotent.** Yes and tested: alias rerun (`tests/test_harness_profile_adapter.py:78, 177`), merge rerun stable (`test_openwiki_adapter.py:1640`), and a stated contract that a no-op wiki update "must be byte-identical — timestamp, key-order, index, log, or formatting churn fails the gate" (`workflow.md:61`; `okf/wiki/INSTRUCTIONS.md` "Preserve existing timestamps ... A no-op update must be byte-identical").
12. **Reverse adoption.** Partial and skill-shaped: `adopt_generated_skill.py` copies a generated skill from an explicit source into `.agents/skills/`, validates, rolls back on failure, and prints a caveat-preservation review reminder (`:20-77`); `suggest_skills_from_okf.py` heuristically proposes action skills from wiki prose (`:15-21, 43-70`); direct manual wiki edits are first-class and must survive producer updates (`agent-ready-context/SKILL.md:35-38`). There is no "collect harness-native content back into canonical" loop for CLAUDE.md/.claude/*.
13. **Drift prevention.** Deterministic validators: `validate_okf_bundle.py` (spec conformance), `validate_openwiki_bundle.py` (producer layout), `validate_tooling_link_policy.py` (link-direction policy `:7-22`), `quick_validate.py` (skill frontmatter); CI template `assets/okf-validate.ci.yml` gating PRs that touch `AGENTS.md`/`okf/wiki/**` with pinned action SHAs (`:11-38`); suggested `post-merge`/`pre-push` hook (`workflow.md:86-93`), all consent-first. Supply-chain: trust-on-first-use pin table with version + artifact integrity hash + index + date in `AGENTS.md` (`AGENTS.md:45-50`); a mismatch "is a supply-chain red flag: stop and report, never silently re-pin". `.gitattributes` LF normalization "keeps deterministic OKF staging hashes stable across platforms" (`.gitattributes:1-2`). No checksum manifest of *harness projections*.
14. **Generates adapters?** Yes but LLM-authored, not code-generated: "Write native adapter files by reasoning from current docs. Do not rely on hardcoded vendor renderers. Do not assume fields are stable between harness versions" (`harness-profile-adapter/SKILL.md:84-88`; non-goal `:137` "hardcode vendor profile renderers"). Harness facts are recorded as evidence pages `okf/wiki/tooling/harnesses/<harness>.md` (`references/harness-docs.md:12-31`). Runtime detection distinguishes *installed* from *active*: parent-process chain, explicit env keys, repo markers as low-confidence hints, never `<tool> --version` (`inspect_runtime_context.py:7-11, 21-54, 148-157`; `references/runtime-detection.md:15-24`).
15. **Committed or gitignored?** Three-tier policy chosen by the user, default local-only via `.git/info/exclude` (`references/git-tracking-policy.md:5-18`). Canonical surfaces committed; `okf/wiki/tooling/*` gitignored except the stub; build/producer state ignored (`agent-ready-context/SKILL.md:161-181`).
16. **Tests: real harness vs structural.** Structural + mocked. `subprocess.run`/`Popen` are mocked throughout (`tests/test_openwiki_adapter.py:208, 225, 357, 844-1116`); the only real binary exercised is `git` to build stages (`:39-46`) and, on Windows only, a real `mklink /J` (`tests/test_harness_profile_adapter.py:194-216`). No test launches Claude Code, Codex, OpenCode, or OpenWiki. Coverage of the alias helper is good (15 tests: symlink, pointer fallback, `--fallback fail`, idempotency, refuse-real-dir-even-with-force, junction removal deletes only the reparse point).
17. **Uninstall/reverse.** No `uninstall` command. `remove_existing_alias()` is careful (unlink for symlink, `os.rmdir` for junction, never recursive; `ensure_local_alias.py:89-101`). Because aliases are excluded, not committed, removing them is a local `rm`. The wiki has no reverse.
18. **What breaks on Windows.** Explicitly engineered: directory symlinks need Developer Mode → junction fallback (`ensure_local_alias.py:19-30`); junction detection via `FILE_ATTRIBUTE_REPARSE_POINT` because `Path.is_symlink()` is False for junctions (`:53, 76-86`); `shutil.which` resolution because shims found by `which` are not resolved by `subprocess` on Windows (`check_prereqs.py:35-36`; test `:197`); `USERPROFILE` redirection for the child home (`run_openwiki_staged.py:14-17`); visible-terminal launcher prefers `pwsh` → `powershell` → `cmd` (tests `:1170-1240`); WSL detection. This is the most Windows-aware codebase of the five.
19. **Symlink-hostile environments.** Never silent: file alias → pointer Markdown with a warning (`:217-219`), directory alias → junction → loud failure with three remediation options (`:199-207`). Contrast with agent-sync (silent copy).
20. **Ideas AgentConcord should adopt.**
    - "Alias, never copy" for bridging, with an explicit *reported* fallback ladder and a hard failure for directories that cannot be aliased (`ensure_local_alias.py:15-30`).
    - Refuse to replace a real directory even under `--force` (`:183-185`).
    - Marker-delimited managed section in a human-owned file, line-exact marker matching, self-healing corrupted marker state (`merge_agents_md_okf_section.py:13-41`) — this is exactly how AgentConcord should inject a "harness routing" block into an existing CLAUDE.md/AGENTS.md without owning the whole file.
    - Three-tier tracking policy (local via `.git/info/exclude` / team-ignored via `.gitignore` / committed) as an explicit user decision (`git-tracking-policy.md`).
    - Staging + `review.diff` + transactional promote for any generated content; no-op must be byte-identical (`workflow.md:61`).
    - Near-duplicate slug detection and unclosed-fence truncation detection as cheap audit signals (`validate_okf_bundle.py:52-69`).
    - "Installed ≠ active harness" detection heuristics (`inspect_runtime_context.py`) and the run-report rule "state all conclusions explicitly, even when negative — a silent skip is indistinguishable from a forgotten step" (`agent-ready-context/SKILL.md:89`).
    - Zero-LLM validators wired into a CI template with pinned action SHAs (`okf-validate.ci.yml`).
    - The *taxonomy* orientation / durable knowledge / actions / adapters as the classification axis for the audit report.
21. **Ideas to explicitly NOT copy, and why.**
    - **The OKF/OpenWiki knowledge-compilation layer.** It solves a different problem (repository *memory*) and drags in Node 22, pnpm 11, fnm, an npm CLI, OAuth login flows, provider egress, consent scripts, a 1,037-line staged runner, and a 17-step prose workflow. AgentConcord's value is deterministic convergence of *harness configuration*; an LLM-in-the-loop producer is orthogonal and would destroy idempotency guarantees. If a repo already has `okf/wiki/` (or `docs/`, `dev_docs/`), AgentConcord should treat it as a "durable knowledge" surface to *route to* from the canonical entry file, not own or generate it. The right-sized version of repo-specific knowledge generation is agentsync's ≤80-line grounded `<project>-ground-truth` skill (section 3), not a compiled wiki.
    - **LLM-authored adapters "by reasoning from current docs"** (`harness-profile-adapter/SKILL.md:84-88`). Non-deterministic, unvalidated against the real harness, and re-derived every run. AgentConcord needs code-generated adapters from a tested harness capability matrix.
    - **Prose-as-executable-workflow.** The skill itself admits "Compression has already dropped requirements silently once (a 'not optional' follow-up was missing from this list and got skipped)" (`agent-ready-context/SKILL.md:71`). A CLI must not have this failure mode.
    - **`okf/wiki/tooling/` local overlay with a link-direction policy and a dedicated validator.** Over-engineered for our need; a per-user notes file should be a gitignored path, full stop.
    - **The managed AGENTS.md block content** (`merge_agents_md_okf_section.py:51-90`) is ~40 lines of dense prose about the wiki, inserted into the very file the tool says must stay concise. Our injected block should be a few lines of routing.
    - **All-rights-reserved licensing of generated content** (`LICENSING.md:49-67`) — a legal wrinkle we do not want on files we write into user repos.

**State/manifest formats (excerpts):**

```markdown
<!-- AGENTS.md: code-owned managed section, merge_agents_md_okf_section.py:48-49 -->
<!-- okf:start -->
## Agent-ready knowledge workflow
...
<!-- okf:end -->

<!-- AGENTS.md: trust-on-first-use pin table, AGENTS.md:47-50 -->
| Tool | Pinned version | Integrity | Source | Recorded |
| OpenWiki | npm package `openwiki` `0.2.0` | tarball `sha512:hLop7...` | configured npm registry | `2026-07-17` |
```

```text
# .git/info/exclude line appended per alias (ensure_local_alias.py:56-69)
CLAUDE.md
.claude/skills

# okf/.okf-build/<run-id>/ layout (workflow.md:10)
worktree/   baseline/   candidate/   review.diff
```

---

## 2. agent-sync

**agent-sync** — https://github.com/lidge-jun/agent-sync — HEAD `b0497eb324cd0c0718c80851770cd5c3db70e5d4` (2026-06-01 11:54:50 +0900, default branch `main`) — License: MIT declared in `package.json:34`, **no LICENSE file** in the repo (README:24 acknowledges; GitHub reports `none`) — Language: TypeScript (ESM, Node >= 18), npm package `@bitkyc08/agent-sync` 0.1.9.

**Facts:** 3 stars, 1 fork, 0 open issues; 15 commits (2026-02-27 → 2026-06-01); extracted from the author's `cli-jaw` project (`devlog/_fin/260227_initial_extraction.md:4-14`). Zero runtime dependencies; dev deps `typescript`, `tsx`, `vitest`, `@types/node` (`package.json:38-43`). 26 vitest tests, all in `src/__tests__/symlink.test.ts`. CI: `npm ci` → asset checks → `npm audit` → build → test (`.github/workflows/ci.yml:20-31`). Interactive wizard, not config-driven (`cli.ts:2-11`).

### The 21 answers

1. **Problem solved.** Sync three things across six tools (Claude Code, Codex, Gemini CLI, OpenCode, Copilot, Antigravity): MCP server config (user-global), skills (project-level symlinks), and the project instruction file (project-level copies) (`README.md:8, 44-90`).
2. **Canonical source of truth.** Three different answers: skills → a hardcoded canonical path `.agent/skills` (singular) plus a user-picked source (`skill-sync.ts:121-129`); MCP → `~/.agent-sync/mcp.json` (`config.ts:9-13`; `mcp-sync.ts:5`); instructions → **none**. The wizard picks one detected file (`agents-md.ts:23-71`) and writes its content to four equal copies: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.agents/rules/agent-sync.md` (`agents-md.ts:80-95`). The tool's own repo demonstrates the consequence: those three files are identical regular files sharing blob `cc2f150` (verified `git ls-files -s`, mode 100644), while `AGENTS.md` — the nominal source — is *gitignored* (`.gitignore:4`). All three also carry Antigravity-style `trigger: always_on` frontmatter (`CLAUDE.md:1-5`), a format leak from one harness into every other.
3. **Files it owns.** `.agent/skills`, `.agents/skills`, `.claude/skills` symlinks (`skill-sync.ts:121-125`); the four instruction copies; the `mcpServers`/`mcp_servers`/`mcp` sections of six global config files (`mcp-sync.ts:161-236`); `~/.agent-sync/backups/<YYYY-MM-DD>/` (`symlink.ts:15-18`).
4. **Files it merely reads.** Candidate detection only: `.agent/skills`, `.agents/skills`, `.claude/skills`, `skills_ref/`, one level of subdir `skills_ref` for monorepos (`skill-sync.ts:27-43`); prompt candidates `AGENTS.md`, `CLAUDE.md`, `COPILOT.md`, `INSTRUCTIONS.md`, `PROMPT.md`, `CODEX.md`, `.github/copilot-instructions.md`, `.agents/rules/*.md` (`agents-md.ts:27-35, 51-68`); six MCP config paths (`mcp-sync.ts:123-131`).
5. **Symlinks used?** Yes, for skills: directory symlinks with **absolute** targets (`fs.symlinkSync(target, linkPath)` with `target` built from `join(cwd, ...)`, `symlink.ts:145`, `skill-sync.ts:122-125`) — so a cloned or moved repo breaks them. Topology is a two-hop chain: `.agents/skills → .agent/skills → <source>` (`skill-sync.ts:143-152`).
6. **When does it copy instead of symlink?** (a) Instruction files: always copied, never linked (`agents-md.ts:88-91`). (b) Fallback ladder in `createLinkWithFallback`: symlink → Windows junction → **recursive directory copy** (`symlink.ts:142-159`), and the result still reports `action: 'created'`, so the caller cannot tell a copy from a link. (c) MCP: always format-translated writes.
7. **Handling of existing files.** Default `onConflict: 'backup'` (`symlink.ts:87`): a real file/dir at the link path is `rename`d into `~/.agent-sync/backups/<date>/<path with / → __>_<n>` and replaced by the symlink (`:117-125, 161-166`); `onConflict: 'skip'` available (`:118-120`). A wrong-target symlink is replaced without backup (`:112-114`). MCP JSON: read, `Object.assign` top-level key, rewrite with 4-space indent (`mcp-sync.ts:88-93`) — loses formatting; Codex TOML: regex strips all `[mcp_servers.*]` blocks and appends new ones (`:79-86`) — loses comments in those blocks and is fragile on edge cases. Instruction copies: the overwrite prompt exists **only** on the manual-entry path (`cli.ts:114-122`); picking a detected file writes all four copies with no prompt (`cli.ts:137-142`).
8. **Collision detection.** The strongest single mechanism in this tool: `wouldCreateCycle` — `realpathSync` with `ELOOP` treated as "already circular", direct-cycle check, symlink-chain walk with a visited set and `MAX_DEPTH=40` (SYMLOOP_MAX) (`symlink.ts:29-71`); `isSameRealDir` compares `ino`+`dev` for real entries and realpath for links so the source directory is never overwritten even through a circular alias (`skill-sync.ts:90-109, 131-139`). This was added after an incident on 2026-02-27 where the tool replaced a real `.agents/skills/` holding 29 skills with a circular symlink (`devlog/_fin/260227_circular_symlink_debug_fin.md:5-11`); the postmortem lists six bugs B1-B6 (`:73-82`) including "hardcoded canonicalPath", "string comparison not realpath", "no dry-run", "backup is silent".
9. **Quarantine of conflicting files.** The backup directory is a de-facto quarantine, but it lives in `$HOME`, not in the repo, and the user is not told what moved (postmortem B6, `:81`; not fixed in HEAD — `movePathToBackup` logs nothing).
10. **Dry-run.** None. Planned as P1 in the postmortem (`:225-229`), not implemented (`cli.ts` parses no such flag).
11. **Idempotent.** Skills: yes via `already_correct` skip (`symlink.ts:105-110`; test `:147`). MCP: rewrites six files every run (reformats JSON, re-emits TOML blocks). Instructions: rewrites four files every run.
12. **Reverse adoption.** Detection-and-import only: `detectSkillSources` dedups by realpath (`skill-sync.ts:57-59`), `importFromClaude` converts `~/.mcp.json` into the unified format (`mcp-sync.ts:97-111`), and other formats are best-effort imported (`cli.ts:262-277`). No collect-back of skills authored in a harness dir; no origin tracking.
13. **Drift prevention.** None. No status command, no manifest, no checksums; CI tests only the tool.
14. **Generates adapters?** Yes — the one genuine format translator in the set: `toClaudeMcp`, `toCodexToml`, `toOpenCodeMcp` from a neutral `{servers:{name:{command,args,env}}}` model (`mcp-sync.ts:39-77`). Skills and instructions are not translated.
15. **Committed or gitignored?** Unspecified for users. Its own repo gitignores the source (`AGENTS.md`, `.gitignore:4`) and commits the copies — the inverse of sane.
16. **Tests.** 26 vitest tests on temp dirs: cycle detection (7), `ensureSymlinkSafe` (6, incl. "BLOCKS circular symlink creation"), `syncSkills` (4, incl. "PREVENTS circular symlink in the incident scenario"), detect/list/copy (`symlink.test.ts:46-422`). No MCP translator tests. No real harness binaries.
17. **Uninstall/reverse.** None. Backups persist indefinitely under `~/.agent-sync/backups/`.
18. **What breaks on Windows.** Fallback to junction then copy exists (`symlink.ts:149-158`), but `resolveSymlinkTarget` treats only `/`-prefixed targets as absolute (`symlink.ts:20-23`), so `C:\...` targets are resolved as relative; `movePathToBackup` only replaces `/` (`:163`), leaving `\` in backup names. Absolute symlink targets are hostile to any cross-machine sharing.
19. **Symlink-hostile environments.** Silently degrades to a full directory copy with no report (`:157-158`) — the worst possible behavior for a tool whose premise is "one source directory remains authoritative" (`README.md:146`).
20. **Ideas AgentConcord should adopt.**
    - Cycle detection before *every* link creation (`symlink.ts:29-71, 94-100`) and inode/realpath identity checks so the source is never overwritten (`skill-sync.ts:90-109`). AgentConcord will meet exactly this topology in the wild (`.agent` vs `.agents`, `.claude/skills → ../.agents/skills` set up long ago).
    - Backup-before-replace as a mode — but in-repo (`.agentconcord/quarantine/`), reported, and gitignored, not in `$HOME`.
    - "Detect candidates → present with counts/sizes → user picks source" as the adoption UX (`cli.ts:128-142, 175-186`).
    - A neutral MCP model with per-harness renderers (`mcp-sync.ts:39-77`) — the correct *shape* of an adapter, even if this implementation is lossy.
    - The postmortem itself as a checklist of failure modes (`260227_circular_symlink_debug_fin.md:73-82`).
21. **Ideas to explicitly NOT copy, and why.**
    - N identical copies of the instruction file with no canonical (`agents-md.ts:80-95`): drift is guaranteed at the first edit; AgentConcord must have one canonical and either symlink or *generate* the others with a provenance header.
    - Two-hop symlink chains and a hardcoded canonical path (`skill-sync.ts:128`) — the direct cause of the data-loss incident.
    - Absolute symlink targets (`symlink.ts:145`).
    - Silent copy fallback (`:157-158`) and silent backup (`:161-166`).
    - Regex patching of TOML (`mcp-sync.ts:79-86`) and `Object.assign` rewriting of user JSON — parse, edit, and serialize with a real TOML/JSON library preserving unknown keys, or refuse.
    - Leaking one harness's frontmatter (`trigger: always_on`) into every projection.
    - Global `$HOME` writes as a side effect of a project-level command.

**State/manifest formats (excerpts):**

```json
// ~/.agent-sync/mcp.json (config.ts:13; cli.ts:222-229)
{ "servers": { "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] } } }
```

```text
# backup naming (symlink.ts:161-166)
~/.agent-sync/backups/2026-02-27/Users__jun__Developer__new__.agents__skills_0
```

---

## 3. agentsync

**agentsync** — https://github.com/sarthak22gaur/agentsync — HEAD `6b915a183aa2410fb990da3394f53d5ff2c4ce02` (2026-06-04 10:24:07 -0700, default branch `main`) — License: MIT (`LICENSE`, `.claude-plugin/plugin.json:10`) — Language: Bash (3.2-compatible, `CHANGELOG.md:42`) sync scripts + a Markdown SKILL.md "driver" executed by Claude Code (plugin).

**Facts:** 0 stars, 0 forks, 11 commits in one week (2026-05-28 → 2026-06-04), version 0.2.6 with a real `CHANGELOG.md`. Zero external dependencies beyond bash/awk/sed/grep/cp. No automated tests; smoke-tested on Claude Code v2.1.154 and Codex end-to-end by hand (`README.md:181-184`, `CHANGELOG.md:8`). The README is candid: "Reconcile mode is new and lightly tested ... Works for me — no support guarantees" (`:187-188`).

### Canonical tree, modes, generated artifacts

```text
agents/                      # source of truth (README.md:19-37)
  AGENTS.md  agentsync.conf  README.md
  claude/  { CLAUDE.md, agents/*.md, rules/*.md, settings.json? }
  codex/   { agents/*.toml, configs/*.toml }
  opencode/{ agents/*.md }
  github/  { agents/*.agent.md }            # opt-in
  skills/  { grill-plan/, orchestrate/, <project>-ground-truth/ }
  scripts/ { _lib.sh sync_agents.sh sync_claude.sh sync_codex.sh sync_opencode.sh sync_github.sh apply_gitignore.sh }
```

Two modes chosen by preflight: `agents/scripts/sync_agents.sh` exists → **Reconcile**; only `.claude/agents/` etc. exist with no `agents/` → offer to *adopt* the hand-made setup as the seed (explicit approval required); neither → **Bootstrap** (`SKILL.md:20-23`). Bootstrap renders templates with `{{PROJECT_NAME}}`-style placeholders (`:63-74`), then generates a `<project>-ground-truth` skill from README/manifests/top-level tree with strict anti-bloat rules (cap ~80 lines, "No invention", `:89-142`).

### The 21 answers

1. **Problem solved.** Per-project agent/skill/rule definitions maintained once and fanned out to `.claude/`, `.codex/`, `.opencode/`, `.github/`, `.agents/skills/` so they do not drift; plus an audit/reconcile loop for existing setups (`README.md:3-15`).
2. **Canonical source of truth.** `agents/` (no leading dot). Important nuance: **agents are authored four times in four native formats** (`templates/claude/agents/engineer.md`, `codex/agents/engineer.toml`, `github/agents/engineer.agent.md`, `opencode/agents/engineer.md`), and "GitHub agents are verbatim source ... never derived from the Claude agent" (`SKILL.md:327`). Only `agents/skills/` and `agents/AGENTS.md` are truly single-source. The version stamp `AGENTSYNC_VERSION` in `agents/agentsync.conf` is tool-owned (`agentsync.conf:3-6`).
3. **Files it owns.** Per target dir, exactly the entries listed in that dir's hidden `.agentsync-manifest` (`_lib.sh:4-10`); plus unconditionally: `.codex/config.toml` (truncated and rebuilt, `sync_codex.sh:28-33`), `.claude/CLAUDE.md` or root `CLAUDE.md` (`sync_claude.sh:28-32`), `.claude/settings.json` if a source exists (`:34-36`), root `AGENTS.md`, `.codex/AGENTS.md`, `.opencode/AGENTS.md` (`sync_agents.sh:26-29`, `sync_codex.sh:93-95`, `sync_opencode.sh:26-28`), and one delimited block in the workspace `.gitignore` (`apply_gitignore.sh:15-16, 51-61`).
4. **Files it merely reads.** `agents/agentsync.conf` (`sync_claude.sh:10`, `apply_gitignore.sh:12`); everything else in the target dirs it does not own (foreign entries preserved by design).
5. **Symlinks used?** **No.** Every projection is a copy (`cp -f`, `cp -r`, `cp -R`). "treats `.claude/`, `.codex/`, and `.opencode/` as generated artifacts — you never hand-edit them" (`README.md:9`; `templates/README.md.tmpl:32-34`).
6. **When does it copy instead of symlink?** Always. There is no link path at all.
7. **Handling of existing files.** Ownership-scoped prune-then-copy: read the previous manifest, delete only previously-owned names absent from the new owned set, rewrite the manifest, then copy owned entries in (`_lib.sh:25-50, 57-71, 77-92`). Foreign entries are never touched ("this is what lets agentsync share a dir like `.claude/skills/` with another tool instead of clobbering it", `:7-9`; `CHANGELOG.md:41`). The single-file targets above are overwritten unconditionally — `cp -f` of `settings.json` will clobber a user's permission allow-list. At the prose level, Reconcile "never blind-copies templates over existing files. Audit → report → approve → apply" and "Customizations win over template prose; templates contribute only missing structure and newly-added hard rules, with sign-off" (`SKILL.md:207, 299, 329`).
8. **Collision detection.** (a) Sync drift: diff each target against its source; a differing target means a direct-target edit (anti-pattern) or unsynced source; direct edits must be back-ported into `agents/` first (`SKILL.md:230-232, 294`). (b) Co-owned surface dirs: before first sync and during audit, scan for another generator's "generated by … / do not edit" banners or a foreign manifest/lockfile, and report the *reciprocal clobber risk* — "agentsync coexisting does not make the other tool coexist" (`:148, 253-255, 352-358`). (c) Structural gaps: role present in one surface, missing in another (`:228`).
9. **Quarantine of conflicting files.** None. Foreign artifacts that *look* agentsync-installed but ship in no version (e.g. an orphan `.git/hooks/pre-commit` calling a missing `check_sync.sh`) are **reported, never adopted or repaired**, and the driver must not invent the missing file (`SKILL.md:249-251, 347-350`; `CHANGELOG.md:51-52` records the real bug that motivated this).
10. **Dry-run.** None in the scripts (verified: no `dry`/`diff` in `templates/scripts/`). Reconcile's report-before-apply is prose executed by the LLM (`SKILL.md:257-289`).
11. **Idempotent.** By construction (deterministic copies; manifest rewritten each run). `apply_gitignore.sh` replaces its block in place via `awk` (`:51-57`).
12. **Reverse adoption.** Two forms, both LLM-driven: adopt an existing hand-made `.claude/` as the seed of `agents/` (`SKILL.md:22`), and back-port direct-target edits into `agents/` before re-sync, asking which version wins when both diverged (`:294`). No script support.
13. **Drift prevention.** The manifest; the `AGENTSYNC_VERSION` stamp plus an **"Upgrades by version" ledger** — reconcile applies every entry newer than the stamp by *merging* into customized files, then re-stamps; if the user declines some upgrades the stamp is not advanced past them so they resurface (`SKILL.md:13, 212, 244-247, 298, 311-320`). Six reconcile audit classes: structural gaps, sync drift, stale generated content (re-derive ground-truth and derived fields such as `Languages:`/base branch and diff), version upgrades, foreign artifacts, co-owned dirs (`:217-255`). No checksums, no CI. Git hooks are **forbidden** by the artifact guardrail (`:342-344`).
14. **Generates adapters?** Partially, and this is where it is most interesting: `normalize_skill` strips Claude/OpenCode-only frontmatter keys (`agent`, `context`, `disable-model-invocation`, `allowed-tools`, `argument-hint`, `model`, `effort`, `maxTurns`, `color`, `permission`, `permissionMode`, `tools`, `disallowedTools`, `hooks`, `mode`, `temperature`, `steps`) before copying skills to `.agents/skills/` and `.github/skills/` (`_lib.sh:94-110`; used `sync_codex.sh:89`, `sync_github.sh:47`); `is_delegator_skill` excludes skills with `agent:`/`context:` from fan-out (`_lib.sh:14-16`); and `sync_codex.sh:35-60` **generates** `[agents.<name>]` registrations with `config_file = "agents/<name>.toml"` into `.codex/config.toml`, because "Codex (>= 0.137) does NOT auto-discover standalone `.codex/agents/*.toml`" (`:23-27`; `CHANGELOG.md:8`, verified end-to-end by hand). Agents themselves are not translated between formats.
15. **Committed or gitignored?** Explicit `OUTPUT_TRACKING` policy: `all` (commit everything), `root-docs` (default: commit `CLAUDE.md`/`AGENTS.md`/copilot-instructions, ignore `.claude/ .codex/ .opencode/ .github/agents/ .github/skills/ .agents/`), `none` (ignore all output incl. `/AGENTS.md`, `/CLAUDE.md`) — kept in sync with a `# >>> agentsync >>> … # <<< agentsync <<<` block that is the only part of `.gitignore` touched (`apply_gitignore.sh:19-49`; `agentsync.conf:12-19`). Reconcile knows a gitignored output dir being absent is not a missing surface (`SKILL.md:224`).
16. **Tests.** None automated. Manual smoke test on Claude Code; `claude plugin validate .` passes (`README.md:182`). Codex behavior was verified by actually running codex-cli 0.137.0 — "standalone-file auto-discovery, project-local config in an untrusted project, and registration-via-absolute-path in an untrusted project all fail; registration in a trusted project succeeds" (`CHANGELOG.md:8`). OpenCode/Copilot output "structurally verified, but has not been runtime-tested" (`README.md:183`).
17. **Uninstall/reverse.** None. Because of the manifest, a scoped uninstall (delete only owned entries) is *possible* but not implemented.
18. **What breaks on Windows.** Everything: bash-only. Deliberately bash 3.2 compatible for stock macOS and `compgen`-free for Nix minimal bash (`CHANGELOG.md:9, 42`).
19. **Symlink-hostile environments.** Unaffected (pure copy). This is the one real argument for copying.
20. **Ideas AgentConcord should adopt.**
    - **Per-directory ownership manifest** (`_lib.sh:4-50`): the only mechanism among the five that lets a tool share `.claude/skills/` with a user or another generator and still prune its own stale output. AgentConcord should keep a manifest of every projected path (symlink *or* generated file) with its source and hash.
    - **Version stamp + upgrade ledger** (`SKILL.md:311-320`) as the migration mechanism between AgentConcord releases.
    - **Co-ownership detection** and the honest framing that "agentsync coexisting does not make the other tool coexist" (`:357`).
    - **Audit → report → approve → apply** as the default for anything touching user-customized files, with "customization wins for prose, template wins for new hard rules with sign-off" (`:299`).
    - **Delimited managed block in `.gitignore`** plus an explicit `OUTPUT_TRACKING`-style policy (`apply_gitignore.sh`).
    - **Frontmatter normalization list** for Codex/Copilot (`_lib.sh:104`) as seed data for the harness capability matrix — but as a *generated adapter* alongside a symlink for harnesses that tolerate the keys, never a strip-and-copy.
    - **Codex `[agents.<name>]` registration generation** (`sync_codex.sh:35-60`) — a concrete example of "projection requires generated glue, not a link".
    - **Artifact guardrail**: never write under `.git/`, never invent files an orphan references, never stamp attribution on things the tool did not ship (`SKILL.md:334-350`).
    - **Grounded ≤80-line ground-truth skill** with "No invention" (`:100-142`) as the right-sized repo-knowledge generator.
    - Detected-but-derived fields refresh (project description, `Languages:`, base branch) as "surgical field refresh — preserve all hand-written prose" (`:242`).
21. **Ideas to explicitly NOT copy, and why.**
    - **Copying skills instead of linking** (`_lib.sh:77-92`). An agent that edits `.claude/skills/x/SKILL.md` in-session loses the edit on next sync; the README even instructs users to commit both source and copies (`README.md:76`) — duplicated content in git by design.
    - **Per-surface hand-authored agent definitions** (four `engineer.*` files). It is "source of truth" only in the sense that four sources exist; drift between them is guaranteed and unchecked (`SKILL.md:228` only checks presence, not content equivalence).
    - **LLM prose as the reconcile engine.** Six audit classes with no code, no tests, and an 8 KB Codex skill cap that already makes the driver non-portable to the very harnesses it targets (`README.md:178`).
    - **Unconditional `cp -f` of `settings.json`** (`sync_claude.sh:34-36`) and `: > .codex/config.toml` rebuild (`sync_codex.sh:28`): both destroy user state outside the tool's fragments.
    - No dry-run in the scripts.
    - The opinionated bundled agents/rules (architect/engineer/no-commit-attribution/plan-before-code) — product content, not convergence.

**State/manifest formats (excerpts):**

```text
# .claude/skills/.agentsync-manifest  (one owned entry name per line, _lib.sh:4-10, 45-49)
grill-plan
orchestrate
acme-api-ground-truth
```

```sh
# agents/agentsync.conf (templates/agentsync.conf)
AGENTSYNC_VERSION="0.2.6"          # tool-owned; reconcile compares against running version
CLAUDE_MD_TARGET=".claude/CLAUDE.md"
OUTPUT_TRACKING="root-docs"        # all | root-docs | none
```

```gitignore
# >>> agentsync >>>          (apply_gitignore.sh:15-16, 23-29)
.claude/
.codex/
.opencode/
.github/agents/
.github/skills/
.agents/
# <<< agentsync <<<
```

```toml
# generated tail of .codex/config.toml (sync_codex.sh:40-59)
# --- Agent role registrations (generated by sync_codex.sh) ---
[agents.engineer]
description = "Senior engineer for acme-api. ..."
config_file = "agents/engineer.toml"
```

---

## 4. hana

**hana** — https://github.com/qodot/hana — HEAD `cfa1c6e5d60f6e9685445c7bb27aeb32b4d063af` (2026-03-24 16:25:54 +0900, default branch `main`) — License: MIT per `Cargo.toml:6` and README badge; **no LICENSE file** in the tree (GitHub reports `none`) — Language: Rust (edition 2024), crate `hanacli` 0.2.0 on crates.io, binary `hana`.

**Facts:** 0 stars, 0 forks; 40 commits over six weeks (2026-02-13 → 2026-03-24), then quiet. Five runtime crates (`clap`, `dirs`, `owo-colors`, `toml`, `unicode-width`) + `tempfile` dev (`Cargo.toml:15-23`). ~60 in-module `#[cfg(test)]` unit tests using `TempDir` (`AGENTS.md:27-31`). Ships a candid self-review, `DESIGN_REVIEW.md` (2026-02-24), listing operational defects. Commit messages are Korean; docs are bilingual.

### Single-copy model and symlink management

`SPEC.md:37-39`: "All sync is done through symlinks. No file copying." Source `.agents/skills/` (project) / `~/.agents/skills/` (global); instructions `AGENTS.md` / `~/.agents/AGENTS.md` (`config.rs:78-87`). Targets per agent (`config.rs:99-123`): Claude `.claude/skills` + `CLAUDE.md`; Codex `.agents/skills` + `AGENTS.md`; Pi `.pi/skills` + `AGENTS.md`; OpenCode `.opencode/skills` + `AGENTS.md`. Any target whose resolved path equals the source is dropped from the destination map — the agent is "native" and needs no link (`resolve_target_destinations.rs:30-32`; status shows it as `DirectRead`/`native`, `status.rs:119-121`, `main.rs:360`). Symlinks are **relative** (`relative_path.rs:5-23`; `broadcast_target_symlink.rs:79-82`; tests assert `is_relative()` `:158-163`).

### The 21 answers

1. **Problem solved.** Keep skills and the instruction file in sync across Claude Code, Codex, Pi, OpenCode from one source, and *collect* skills an agent created in its own dir back into the source (`README.md:6-27`). Commands/hooks/MCP explicitly out of scope "due to incompatible formats" (`README.md:44`; `SPEC.md:209-215`).
2. **Canonical source of truth.** `.agents/skills/` + `AGENTS.md`, justified as the Agent Skills standard path and the agents.md open standard (`SPEC.md:22-35`). Config `.agents/hana.toml` (`init.rs:106-146`), with legacy-format compatibility in the parser (`config.rs:163-170, 192`).
3. **Files it owns.** Symlink entries in each target skills dir; the instruction symlink (`CLAUDE.md → AGENTS.md`); skill directories it *moves* into the source; `.agents/hana.toml`.
4. **Files it merely reads.** Target dirs (to find real dirs to collect) and the instruction candidates.
5. **Symlinks used?** Yes, relative directory symlinks per skill and a relative file symlink for instructions (`broadcast_target_symlink.rs:115`; `sync.rs:311, 371-375`). Broken symlinks in target dirs are removed on every sync (`sync.rs:244-265`).
6. **When does it copy instead of symlink?** Never. Collection uses `fs::rename` (move), not copy (`move_target_skills.rs:118`).
7. **Handling of existing files.** A real file/dir at a link path → `Conflict` unless `--force`, in which case `remove_dir_all`/`remove_file` with **no backup** (`broadcast_target_symlink.rs:92-105`; tests `:184-240`). A symlink pointing elsewhere is silently replaced (`:111-114`; test `:258-283`). Source-side: collecting `x` when the source already has `x` → `SourceSkillConflict` unless `--force` **or** the existing source dir contains no files (only empty subdirs) — then auto-replaced (`move_target_skills.rs:9-22, 89-114`; this was the last commit, `cfa1c6e`). `hana init` → `AlreadyExists` unless `--force` (`init.rs:83-85`).
8. **Collision detection.** Same skill name found as a real dir in more than one agent dir → `SkillConflict` warning, **both left in place, nothing moved** (`move_target_skills.rs:70-80`; test `:238-274`). No content diff, no user prompt (SPEC says "Ask the user which one to keep", `SPEC.md:104-106`, but the code only warns).
9. **Quarantine.** None.
10. **Dry-run.** `--dry-run` on `init` and `sync` (`main.rs:40-43, 55-58`). Notably careful: in dry-run, pending collections are included in the broadcast plan so the output matches what a real run would do, and the collected skill's original location is not reported as a false conflict (`sync.rs:167-177, 296-305`; tests `:489-538`). Dry-run cleanup lists broken links without deleting (`:258-262`).
11. **Idempotent.** Yes: `AlreadyValid` when the existing link's raw target equals the computed relative target (`broadcast_target_symlink.rs:84-90`); `test_sync_idempotent` asserts the second run links nothing (`sync.rs:421-432`).
12. **Reverse adoption.** Yes, the core feature. Skills: any non-symlink directory in an enabled target dir is moved into the source and replaced by a symlink, then broadcast to the other agents (`collect_target_skills.rs:27` filter `is_dir && !is_symlink`; `move_target_skills.rs:43-140`; `sync.rs:142-186`). Instructions: if `AGENTS.md` is missing, the first agent with a *real* instruction file (e.g. `CLAUDE.md`) has it moved to `AGENTS.md` and replaced with a symlink (`sync.rs:336-388`; tests `:539-608`). No origin tracking.
13. **Drift prevention.** `hana status` with per-agent states `Synced | RealDir | BrokenSymlink | Missing | WrongTarget` for skills and `Synced | DirectRead | RealFile | Missing | Disabled` for instructions (`status.rs:27-43, 146-165`). Explicit philosophy: "No lock files or state files. The filesystem is the state." (`SPEC.md:112-118`). No checksums, no CI. **The exit code is always 0**, even when warnings/I/O failures occurred (`main.rs:166-171`; flagged as defect #1 in `DESIGN_REVIEW.md:10-13`), so it cannot gate CI; several I/O errors are swallowed with `let _ =` (`broadcast_target_symlink.rs:105, 109, 113`; `sync.rs:260`; `DESIGN_REVIEW.md:15-18`).
14. **Generates adapters?** No. Same bytes everywhere via link. Commands/hooks/MCP are declared out of scope precisely because they would need translation (`SPEC.md:209-212`).
15. **Committed or gitignored?** Unspecified for users. hana's own `.gitignore` ignores its own output in its own repo: `.agents/` and `CLAUDE.md` (`hana/.gitignore:4-6`). Relative symlinks would be commit-safe on POSIX.
16. **Tests.** Structural unit tests on `TempDir` covering config parsing, init, collection, conflicts, force, dry-run, idempotency, global mode, broken-link cleanup, instruction collection. No real harness binaries.
17. **Uninstall/reverse.** None.
18. **What breaks on Windows.** Does not compile: `std::os::unix::fs::symlink` is used unconditionally (`broadcast_target_symlink.rs:115`; `sync.rs:375`); no `cfg(windows)` anywhere (verified by grep).
19. **Symlink-hostile environments.** `IoFailed` warning, exit 0, no fallback.
20. **Ideas AgentConcord should adopt.**
    - Relative symlinks always (`relative_path.rs`), asserted in tests.
    - "Same resolved path as source ⇒ native, no projection needed" as a first-class state (`resolve_target_destinations.rs:30-32`; `InstructionState::DirectRead`).
    - Collection semantics: a real dir in a harness location is *new canonical content*, moved (not copied) into the source and replaced by a link, then broadcast (`move_target_skills.rs`). This is the reverse-adoption primitive.
    - Instruction-file collection when the canonical is missing (`sync.rs:336-388`).
    - Dry-run that models pending moves so the plan equals the real run (`sync.rs:167-177`).
    - Status vocabulary (`Synced/RealDir/BrokenSymlink/Missing/WrongTarget/DirectRead/RealFile/Disabled`).
    - Per-agent, per-feature enable toggles and overridable paths in TOML (`init.rs:106-146`).
    - The `DESIGN_REVIEW.md` recommendation to split pure *plan* (`Vec<Operation>`) from *apply*, so dry-run and real runs share logic (`DESIGN_REVIEW.md:63-66`).
    - Broken-symlink cleanup as a sync phase (`sync.rs:244-265`) — but gated by the manifest (see cross-cutting).
21. **Ideas to explicitly NOT copy, and why.**
    - `--force` = `remove_dir_all` with no backup and no diff (`broadcast_target_symlink.rs:93-100`).
    - Exit code 0 on failure and swallowed I/O errors (`main.rs:170`; `DESIGN_REVIEW.md:10-22`).
    - "The filesystem is the state" (`SPEC.md:112-118`): without an ownership record, `MISSING` cannot distinguish "user deleted the link intentionally" from "drift", and `clean_broken_symlinks` will delete *any* dangling symlink in a target dir, including ones hana never created (`sync.rs:244-256`).
    - Symlinking `CLAUDE.md → AGENTS.md` unconditionally assumes their contents are identical; real repos carry Claude-only rules in CLAUDE.md. AgentConcord needs "CLAUDE.md = AGENTS.md + Claude delta" as a generated file, or a link only when the delta is empty.
    - Warning-only handling of same-name skills in multiple agents with no diff or resolution path (`move_target_skills.rs:70-80`).
    - Unix-only symlink API.

**State/manifest formats (excerpt):**

```toml
# .agents/hana.toml (init.rs:106-146)
[source]
skills_path = ".agents/skills"
skills_path_global = "~/.agents/skills"
instruction_path = "AGENTS.md"
instruction_path_global = "~/.agents/AGENTS.md"

[target.claude]
skills = true
instructions = true
skills_path = ".claude/skills"
instruction_path = "CLAUDE.md"
instruction_path_global = ".claude/CLAUDE.md"
```

No other state file exists by design.

---

## 5. sync-skills

**sync-skills** — https://github.com/Tasihi89/sync-skills — HEAD `cd938e912da1fa78a24e20d4daf05bd523092190` (2026-06-17 17:38:39 +0800, default branch `main`) — License: **none** (no LICENSE file, no declaration) — Language: Bash scripts + a Markdown SKILL.md that instructs the agent (the "7 scenarios").

**Facts:** 27 stars (most of the five), 2 forks, 0 issues; exactly 1 commit (a squash on 2026-06-17); no activity since. Required deps: bash, `ln`/`mv`/`cp`/`find`/`readlink`/`ls -id`; optional `python3` + PyYAML (frontmatter validation) and `sqlite3` (Codex rejection log) (`README.md:46-49`). No tests. Scope is **user-global** (`~/.claude/skills`, `~/.codex/skills`), not per-project.

### Single-copy model, pointer indirection, reconcile

```text
source (the body, the only copy, can move house)          ~/skill-source
     ▲
pointer ~/.skill-source  ← moving house only changes this one link
     ▲
┌────┴────┐  each end's symlink routes THROUGH the pointer, never at the source's absolute path
Claude   Codex
```
(`README.md:9-19`; `SKILL.md:12-22`.) "There is no 'sync' action, because there is no second copy." Ends link to `$SOURCE/$NAME` where `$SOURCE` defaults to the pointer path `$HOME/.skill-source` (`migrate.sh:16, 75`), so a relocation is one `rm`+`ln -s` on the pointer (`SKILL.md:105-108`). Iron rule 3: "never let an end's symlink point directly at the source's absolute path" (`SKILL.md:55`).

### The 21 answers

1. **Problem solved.** One body per skill shared between Claude Code and Codex at the user level, with adoption of side-loaded skills, reversible release, and a read-only reconcile scan (`README.md:3-19, 34-44`).
2. **Canonical source of truth.** `~/skill-source/<name>/` behind the `~/.skill-source` pointer symlink (`install.sh:14, 23, 44-57`). Each adopted skill carries a `.sync-origin` marker (`claude|codex|both`) recording where it came from (`migrate.sh:57-65`).
3. **Files it owns.** The source dir contents, `.sync-origin`, the pointer, and the per-skill symlinks in both end dirs. `install.sh` also copies sync-skills itself into the source (`:59-66`).
4. **Files it merely reads.** End dirs, `~/.skill-source-ignore` (`scan.sh:11, 41-53`), `~/.codex/skills/.system/` builtins and `~/.claude/plugins/cache/` plugin skills (count only, never touched, `scan.sh:164-168`; `judgment.md:75-81`), and optionally the Codex sqlite log for "failed to load skill" (`SKILL.md:150-153`).
5. **Symlinks used?** Yes: one directory symlink per skill per end, targeting the *pointer path* (`migrate.sh:73-75`), plus the pointer itself. Absolute paths (through `$HOME`), so portable across machines only via the pointer.
6. **When does it copy instead of symlink?** Only when *leaving* management: `release.sh:68-75` copies the body out to the ends chosen by origin, verifies `SKILL.md` exists, then deletes the source last ("Land before deleting the body", `SKILL.md:47`). And the one-time bootstrap copy of itself (`install.sh:63`).
7. **Handling of existing files.** Refuse-first: migrate aborts if the source already has the name (`migrate.sh:42`), if the *other* end has a same-name real dir ("diff & merge to a superset first", `:43-45`), if the origin is already a symlink (`:41`), or if a real file sits where the link must go (`:74`); an existing symlink at the link path is replaced (`:73`). install reuses an existing pointer even if it points elsewhere (`install.sh:46-51`) and aborts if the pointer path is a non-symlink (`:52-53`). No backups anywhere.
8. **Collision detection.** `scan.sh:104-109` flags each candidate with `SOURCE_CONFLICT`, `DUP_BOTH_SIDES`, `COLLIDES_CODEX_BUILTIN`. Resolution is a documented human procedure, the "superset rule": `diff -rq A B -x .DS_Store`; if only one side has extra files take the superset; if `SKILL.md` bodies differ, stop and show the user (`judgment.md:47-51`). Also validates SKILL.md frontmatter as YAML because Codex silently rejects invalid frontmatter (`scan.sh:138-161`, `FRONTMATTER_INVALID`).
9. **Quarantine.** None. `~/.skill-source-ignore` is a "permanently single-host, stop asking" list that folds noise into one `CANDIDATE_IGNORED` line (`scan.sh:41-53, 100-103, 113`; `references/single-host.example`).
10. **Dry-run.** Default-on for the destructive scripts: `remove.sh` and `release.sh` print the plan and exit unless `--confirm` (`remove.sh:84-90`; `release.sh:62-64`); deleting a *real* dir additionally requires `--force-real` (`remove.sh:92-95`). `migrate.sh` has **no** dry-run (executes `mv` immediately, `:46`) — an asymmetry.
11. **Idempotent.** `migrate.sh <name> link` re-creates links (removing stale symlinks first, `:73-75`) and verifies by inode (`:79-90`); `scan.sh` is read-only; `install.sh` skips existing pointer and existing copy (`:46-51, 60-61`).
12. **Reverse adoption.** Yes — this is the tool's whole shape. A real dir on one end is `mv`'d into the source and both ends are linked (`migrate.sh:37-47, 67-77`), origin recorded (`:57-65`); `release.sh` reverses it and *re-attributes by origin* so a skill that came from Codex goes back only to Codex with no leftover Claude copy (`release.sh:33-54`; `--both` overrides). "Full exit" is deliberately per-skill: "No one-click batch (too dangerous)" (`SKILL.md:120-123`).
13. **Drift prevention.** The reconcile scan's signal vocabulary `LINK_OK / BROKEN_LINK / LINK_ELSEWHERE / REAL_DIR / CANDIDATE / MISSING_LINK / SIDE_ABSENT / CANDIDATE_IGNORED / FRONTMATTER_INVALID / POINTER_BROKEN / NO_SOURCE` (`scan.sh:18-24, 73-84, 118-128`; table in `SKILL.md:35-42`); post-migrate inode verification (`migrate.sh:79-90`). No manifest, no checksums, no CI. `MISSING_LINK` is documented as *ambiguous* — restore, or the other half of a deliberate removal — and the agent must ask (`scan.sh:124`; `SKILL.md:101`).
14. **Generates adapters?** No. Instead it argues the body is universal and host-specific config *travels with the body*: Codex reads `agents/openai.yaml` and ignores Claude-only frontmatter; `disable-model-invocation: true` maps to `policy.allow_implicit_invocation: false` (`judgment.md:7-17, 53-67`; `agents/openai.yaml`). The judgment reference is a genuine portability analysis: which frontmatter fields Codex ignores, mechanism words to grep in bodies (`subagent|Task tool|allowed-tools|context: ?fork|CLAUDE\.md|hooks?|\$ARGUMENTS|slash|plugin`), and the "broken vs degraded" test (`judgment.md:19-44`).
15. **Committed or gitignored?** Not applicable (operates in `$HOME`). Its own repo gitignores `.sync-origin` (`.gitignore:5-6`).
16. **Tests.** None. The closest thing to real-harness validation is the documented `sqlite3 ~/.codex/logs_2.sqlite "... LIKE '%failed to load skill%'"` query to see what Codex actually rejected (`SKILL.md:150-153`), and the frontmatter YAML check that exists *because* of an observed silent rejection.
17. **Uninstall/reverse.** `release.sh` per skill (copy out by origin, drop other end's link, delete source last), then reverse the pointer by hand (`SKILL.md:120-124`). `remove.sh` with scopes `all|claude|codex`.
18. **What breaks on Windows.** Everything: bash, `ln -s`, `readlink`, `ls -idL`, `$HOME` paths. No consideration at all.
19. **Symlink-hostile environments.** Unsupported; the pointer itself is a symlink.
20. **Ideas AgentConcord should adopt.**
    - **Pointer indirection**: one stable path that every projection targets so the canonical can relocate with one change (`install.sh:55`; `SKILL.md:55, 105-108`). In a repo this becomes "every symlink targets `.agentconcord/canonical` (or a fixed relative path), never a deep path".
    - **Origin marker for reversible adoption** (`.sync-origin`, `migrate.sh:57-65`; `release.sh:33-54`): AgentConcord's manifest should record, per adopted item, which harness it came from so `unadopt`/`eject` can restore the original topology.
    - **Default dry-run + `--confirm` + `--force-real`** for anything destructive (`remove.sh:84-95`).
    - **Land-before-delete** ordering in release (`release.sh:67-83`).
    - **Inode verification** after linking (`migrate.sh:79-90`).
    - **Signal vocabulary** with explicit "ambiguous, ask" states (`MISSING_LINK`) rather than guessing.
    - **Signal ≠ verdict** shareability analysis: frontmatter field table, mechanism-word grep, "broken vs degraded" (`judgment.md`) — directly reusable as the rule set for deciding *symlink vs generated adapter vs native-only* per skill.
    - **Context-cost awareness**: each shared skill's name+description costs ~60-130 tokens on both ends and Codex caps the list (~8,000 chars) so "will it be used on both ends" is a real question (`judgment.md:69-73`). The audit should report projected context cost per harness.
    - **Superset rule** for same-name-both-sides merges: host-specific files travel with the body; if bodies differ, stop (`judgment.md:47-51`).
    - **Never touch vendor/builtin/plugin skills**; report only (`judgment.md:75-81`).
21. **Ideas to explicitly NOT copy, and why.**
    - User-global scope only. AgentConcord is repo-scoped; global/user surfaces are a later layer.
    - The agent (LLM) as the orchestrator of all seven scenarios; scripts are thin helpers with no tests.
    - `migrate.sh` with no dry-run while `mv`-ing user content (`:46`).
    - Symlinks with absolute `$HOME` targets (`migrate.sh:75`), even if routed through the pointer.
    - Resolving `MISSING_LINK` ambiguity by asking every time — a manifest that records intent (`removed-by-user`) removes the ambiguity.
    - No license; cannot be vendored.

**State/manifest formats (excerpts):**

```text
# ~/skill-source/<skill>/.sync-origin   (migrate.sh:57-65; release.sh:33-36)
codex

# ~/.skill-source-ignore                (references/single-host.example)
# one skill name per line; '#' comments; exact match
my-local-only-skill
some-plugin-supplied-skill
```

```yaml
# <skill>/agents/openai.yaml  (Codex-side equivalent of Claude-only frontmatter, judgment.md:57-65)
interface:
  display_name: "Sync Skills"
  short_description: "..."
  default_prompt: "Use $sync-skills ..."
policy:
  allow_implicit_invocation: false   # == disable-model-invocation: true
```

---

## Patterns across the five

1. **Everyone picks one canonical location, and they disagree.** hana, sync-skills (by analogy) and agent-smith converge on `.agents/skills/` + `AGENTS.md` as the Agent Skills / agents.md standards (`hana/SPEC.md:22-35`; `agent-smith/README.md:69-72`). agentsync uses a non-dot `agents/` tree (`README.md:19-37`); agent-sync hardcodes `.agent/skills` (singular) (`skill-sync.ts:128`). The `.agent` vs `.agents` confusion is not cosmetic: it is the exact topology that produced agent-sync's data-loss incident (`devlog/_fin/260227_circular_symlink_debug_fin.md:5-11`). AgentConcord's inspector must treat near-identical sibling directories as a first-class collision class.

2. **Two camps: linkers and copiers, and neither has both halves.** Linkers (hana, sync-skills, agent-sync skills, agent-smith aliases) get single-copy semantics for free but have **no ownership record** — hana says so explicitly ("The filesystem is the state", `SPEC.md:112-118`) — so they cannot tell an intentional removal from drift and hana's cleanup deletes any dangling symlink it finds (`sync.rs:244-256`). The copier (agentsync) has the only **ownership manifest** (`_lib.sh:4-50`) and therefore the only merge-safe pruning, but pays with duplicated content and lost in-place edits. Nobody does *manifest + symlinks*. That combination is AgentConcord's core mechanism: a manifest entry per projected path (`kind: symlink|generated|native`, source, hash, origin, tracking tier) and symlinks wherever the harness tolerates them.

3. **Reverse adoption exists in three forms.** Move-and-link-back (hana `move_target_skills.rs`; sync-skills `migrate.sh`), prose back-port of direct-target edits (agentsync `SKILL.md:294`), and copy-with-validation of generated content (agent-smith `adopt_generated_skill.py`). Only sync-skills records **origin** (`.sync-origin`) so adoption is reversible per item. AgentConcord should adopt hana's primitive with sync-skills' origin marker and agent-smith's validate-then-commit gate.

4. **The instruction file is the unsolved case.** Three strategies: symlink `CLAUDE.md → AGENTS.md` (hana `sync.rs:311`; agent-smith alias), N identical copies (agent-sync `agents-md.ts:80-95`), or per-surface hand-authored files (agentsync). None models the real situation — CLAUDE.md is usually `AGENTS.md` **plus a harness-specific delta** (Claude-only rules, `@import`s, hooks references). AgentConcord needs a "generated file = canonical + delta, with provenance header" projection type, and a link only when the delta is empty.

5. **Conflict handling maturity ranges from destructive to refusal.** hana `--force` = `remove_dir_all`, no backup (`broadcast_target_symlink.rs:93-100`); agent-sync silently backs up into `$HOME` (`symlink.ts:161-166`); sync-skills refuses and asks for a diff (`migrate.sh:42-45`); agentsync preserves foreign entries by manifest; agent-smith refuses to replace a real directory *even with `--force`* (`ensure_local_alias.py:183-185`). The right composite: refuse by default, offer an in-repo, gitignored, reported quarantine, and never recursive-delete anything the manifest does not own.

6. **Dry-run is a maturity marker.** hana has a proper flag whose plan matches the real run (`sync.rs:167-177`); sync-skills makes destructive scripts dry-run *by default* (`remove.sh:84-90`); agent-smith makes the expensive staging step dry-run by default (`run_openwiki_staged.py:10`). agent-sync and agentsync have none — and agent-sync's postmortem lists that absence as bug B5 (`:80`). AgentConcord: `plan` is the default verb; `apply` is explicit.

7. **Nobody automates validation of real harness behavior, but everyone discovered harness facts the hard way.** agentsync: Codex ≥ 0.137 only spawns agents registered under `[agents.<name>]` in a *trusted* project, skills auto-discover under `.agents/skills/` but not `./skills/`, Codex rejects `argument-hint` (`CHANGELOG.md:8, 13`). sync-skills: Codex silently rejects a SKILL.md whose frontmatter is not valid YAML (colon+space unquoted), diagnosable via `~/.codex/logs_2.sqlite` (`SKILL.md:54, 150-153`); Codex skill list has a ~8,000-char cap (`judgment.md:71`). agent-smith: Windows directory symlinks need Developer Mode, junctions do not; `Path.is_symlink()` is False for junctions (`ensure_local_alias.py:19-30`); many harnesses only scan skills at startup so a restart is needed (`harness-profile-adapter/SKILL.md:60`). agent-sync: Antigravity does not expand `${VAR}` in MCP config (`CLAUDE.md:108`). These belong in AgentConcord's **harness capability matrix** as data, each backed by a fixture test that invokes the real binary where possible (`codex --help`, `claude plugin validate`, spawning a harness in a temp repo and asserting discovery).

8. **Windows: two consider it, one gets it right.** agent-sync falls back symlink → junction → *silent copy* (`symlink.ts:142-159`) and mis-detects Windows absolute paths (`:20-23`). agent-smith falls back symlink → junction → *loud failure*, detects reparse points, resolves shims, redirects `USERPROFILE` (`ensure_local_alias.py`, `check_prereqs.py:35-36`). hana does not compile on Windows; agentsync and sync-skills are bash. AgentConcord must ship the agent-smith ladder and add a *generated-copy-with-manifest-hash* fallback as an explicit, reported, manifest-recorded projection kind — never a silent copy.

9. **Tests are structural everywhere.** hana (~60 Rust unit tests), agent-sync (26 vitest), agent-smith (~130 unittest, subprocess mocked) test filesystem outcomes on temp dirs. agentsync and sync-skills have zero tests. None launches a harness. Coverage of *the operations that lose data* (force-replace, collection, cycle) is best in agent-sync (incident-driven) and agent-smith (refuse-real-dir, junction removal).

10. **Prose-driven orchestration is the dominant anti-pattern.** agentsync, sync-skills, and agent-smith put the decision logic in `SKILL.md` for an LLM to execute; the scripts are helpers. agent-smith documents the failure mode in its own text: a required step was silently dropped by prose compression (`agent-ready-context/SKILL.md:71`). agentsync's driver already exceeds Codex's 8 KB skill cap (`README.md:178`). AgentConcord must be a deterministic CLI with a thin skill wrapper, not the other way round.

11. **Only agentsync has a migration story.** `AGENTSYNC_VERSION` stamp + "Upgrades by version" ledger, merging into customized files and refusing to advance the stamp past declined upgrades (`SKILL.md:311-320, 298`). Every other tool has no notion of "the tool changed since this repo was set up".

12. **Frontmatter portability is understood by two tools in complementary ways.** agentsync strips a fixed list of Claude/OpenCode-only keys before copying to Codex/Copilot (`_lib.sh:104`); sync-skills provides the analysis of *why* each key matters, which ones merely degrade (`argument-hint`) vs which break (`allowed-tools` as a safety boundary, `context: fork`), and the Codex-side equivalent file (`judgment.md:7-17, 53-67`). Together they define AgentConcord's per-skill decision: portable frontmatter → symlink; non-portable but degrading → symlink + host-side sidecar (`agents/openai.yaml`); breaking → generated adapter or native-only.

13. **Git tracking is a policy, not a default.** agentsync's `OUTPUT_TRACKING` (`all|root-docs|none`) with a delimited `.gitignore` block (`apply_gitignore.sh`) and agent-smith's three tiers (local `.git/info/exclude` / team `.gitignore` / committed; `git-tracking-policy.md`) are both correct; they differ in default (agentsync ignores bulky dirs, agent-smith excludes locally). AgentConcord should expose the same three tiers *per projection kind*, default: symlinks committed (relative), generated files committed with provenance header, quarantine and per-user notes ignored.

14. **Managed regions inside human-owned files** appear twice and both are done carefully: agent-smith's `<!-- okf:start/end -->` with line-exact matching and self-healing (`merge_agents_md_okf_section.py:13-41`), agentsync's `# >>> agentsync >>>` block in `.gitignore` (`apply_gitignore.sh:51-57`). This is how AgentConcord should inject routing into existing CLAUDE.md/AGENTS.md/.gitignore without claiming the whole file.

15. **Vendor/plugin/builtin content is off-limits in the two tools that thought about it.** sync-skills never touches `~/.codex/skills/.system/` or plugin-cache skills (`judgment.md:75-81`); agent-smith treats vendor skills as read-only dependencies with a lockfile (`references/vendor-skill-management.md:20-27`). AgentConcord's inspector must classify plugin/marketplace/vendored content as `native-only, read-only` and exclude it from convergence.

## Adopt / Reject / Why

| Idea | Source (evidence) | Verdict | Why |
|---|---|---|---|
| Per-directory ownership manifest listing what the tool owns; prune only owned-and-stale; never touch foreign entries | agentsync `_lib.sh:4-50` | **Adopt** (extend to a repo-level manifest with source, hash, kind, origin, tier) | Only mechanism that makes shared dirs like `.claude/skills/` safe; also resolves hana's "is MISSING drift or intent?" ambiguity |
| Relative symlinks, asserted in tests | hana `relative_path.rs`, `broadcast_target_symlink.rs:79-82, 158-163` | **Adopt** | Commit-safe, clone-safe; agent-sync's absolute targets are not |
| Symlink target through one stable indirection point | sync-skills `install.sh:55`, `SKILL.md:55` | **Adopt** (as a fixed relative canonical root, not a `$HOME` pointer) | One-change relocation; avoids deep-path links that rot |
| Collection: real dir in a harness location ⇒ move to canonical, link back, broadcast | hana `move_target_skills.rs`, `sync.rs:142-186` | **Adopt** | This is reverse adoption; move (not copy) preserves single-copy invariant |
| Origin marker on adopted items; release re-attributes by origin | sync-skills `migrate.sh:57-65`, `release.sh:33-54` | **Adopt** (as a manifest field) | Makes adoption reversible per item; enables `eject` |
| Land-before-delete ordering; verify then remove source last | sync-skills `release.sh:67-83` | **Adopt** | Zero-loss uninstall/eject |
| "Same resolved path as canonical ⇒ native, no projection" state | hana `resolve_target_destinations.rs:30-32`, `status.rs:119-121` | **Adopt** | Prevents self-links and models harnesses that already read the canonical path |
| Cycle detection (ELOOP, chain walk, depth cap) + inode/realpath identity before any link | agent-sync `symlink.ts:29-71`, `skill-sync.ts:90-109` | **Adopt** | Incident-proven; `.agent` vs `.agents` chains exist in real repos |
| Refuse to replace a real directory even with `--force` | agent-smith `ensure_local_alias.py:183-185` | **Adopt** | Directories are where user content lives; force must never mean rm -rf |
| Backup-before-replace | agent-sync `symlink.ts:117-125, 161-166` | **Adopt with changes**: in-repo `.agentconcord/quarantine/<ts>/`, gitignored, reported in the plan | Their version is silent and in `$HOME` (postmortem B6) |
| Plan/apply split; `plan` default, `apply` explicit; destructive ops require `--confirm` | hana `--dry-run` `sync.rs:167-177`; sync-skills `remove.sh:84-95`; hana `DESIGN_REVIEW.md:63-66` | **Adopt** | Dry-run absence is the #1 regret in agent-sync's postmortem (B5) |
| Status/signal vocabulary with explicit "ambiguous" states | hana `status.rs:27-43`; sync-skills `scan.sh` / `SKILL.md:35-42` | **Adopt** (merged vocabulary: Synced, Native, RealDir/Candidate, BrokenLink, WrongTarget, Missing-intentional, Missing-drift, Foreign, ReadOnlyVendor, FrontmatterInvalid) | Audit output must be machine-checkable and CI-gateable |
| Non-zero exit on any warning/failure | hana `DESIGN_REVIEW.md:10-13` (as a defect to avoid) | **Adopt** | hana's exit-0 makes it useless in CI |
| Marker-delimited managed block in human-owned files; line-exact matching; self-heal | agent-smith `merge_agents_md_okf_section.py:13-41, 93-167`; agentsync `apply_gitignore.sh:51-57` | **Adopt** | Inject routing into CLAUDE.md/AGENTS.md/.gitignore without owning them |
| Three-tier tracking policy (local exclude / team ignore / committed), per projection kind | agent-smith `git-tracking-policy.md`; agentsync `OUTPUT_TRACKING` | **Adopt** | Teams differ; the tool must not decide for them, but must default sanely |
| Version stamp + upgrade ledger; do not advance stamp past declined upgrades | agentsync `SKILL.md:13, 298, 311-320` | **Adopt** | Only migration mechanism in the set; AgentConcord will change its canonical layout over time |
| Co-ownership detection (foreign banners/manifests) with reciprocal-clobber warning | agentsync `SKILL.md:352-358` | **Adopt** | Other generators (and other instances of these five tools) will be present |
| Report foreign/orphan artifacts; never adopt or repair them; never write under `.git/` | agentsync `SKILL.md:334-350` | **Adopt** | Prevents the tool from "fixing" things it does not understand |
| Frontmatter portability analysis: field table, mechanism-word grep, broken-vs-degraded, Codex sidecar mapping | sync-skills `judgment.md`; agentsync `_lib.sh:104` | **Adopt** as the rule engine for symlink vs sidecar vs generated-adapter per skill | Two independent tools converged on the same key list; it is real |
| Context-cost reporting per harness (tokens per shared skill; Codex list cap) | sync-skills `judgment.md:69-73` | **Adopt** | Convergence is not free; the audit should show the bill |
| Codex `[agents.<name>]` registration generation from agent files | agentsync `sync_codex.sh:35-60` | **Adopt** as a generated-adapter template | Verified fact: Codex does not auto-discover; a link is insufficient |
| Neutral model + per-harness renderers for MCP | agent-sync `mcp-sync.ts:39-77` | **Adopt the shape**, not the implementation | Correct adapter architecture; but parse/serialize with real TOML/JSON libs preserving unknown keys |
| Harness capability matrix backed by fixture tests against real binaries | agentsync `CHANGELOG.md:8`; sync-skills `SKILL.md:150-153`; agent-smith junction tests | **Adopt** (new; none of them automate it) | Every tool learned these facts manually; AgentConcord's differentiator is validating real behavior |
| "Installed ≠ active harness" detection heuristics | agent-smith `inspect_runtime_context.py`, `runtime-detection.md` | **Adopt** for the `validate` step | Deciding what to validate against needs the active harness, not `$PATH` |
| Zero-LLM validators in a CI template with pinned action SHAs; near-duplicate slug and unclosed-fence checks | agent-smith `okf-validate.ci.yml`, `validate_okf_bundle.py:52-69, 218-230` | **Adopt** | Drift prevention must be deterministic and CI-gateable |
| No-op run must be byte-identical (no timestamp/key-order churn) | agent-smith `workflow.md:61` | **Adopt** as a test invariant | Idempotency you can diff |
| Grounded, capped (≤80 lines), "no invention" repo ground-truth skill | agentsync `SKILL.md:89-142` | **Adopt** (optional, offline, deterministic scaffold) | Right-sized repo-specific knowledge; agent-smith's compiled wiki is the wrong size |
| Orientation / durable knowledge / actions / adapters taxonomy; progressive disclosure (entry file routes, never deep-links) | agent-smith `README.md:66-77`, `workflow.md:108-110` | **Adopt as classification and layout principle** | Good axis for the audit and for keeping the canonical entry file short |
| Vendor/plugin/builtin content is read-only and excluded from convergence | sync-skills `judgment.md:75-81`; agent-smith `vendor-skill-management.md` | **Adopt** | Plugin cache paths are versioned; linking into them breaks on update |
| OKF/OpenWiki knowledge-compilation pipeline (staged LLM producer, citation gate, promote) | agent-smith `run_openwiki_staged.py`, `agent-ready-context/SKILL.md` | **Reject** for AgentConcord's core | Different problem (repo memory); LLM-in-the-loop, Node/pnpm/fnm/OAuth dependency surface, non-deterministic; treat an existing `okf/wiki` as a knowledge surface to route to. Keep only the *stage → review.diff → transactional promote* pattern for any generated files |
| LLM-authored harness adapters "by reasoning from current docs" | agent-smith `harness-profile-adapter/SKILL.md:84-88` | **Reject** | Non-deterministic, unvalidated; adapters must be code-generated from the tested capability matrix |
| Prose (`SKILL.md`) as the orchestration engine | agentsync, sync-skills, agent-smith | **Reject** | Steps get silently dropped (`agent-ready-context/SKILL.md:71`); exceeds Codex skill cap (`agentsync/README.md:178`); untestable. A skill may *wrap* the CLI |
| Copying skills into harness dirs | agentsync `_lib.sh:77-92`; agent-sync copy fallback | **Reject** (except as an explicit, manifest-recorded, hash-checked fallback kind on symlink-hostile filesystems) | In-place agent edits are lost; duplicate content in git |
| N identical instruction files with no canonical | agent-sync `agents-md.ts:80-95` | **Reject** | Immediate drift; AgentConcord generates `CLAUDE.md = canonical + delta` with provenance, or links when delta is empty |
| Unconditional symlink `CLAUDE.md → AGENTS.md` | hana `sync.rs:311` | **Reject as default** | Ignores legitimate Claude-only deltas; link only when the audit proves the delta is empty |
| Per-surface hand-authored agent definitions as "source of truth" | agentsync `templates/{claude,codex,github,opencode}/agents/` | **Reject** | Four sources is zero sources; generate per-surface from one definition, preserve native-only fields as a sidecar |
| `--force` = recursive delete, no backup, no diff | hana `broadcast_target_symlink.rs:93-100` | **Reject** | Data loss by flag |
| Silent copy fallback on symlink failure; result still says `created` | agent-sync `symlink.ts:142-159` | **Reject** | Violates the single-copy promise invisibly; agent-smith's loud ladder is the model |
| Absolute symlink targets | agent-sync `symlink.ts:145`; sync-skills `migrate.sh:75` | **Reject** | Break on clone/move |
| Two-hop symlink chains and hardcoded canonical paths | agent-sync `skill-sync.ts:128, 143-152` | **Reject** | Root cause of a real data-loss incident |
| Regex patching of TOML / `Object.assign` rewriting of user JSON | agent-sync `mcp-sync.ts:79-93` | **Reject** | Lossy; use real parsers and preserve unknown keys, or refuse |
| Unconditional `cp -f` of `settings.json`; truncate-and-rebuild `.codex/config.toml` | agentsync `sync_claude.sh:34-36`, `sync_codex.sh:28` | **Reject** | Clobbers user permissions and config outside the tool's fragments; use managed blocks |
| "Filesystem is the state", no manifest | hana `SPEC.md:112-118` | **Reject** | Cannot distinguish intent from drift; cleanup deletes unowned dangling links |
| Deleting any broken symlink found in a target dir | hana `sync.rs:244-256` | **Reject** (gate on manifest ownership) | Not ours to delete |
| Global `$HOME` writes as a side effect of a project command; backups in `$HOME` | agent-sync `config.ts:9-16`, `symlink.ts:15-18` | **Reject** | Repo-scoped tool; user-global surfaces are a separate, explicit mode |
| Leaking one harness's frontmatter (`trigger: always_on`) into all projections | agent-sync own repo `CLAUDE.md:1-5` | **Reject** | Exactly the format contamination AgentConcord exists to stop |
| Resolving `MISSING_LINK` ambiguity by asking every scan | sync-skills `scan.sh:124` | **Reject** (record intent in manifest instead) | Ask once at removal, not on every audit |
| Unix-only symlink calls; bash-only implementation | hana `broadcast_target_symlink.rs:115`; agentsync; sync-skills | **Reject** | AgentConcord must run where the harnesses run, including Windows |
| All-rights-reserved licensing of generated content | agent-smith `LICENSING.md:49-67` | **Reject** | Files written into user repos must carry no license surprise |
