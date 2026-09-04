# Harness behavior — Claude Code, Codex CLI, OpenCode (verified 2026-09-04)

Evidence classes: **[doc]** official documentation fetched 2026-09-04 · **[bin]** string /
behavior observed in the installed binary · **[test]** reproduced on a throwaway fixture repo
on macOS 15 (Darwin 25.6) with the installed versions below. Every fact AgentConcord's
capability matrix relies on must carry one of these, plus the date. Tool behavior drifts;
re-verify on version change.

| Tool | Version tested | Docs root |
|---|---|---|
| Claude Code | 2.1.259 | https://code.claude.com/docs/en/ (memory, skills, sub-agents, settings, hooks, permissions) |
| Codex CLI | 0.144.4 (0.153.1 is current upstream, 2026-09-03) | https://developers.openai.com/codex/ → redirects to https://learn.chatgpt.com/docs/ |
| OpenCode | 1.18.20 (1.18.27 current) | https://opencode.ai/docs/ (v1); https://opencode.ai/v2/docs/ is a separate binary `opencode2` |

## 1. Instruction files

| Behavior | Claude Code | Codex | OpenCode (v1) |
|---|---|---|---|
| Native instruction file | `CLAUDE.md` (root, parents, `.claude/CLAUDE.md`, `CLAUDE.local.md`, nested lazily) [doc] | `AGENTS.md` — `~/.codex/AGENTS(.override).md`, then per-dir `AGENTS.override.md` → `AGENTS.md` → `project_doc_fallback_filenames`, walking repo root → cwd, concatenated root-first, 32 KiB default cap [doc][bin] | `AGENTS.md` walking cwd → git worktree root; `CLAUDE.md` **only if no `AGENTS.md`**; deprecated `CONTEXT.md`; global `~/.config/opencode/AGENTS.md` else `~/.claude/CLAUDE.md` [doc] |
| Reads `AGENTS.md`? | **No** natively. Official interop: `@AGENTS.md` import in `CLAUDE.md`, or symlink (import recommended on Windows) [doc] | Yes [doc] | Yes (preferred over CLAUDE.md) [doc] |
| `@path` imports | Yes, ≤4 hops, relative to the importing file, ignored inside code spans/fences [doc]; `@AGENTS.md` **[test]** | No | No (has `instructions:` globs/URLs in `opencode.json` instead) [doc] |
| Symlinked instruction file | `CLAUDE.md -> AGENTS.md -> canon/AGENTS.md` chain followed **[test]** | `AGENTS.md -> canon/AGENTS.md` followed **[test]** (`codex debug prompt-input` shows content) | Existence checks use `fs.exists` (follows symlinks) — source-level; docs only "suggest" symlinks for sharing |
| Nested / scoped | Nested `CLAUDE.md` loaded when files in the subtree are touched; `.claude/rules/*.md` with `paths:` globs [doc][bin] | Nested `AGENTS.md` on the root→cwd path only [doc] | Nested `AGENTS.md` attached lazily when a tool touches a file below (source-level, undocumented) |
| Size guidance | keep under ~200 lines; `/doctor` proposes trims [doc] | 32 KiB total cap [doc] | none |
| OpenCode 2 | — | — | reads **only** `AGENTS.md` (no CLAUDE.md fallback) [doc, v2 migrate page] |

## 2. Skills (Agent Skills spec: `SKILL.md`, `name` = dir, `[a-z0-9-]` ≤64, `description` ≤1024)

| Behavior | Claude Code | Codex | OpenCode |
|---|---|---|---|
| Project paths | `.claude/skills/<n>/SKILL.md`; nested per-directory `.claude/skills` [doc] | `.agents/skills` in cwd and every parent to repo root [doc]; `.codex/skills` legacy/undocumented | `.opencode/skills`, `.claude/skills`, `.agents/skills`, walking to worktree root [doc] |
| Reads `.agents/skills`? | **No** (0 hits in binary; open feature request #66352) [bin][doc] | Yes [doc][test] | Yes (since v1.1.50) [doc][test] |
| Reads `.claude/skills`? | Yes | **No** [doc][test] | Yes (compat; `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` turns off) [doc] |
| Directory symlink `.claude/skills -> ../.agents/skills` | **Followed** — debug log `project=[…/.claude/skills]`, `project: N` **[test]** | n/a | n/a |
| Per-skill folder symlink | followed (chained through the dir symlink) **[test]** | "follows the symlink target when scanning" [doc] **[test]** | followed **[test]** |
| Duplicate names | — | both appear, no merge [doc] | first loaded wins, warning [doc][test] |
| Extra frontmatter | Claude-only: `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `context: fork`, `agent`, `hooks`, `paths` [doc] | Codex-only sidecar `agents/openai.yaml` (interface, policy.allow_implicit_invocation, dependencies) [doc] | unknown fields ignored [doc] |
| Exposure | listed in system prompt, budgeted (~8000 chars) [bin] | `$skill-name`, `skills.max_context_tokens` (2% of context) [doc] | native `skill` tool; `permission.skill` allow/deny [doc] |
| Legacy commands | `.claude/commands/*.md` unified with skills [doc] | — | `.opencode/commands/*.md` (own format); `.claude/commands` not read [doc] |

## 3. Subagents / custom agents (no cross-tool standard exists — confirmed)

| Behavior | Claude Code | Codex | OpenCode |
|---|---|---|---|
| Location + format | `.claude/agents/*.md`, Markdown+frontmatter (`name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `skills`, `memory`, `isolation`, `maxTurns`, `hooks`, `background`) [doc] | `.codex/agents/*.toml` (`name`, `description`, `developer_instructions`, `model`, `sandbox_mode`, `mcp_servers`, `skills.config`) — trusted projects only [doc] | `.opencode/agents/*.md` (also legacy `agent/`), frontmatter `description`, `mode`, `model`, `permission`, `steps`, … [doc] |
| Reads other tools' agents | no | no | **No** — `.claude/agents/probe-agent.md` not listed by `opencode agent list` **[test]** |
| Symlinked agents dir / file | `.claude/agents -> ../canon/agents` and a symlinked file both loaded (model-reported in 3 of 4 runs; one flaky "NONE" answer) **[test, model-reported]** | not tested; symlinked agent TOMLs have an open issue (#15345) | `.opencode/agents -> ../canon/ocagents` followed (`ocprobe` listed) **[test]** |

## 4. Settings, enforcement, inspection

| Behavior | Claude Code | Codex | OpenCode |
|---|---|---|---|
| Project settings | `.claude/settings.json` (team) < `.claude/settings.local.json` (personal) < CLI < managed [doc] | `.codex/config.toml` root + intermediate dirs, **trusted projects only**, some keys blocked [doc] | `opencode.json` / `.opencode/` [doc] |
| Block a tool call | hooks in settings: `PreToolUse` exit 2 / JSON deny [doc] | `.codex/hooks.json` `PreToolUse` deny (JSON or exit 2); 12 events; default on [doc][bin] | `permission` config; project plugin `tool.execute.before` throwing [doc] |
| Non-interactive inspection | `claude -p … --debug-file f` (log has `Loading skills from`, `Loaded N unique skills (… project: n …)`) **[test]** | `codex debug prompt-input "<msg>"` renders the composed developer prompt incl. AGENTS.md + skills catalog [doc][test] | `opencode debug skill` (JSON name/description/location), `opencode agent list`, `opencode debug config` [doc][test]. Note: `opencode debug skill` once hung >2 min in a fixture with a `.opencode/agents` symlink; a rerun with a 45 s alarm succeeded — wrap in a timeout. |
| Config import/migration | Claude Code has a Codex-import feature (`AGENTS.md`→`CLAUDE.md`, settings) [bin] | Codex has "external agent config" import (CLAUDE.md→AGENTS.md, settings.json→config.toml, `.claude/hooks.json`) [bin] | reads `.claude/skills` + `CLAUDE.md` as compat |

## 5. Standards

- **AGENTS.md** (https://agents.md, stewarded by the Agentic AI Foundation / Linux Foundation): standardizes the filename, free-form Markdown, nested "closest wins". Nothing else. Codex's override/fallback files and 32 KiB cap are extensions.
- **Agent Skills** (https://agentskills.io/specification, originated by Anthropic, Apache-2.0 code): required `name` (1–64, `^[a-z0-9]+(-[a-z0-9]+)*$`, equals directory) and `description` (1–1024); optional `license`, `compatibility`, `metadata`, experimental `allowed-tools`; `scripts/`, `references/`, `assets/`; SKILL.md < 500 lines; reference validator `skills-ref validate <dir>` (github.com/agentskills/agentskills/skills-ref).
- **Subagent definitions:** no standard; three divergent formats (Markdown/Claude, TOML/Codex, Markdown/OpenCode with different fields).

## 6. Consequences for AgentConcord's capability matrix (data, not code)

- `instructions.readsAgentsMd`: claude=false (import/symlink), codex=true, opencode=true.
- `instructions.importSyntax`: claude=`@path`, others none → a CLAUDE.md **shim** is a Claude-only adapter; for Codex/OpenCode `AGENTS.md` must be the real file (or a symlink they follow).
- `skills.paths`: claude=[.claude/skills], codex=[.agents/skills], opencode=[.opencode/skills,.claude/skills,.agents/skills]; `skills.followsDirSymlink`: claude=true[test], codex=true[doc/test], opencode=true[test]; `skills.dedupByName`: opencode=first-wins, codex=none (duplicates surface), claude=n/a.
- `agents.format`: three formats → **generate** per harness, never symlink across harnesses; symlinking the *same* harness's agents dir to a canonical location is possible for Claude/OpenCode [test].
- `verify.command`: claude=`claude -p --debug-file`, codex=`codex debug prompt-input`, opencode=`opencode debug skill` / `agent list` (wrap in timeout).
