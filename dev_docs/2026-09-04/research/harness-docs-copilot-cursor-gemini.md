# Harness repository-config research: GitHub Copilot, Cursor, Gemini CLI (+ AGENTS.md / Agent Skills re-check)

Date checked: **2026-09-04** (all URLs fetched live on this date unless noted).
Method: WebFetch/WebSearch against primary sources only (docs.github.com, code.visualstudio.com, github.com/github, cursor.com, forum.cursor.com (official community), geminicli.com, github.com/google-gemini, agents.md, agentskills.io). Nothing answered from memory.

Status legend:
- **OD** = officially documented (stated on an official docs page / official repo).
- **DCB** = documented compatibility behavior (official docs describe reading another tool's files/format).
- **ND** = not documented / uncertain (absent from docs; only issue trackers / community reports, or no source at all).

Versions visible during the check:
- GitHub Copilot CLI: latest stable **v1.0.82 (2026-08-29)**; pre-releases up to v1.0.83-4 (2026-09-03) — https://github.com/github/copilot-cli/releases
- VS Code Copilot customization docs: pages stamped **9/2/2026**.
- Cursor: docs undated; CLI changelog latest entry **2026-08-26**; Skills introduced **Cursor 2.4 (2026-01-22)**; subagent nesting references **Cursor 2.5**.
- Gemini CLI: latest stable **v0.58.0 (2026-09-01)** (github releases + geminicli.com/docs/changelogs/latest/); reference docs stamped 2026-05-01 … 2026-08-17.

---

## A. GitHub Copilot (coding/cloud agent, Copilot CLI, VS Code)

### A.1 Binary / surfaces

| Fact | Status | Source (checked 2026-09-04) |
|---|---|---|
| CLI binary name is `copilot` (installed via bash script, Homebrew, WinGet, npm; Linux/macOS/Windows) | OD | https://github.com/github/copilot-cli (README) |
| Copilot CLI "brings the power of Copilot coding agent directly to your terminal" | OD | same |
| Surfaces with distinct config behavior: Copilot Chat on github.com, Copilot **cloud agent** (a.k.a. coding agent), Copilot code review, Copilot CLI, VS Code, Visual Studio, JetBrains, Eclipse, Xcode | OD | https://docs.github.com/en/copilot/reference/custom-instructions-support |

### A.2 Repository custom instructions

| Fact | Status | Source |
|---|---|---|
| Repository-wide: `.github/copilot-instructions.md` | OD | https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions |
| Path-specific: `.github/instructions/NAME.instructions.md`; subdirectories inside `.github/instructions/` allowed; matrix page writes it as `.github/instructions/**/*.instructions.md` | OD | same + https://docs.github.com/en/copilot/reference/custom-instructions-support |
| `.instructions.md` frontmatter: `applyTo` (glob, required for path-specific), `excludeAgent` (`"code-review"` or `"cloud-agent"`, optional) | OD | add-repository-instructions page |
| VS Code additionally documents `description` and `name` frontmatter for `.instructions.md`; does **not** list `excludeAgent` | OD (VS Code) | https://code.visualstudio.com/docs/copilot/customization/custom-instructions (9/2/2026) |
| "Agent instructions": `AGENTS.md` (one or more, anywhere in repo); "When Copilot is working, the nearest `AGENTS.md` file in the directory tree will take precedence." → **nested AGENTS.md supported (coding/cloud agent)** | OD | add-repository-instructions page |
| Single alternative agent-instruction files: `CLAUDE.md` or `GEMINI.md` **in repository root** | OD | same |
| Cloud agent AGENTS.md support (root or nested) announced 2025-08-28; continues to support `CLAUDE.md` and `GEMINI.md` | OD | https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/ |
| Code review gained AGENTS.md support 2026-06-18 | OD | https://github.blog/changelog/2026-06-18-copilot-code-review-agents-md-support-and-ui-improvements/ |
| Support matrix (which surface reads which): Cloud agent = repository-wide + path-specific + agent instructions (AGENTS.md/CLAUDE.md/GEMINI.md) + org; Code review = repository-wide + path-specific + agent + org; Copilot Chat on github.com = personal + repository-wide + org (no path-specific, no agent); Copilot CLI = personal (`~/.copilot/copilot-instructions.md`) + (cloud-agent-from-CLI: agent); VS Code chat = repository-wide + path-specific + agent; Visual Studio = repository-wide + path-specific (chat); JetBrains = personal + repository-wide + path-specific; Xcode = repository-wide + path-specific; Eclipse = repository-wide. Page has **no footnote** about root-only vs nested AGENTS.md | OD | https://docs.github.com/en/copilot/reference/custom-instructions-support |
| Copilot CLI reads: `~/.copilot/copilot-instructions.md`, `~/.copilot/instructions/**/*.instructions.md`, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`, plus dirs in `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | OD / DCB (CLAUDE.md, .claude/CLAUDE.md, GEMINI.md are compatibility reads) | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions |
| CLI discovery locations: "the repository root, the current working directory, intermediate directories between them, and any directories nested in the path of a file it is working on" → **nested AGENTS.md honored by CLI** | OD | same |
| CLI `@relative/path` include syntax inside `copilot-instructions.md` / `AGENTS.md` / `CLAUDE.md`; "Referenced files must remain within the repository… Absolute paths and paths beginning with `~/` are not loaded." Not expanded in `GEMINI.md` or `*.instructions.md` | OD | same |
| VS Code: `AGENTS.md` at workspace root (setting `chat.useAgentsMdFile`); nested AGENTS.md in subfolders behind **experimental** `chat.useNestedAgentsMdFiles`; `CLAUDE.md` read from workspace root, `.claude/` folder, or `~/.claude/CLAUDE.md` (setting `chat.useClaudeMdFile`); **GEMINI.md not mentioned for VS Code** | OD / DCB | https://code.visualstudio.com/docs/copilot/customization/custom-instructions |
| VS Code shows which instruction files were used in the **References** section of a chat response | OD | same |
| Symlinked instruction files followed? | **ND** — no doc statement for any surface. Only `~/.copilot/settings.json` symlink behavior is documented (see A.7). Open issue asks for docs: https://github.com/github/copilot-cli/issues/3264 (open, opened 2026-05-12, no maintainer reply) | — |

### A.3 Custom agents `.github/agents/*.agent.md`

| Fact | Status | Source |
|---|---|---|
| Location: `.github/agents/` with `.agent.md` (or `.md`) extension; filename minus extension = agent id (dedupe key) | OD | https://docs.github.com/en/copilot/reference/custom-agents-configuration |
| Frontmatter: `name` (optional; display), `description` (**required**), `target` (`vscode` \| `github-copilot`; default both), `tools` (list/string; default all), `model`, `disable-model-invocation` (bool, default false), `user-invocable` (bool, default true), `infer` (**retired**, replaced by the two previous), `mcp-servers` (object; not used in VS Code), `metadata` (object; not used in VS Code). Body max **30,000 characters** | OD | same |
| `argument-hint` and `handoffs` "currently not supported for Copilot cloud agent on GitHub.com" | OD | same |
| Surfaces: cloud agent, Copilot CLI, VS Code, JetBrains/Eclipse/Xcode (public preview) | OD | same |
| VS Code additionally reads agents from `.claude/agents` ("Claude format"), `~/.copilot/agents`, and `chat.agentFilesLocations`; extra fields `handoffs`, `argument-hint`, `agents` (`*` / `[]`); legacy `.chatmode.md` → rename to `.agent.md` | OD / DCB | https://code.visualstudio.com/docs/copilot/customization/custom-agents (9/2/2026) |
| CLI: `.github/agents/` (project) and `~/.copilot/agents/` (user); **home-dir wins on name clash**; `/agent` picker; `copilot --agent NAME --prompt "..."` | OD | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli |
| Custom agents announced 2025-10-28 (GitHub + CLI) | OD | https://github.blog/changelog/2025-10-28-custom-agents-for-github-copilot/ |

### A.4 Prompt files `.github/prompts/*.prompt.md`

| Fact | Status | Source |
|---|---|---|
| `.github/prompts/NAME.prompt.md`; public preview; **only VS Code, Visual Studio, JetBrains** (not CLI, not cloud agent) | OD | https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files (via docs.github.com search) |
| VS Code frontmatter: `name`, `description`, `argument-hint`, `agent` (ask/agent/plan/custom), `model`, `tools`; invoked as `/name`; setting `chat.promptFilesLocations`; "Agents running on the Agent Host don't use prompt files" — convert to skills | OD | https://code.visualstudio.com/docs/copilot/customization/prompt-files (9/2/2026) |
| The former URL `/copilot/how-tos/configure-custom-instructions/add-prompt-files` now 404s | OD (observed) | — |

### A.5 Agent Skills

| Fact | Status | Source |
|---|---|---|
| Project skill dirs: **`.github/skills`, `.claude/skills`, `.agents/skills`**; personal: **`~/.copilot/skills`, `~/.agents/skills`** | OD / DCB (`.claude/skills` is cross-tool) | https://docs.github.com/en/copilot/concepts/agents/about-agent-skills ; https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills ; https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills |
| Surfaces: "Copilot cloud agent, Copilot code review, the GitHub Copilot CLI, the GitHub Copilot app, and agent mode in Visual Studio Code and JetBrains IDEs" | OD | about-agent-skills |
| Follows the Agent Skills open standard (agentskills.io / github.com/agentskills/agentskills) | OD | same |
| VS Code project dirs `.github/skills/`, `.claude/skills/`, `.agents/skills/`; personal `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/`; extra via `chat.agentSkillsLocations`; monorepo parent-root discovery via `chat.useCustomizationsInParentRepositories`; frontmatter `name` (lowercase/num/hyphen, ≤64), `description` (≤1024), optional `argument-hint`, `user-invocable`, `disable-model-invocation`, `context: fork` (experimental) | OD | https://code.visualstudio.com/docs/copilot/customization/agent-skills |
| CLI frontmatter documented: `name`, `description` required; `license`, `allowed-tools` optional (warning about pre-approving shell). `/skills list|add|info|remove|reload`; terminal `copilot skill list`; invoke as `/skill-name`; skills also discovered from `--add-dir` dirs (v1.0.81 notes) | OD | add-skills (CLI) ; https://github.com/github/copilot-cli/releases |
| `gh skill` (GitHub CLI ≥ 2.90.0) in public preview for installing skills | OD | cloud-agent add-skills page |
| Symlinked skill dirs | **ND** — issue "Copilot CLI Not Detecting Symlinked Skills" #1021 (opened 2026-01-18, closed, no maintainer statement visible); #1090 discusses shared skill libraries via symlinks | https://github.com/github/copilot-cli/issues/1021 |

### A.6 MCP, hooks

| Fact | Status | Source |
|---|---|---|
| Cloud agent MCP: configured in repo **Settings → Copilot → MCP servers** (JSON `mcpServers`, `type` local/stdio/http/sse, `tools` allowlist or `"*"`); `.vscode/mcp.json` **not** auto-read (manual adaptation guidance) | OD | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp |
| CLI MCP: `~/.copilot/mcp-config.json`; project-level **`.mcp.json`** (closest to cwd wins) then **`.github/mcp.json`**; "The `.vscode/mcp.json` file for VS Code is not read by Copilot CLI"; `/mcp add` | OD | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers |
| Hooks file: `.github/hooks/*.json` (`version: 1`, `hooks: { event: [ {type, bash, powershell, cwd, env, timeoutSec} ] }`); cloud agent requires file on **default branch**, events `sessionStart, sessionEnd, userPromptSubmitted, preToolUse, postToolUse, errorOccurred` | OD | https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/use-hooks |
| Hooks reference (CLI): sources in order — policy dirs (`/etc/github-copilot/policy.d/`, `C:\ProgramData\GitHub\Copilot\policy.d\`), `.github/hooks/*.json`, `~/.copilot/hooks/`, `.github/copilot/settings.json` **and `.claude/settings.json` / `.claude/settings.local.json`**, `~/.copilot/settings.json`. Events: `sessionStart, sessionEnd, userPromptSubmitted, userPromptTransformed, preToolUse, postToolUse, postToolUseFailure, agentStop, subagentStart, subagentStop, errorOccurred, preCompact, permissionRequest, notification`; types `command|http|prompt` | OD / DCB (Claude settings read) | https://docs.github.com/en/copilot/reference/hooks-reference |
| VS Code hooks (Preview): `.github/hooks/*.json`, Claude format `.claude/settings.json`/`.claude/settings.local.json`, `~/.copilot/hooks`, `~/.claude/settings.json`; events `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart, SubagentStop, Stop`; camelCase inputs vs Claude snake_case; matchers parsed but not applied | OD / DCB | https://code.visualstudio.com/docs/copilot/customization/hooks |

### A.7 `~/.copilot` and non-interactive inspection

| Fact | Status | Source |
|---|---|---|
| `~/.copilot/` contents incl. `agents/`, `skills/`, `instructions/`, `hooks/`, `copilot-instructions.md`, `mcp-config.json`, `settings.json`, `config.json`, `permissions-config.json`, `session-state/`, `logs/`; relocate with `COPILOT_HOME` | OD | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference |
| Repo-level `.github/copilot/settings.json` + `.github/copilot/settings.local.json`; precedence: defaults → MDM → user → repo → local → env → flags | OD | same |
| **Symlink**: "If `~/.copilot/settings.json` is a symlink… writes from the `/settings` command follow the symlink and update its target." (only symlink statement found anywhere in Copilot docs) | OD | same |
| Programmatic: `copilot -p PROMPT` (non-interactive), `-s` (only agent response), `--allow-all-tools`, `--allow-tool`, `--deny-tool`, `--allow-url`, `--allow-all`/`--yolo`, `--add-dir`, `--agent`, `--model`, `--no-ask-user`, `--share=PATH`, `--share-gist`; env `COPILOT_ALLOW_ALL`, `COPILOT_MODEL`, `COPILOT_HOME`, `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` | OD | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference |
| Interactive inspection: `/instructions` ("view the instruction files discovered for the current session and enable or disable individual files"), `/skills list`, `/agent`, `/context`, `/env`, `/memory` | OD | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference ; CLI add-custom-instructions |
| **Non-interactive inspection**: `copilot skill list`; `copilot plugins list` = "Non-interactively inspect every plugin, MCP server, skill…"; v1.0.81 notes: "Agents, skills and MCP servers contributed by installed plugins are no longer dropped in non-interactive (-p) runs". No documented non-interactive dump of *which AGENTS.md/instruction files* loaded (only `/instructions` in TUI) | OD (commands) / **ND** (instruction-file dump) | cli-command-reference ; add-skills ; releases |

---

## B. Cursor

### B.1 Binary / CLI

| Fact | Status | Source |
|---|---|---|
| CLI binary is **`agent`** (formerly `cursor-agent`); install `curl https://cursor.com/install -fsS | bash` / PowerShell `irm 'https://cursor.com/install?win32=true' | iex` | OD | https://cursor.com/docs/cli/overview ; https://cursor.com/docs/cli/changelog |
| Non-interactive: `agent -p` / `--print`, `--output-format text|json|stream-json`, `--stream-partial-output`, `--force`/`--yolo`, `--mode plan|ask`, `--model`, `--list-models`, `--workspace`, `--api-key`/`CURSOR_API_KEY`, `--approve-mcps`, `--sandbox` | OD | https://cursor.com/docs/cli/reference/parameters ; https://cursor.com/docs/cli/headless |
| CLI "supports the same rules system as the editor… `.cursor/rules`"; "The CLI also reads `AGENTS.md` and `CLAUDE.md` at the project root (if present) and applies them as rules alongside `.cursor/rules`"; MCP from `.cursor/mcp.json`; skills via `/` menu | OD / DCB (CLAUDE.md) | https://cursor.com/docs/cli/using |
| CLI slash commands: `/model, /plan, /ask, /mcp, /sandbox, /summarize (/compress), /resume, /fork, /debug, /logs, /help …` — **no `/rules`, `/skills`, `/instructions` listing command documented** | OD (list) / **ND** (no inspection cmd) | https://cursor.com/docs/cli/reference/slash-commands |
| Whether rules/AGENTS.md/skills apply identically in `-p` mode | **ND** (headless page silent) | https://cursor.com/docs/cli/headless |
| Non-interactive way to show loaded instructions/skills | **ND** — none documented; `agent generate-rule` exists but only creates rules | parameters page |

### B.2 Rules

| Fact | Status | Source |
|---|---|---|
| Project rules: `.cursor/rules/*.mdc` (`.mdc` required); nested subfolders inside `.cursor/rules/` work ("flat structure is simpler") | OD | https://cursor.com/docs/context/rules ; https://cursor.com/help/customization/rules |
| Frontmatter: `description`, `globs`, `alwaysApply`; 4 modes: Always Apply (`alwaysApply: true` — "Globs and description are ignored"), Apply Intelligently (description), Apply to Specific Files (globs), Apply Manually (`@`-mention) | OD | same |
| Team Rules (dashboard, Team/Enterprise) → Project Rules → User Rules precedence; User Rules chat-only | OD | same |
| `AGENTS.md`: "Create an `AGENTS.md` file in your project root… Cursor picks it up automatically"; "Nested `AGENTS.md` support in subdirectories is now available… more specific instructions taking precedence" → **root + nested** | OD | https://cursor.com/docs/rules ; help/customization/rules |
| `CLAUDE.md`: "Cursor reads `CLAUDE.md` files the same way it reads `AGENTS.md`. Place a `CLAUDE.md` file in your project root…"; "`CLAUDE.md` files are always applied to every conversation, regardless of any `alwaysApply` frontmatter setting." (root only stated) | DCB | https://cursor.com/help/customization/rules |
| `.cursorrules`: "The `.cursorrules` file in your project root is legacy and will be deprecated." Migration: New Cursor Rule → paste → Always Apply → delete `.cursorrules` | OD | same |
| GEMINI.md | **ND** — not mentioned anywhere in Cursor docs | — |
| Symlinked rules | **ND** in docs. Community/official-forum record: symlinked `.mdc` broke in 2.2.17 (2025-12-11), staff: "This has been fixed in 2.5!" (2026-02-20); symlinked *folders* under `.cursor/rules/` reported not loaded on 2.5.25 (2026-02/03; root cause turned out to be `.gitignore` match) | community reports only | https://forum.cursor.com/t/cursor-no-longer-can-follow-symlinks-to-rules-mdc-files/146010 ; https://forum.cursor.com/t/symlinked-rules-mdc-are-not-followed-again/152918 |

### B.3 Agent Skills

| Fact | Status | Source |
|---|---|---|
| Project: **`.cursor/skills/`, `.agents/skills/`**; user: `~/.cursor/skills/`, `~/.agents/skills/`; "Cursor also loads skills from Claude and Codex directories: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`" | OD / DCB | https://cursor.com/docs/skills ; https://cursor.com/docs/context/skills ; https://cursor.com/help/customization/skills |
| "Cursor also discovers skills inside nested project subdirectories. A `.cursor/skills/` (or `.agents/skills/`) folder anywhere inside your repository is picked up." | OD | https://cursor.com/docs/skills |
| Frontmatter: `name` (required; lowercase/num/hyphen; "Must match the parent folder name"), `description` (required), optional `paths` (globs), `disable-model-invocation`, `icon`, `color`, `metadata`; follows agentskills.io | OD | same |
| Built-ins `/create-skill`, `/migrate-to-skills` (Cursor 2.4+; converts dynamic rules (alwaysApply false, no globs) and slash commands) | OD | help/customization/skills |
| Introduced Cursor **2.4 (2026-01-22)**, editor + CLI | OD | https://cursor.com/changelog/2-4 |
| CLI changelog: "Skill and subagent scans no longer descend into hidden dot-directories"; `user-invocable: false` hides model-only skills | OD | https://cursor.com/docs/cli/changelog |
| Symlinked skills | **ND** | — |

### B.4 Subagents, commands, hooks, MCP

| Fact | Status | Source |
|---|---|---|
| Subagents: `.cursor/agents/*.md` (project), `~/.cursor/agents/` (user); compat: **`.claude/agents/`, `.codex/agents/`, `~/.claude/agents/`, `~/.codex/agents/`**; `.cursor/` wins over `.claude/`/`.codex/` on name clash; frontmatter `name`, `description`, `model` (default `inherit`), `readonly`, `is_background`; built-ins Explore/Bash/Browser; nested subagents "Cursor 2.5" | OD / DCB | https://cursor.com/docs/context/subagents |
| Commands: `.cursor/commands/[command].md`, invoked via `/`; introduced Cursor 1.6 (2025-09-12). Dedicated docs page not found (URLs `/docs/context/commands`, `/docs/agent/chat/commands` redirect to Skills; `/docs/commands` 404). Skills docs: commands are migratable via `/migrate-to-skills`; **not stated as deprecated** | OD (changelog) / **ND** (current standalone doc) | https://cursor.com/changelog/1-6 ; help/customization/skills |
| `.claude/commands` read? | **ND** | — |
| Hooks: `.cursor/hooks.json` (project), `~/.cursor/hooks.json` (user), enterprise paths (`/Library/Application Support/Cursor/hooks.json`, `/etc/cursor/hooks.json`, `C:\ProgramData\Cursor\hooks.json`), team via dashboard; `version: 1`; events incl. `sessionStart, sessionEnd, preToolUse, postToolUse, postToolUseFailure, subagentStart, subagentStop, beforeShellExecution, afterShellExecution, beforeMCPExecution, afterMCPExecution, beforeReadFile, afterFileEdit, beforeSubmitPrompt, preCompact, stop, afterAgentResponse, afterAgentThought`, tab hooks, `workspaceOpen`; `type: command|prompt` | OD | https://cursor.com/docs/agent/hooks |
| MCP: `.cursor/mcp.json` (project), `~/.cursor/mcp.json` (global); `${env:NAME}`, `${workspaceFolder}`, `${userHome}`, `${pathSeparator}`; `.vscode/mcp.json` not mentioned | OD | https://cursor.com/docs/context/mcp |

---

## C. Gemini CLI

### C.1 Binary / non-interactive

| Fact | Status | Source |
|---|---|---|
| Binary `gemini`; `-p/--prompt` (non-interactive), `-i/--prompt-interactive`, `-m/--model`, `-r/--resume`, `-e/--extensions`, `-o/--output-format text|json|stream-json`, `--approval-mode default|auto_edit|yolo|plan`, `--debug`, `--sandbox`; subcommands `gemini extensions`, `gemini mcp`, `gemini skills` | OD | https://geminicli.com/docs/cli/cli-reference/ (2026-05-01) |
| Headless triggered by non-TTY or `-p`; JSON output `response` + `stats`; exit codes 0/1/42/53 | OD | https://geminicli.com/docs/cli/headless/ ; raw docs/cli/headless.md |
| Whether GEMINI.md/skills load in headless and whether `/memory show` works via `-p` | **ND** (headless doc silent) | same |
| Non-interactive listing: `gemini skills list --all`, `gemini extensions list`; `gemini mcp` | OD | https://geminicli.com/docs/cli/skills/ ; https://geminicli.com/docs/extensions/ |
| `/memory list` ("Lists the paths of the GEMINI.md files in use"), `/memory show` (concatenated content), `/memory refresh`; `/skills list`, `/agents list`, `/hooks list|show|panel`, `/extensions list`, `/mcp list`, `/tools`, `/directory add|show`, `/init` | OD (interactive only) | https://geminicli.com/docs/reference/commands/ (2026-08-17) |
| Notice: "Unpaid tier and Google One users: Gemini CLI will be replaced by Antigravity CLI on June 18th." | OD | https://geminicli.com/docs/ ; cli-reference |

### C.2 GEMINI.md context files

| Fact | Status | Source |
|---|---|---|
| Load order: (1) global `~/.gemini/GEMINI.md`; (2) "configured workspace directories and their parent directories"; (3) JIT: "scans for `GEMINI.md` files in that directory and its ancestors up to a trusted root" when the agent touches a subdirectory | OD | https://geminicli.com/docs/cli/gemini-md/ (2026-06-18) |
| `context.discoveryMaxDirs` default **200**; `context.includeDirectories`; `context.loadMemoryFromIncludeDirectories` (default false; governs `/memory reload`); `--include-directories` flag | OD | https://geminicli.com/docs/reference/configuration/ ; cli-reference |
| **`context.fileName`: type `string | string[]`**, default undefined; documented example `"context": { "fileName": ["AGENTS.md", "CONTEXT.md", "GEMINI.md"] }` → **yes, can be set to AGENTS.md (single or array)**. NOT enabled by default | OD | https://geminicli.com/docs/reference/configuration/ ; gemini-md page |
| `@file.md` imports: relative (`@./x.md`, `@../x.md`) and absolute (`@/abs/path.md`); circular-import detection; **max depth default 5**; `@` inside code blocks / inline code ignored (via `marked`); `validateImportPath()` restricts to allowed dirs; returns import tree | OD | https://geminicli.com/docs/reference/memport/ |
| `context.importFormat` setting exists (type string; values not enumerated on config page) | OD (existence) / ND (values) | configuration page |
| Extension manifest `contextFileName` (defaults `GEMINI.md`) | OD | https://geminicli.com/docs/extensions/reference/ |
| Symlinked GEMINI.md | **ND** in docs; issue "GEMINI.md is not read if it's a symlink" #11547 (opened 2025-10-21) **closed as not planned**, no maintainer statement | https://github.com/google-gemini/gemini-cli/issues/11547 |

### C.3 Settings, commands, extensions

| Fact | Status | Source |
|---|---|---|
| Settings precedence: defaults → system-defaults (`/etc/gemini-cli/system-defaults.json`, `C:\ProgramData\gemini-cli\system-defaults.json`, `/Library/Application Support/GeminiCli/system-defaults.json`) → user `~/.gemini/settings.json` → project **`.gemini/settings.json`** → system `/etc/gemini-cli/settings.json` (+Windows/macOS equivalents) → env → CLI args; `GEMINI_CLI_SYSTEM_SETTINGS_PATH`; `.gemini/.env` loading (cwd → parents → project root → home) | OD | https://geminicli.com/docs/reference/configuration/ |
| Custom commands: `~/.gemini/commands/*.toml` (global) and `<project>/.gemini/commands/*.toml` (project wins on clash); TOML `prompt` (required), `description`; subdirs → `/git:commit`; `{{args}}`, `!{shell}` (confirmation prompt), `@{file}` (respects `.gitignore`/`.geminiignore`) | OD | https://geminicli.com/docs/cli/custom-commands/ (2026-04-30) |
| Symlinked commands dir | **ND**; issue #4906 "Commands within symlinked directory are not read" (per search; individual symlinked files worked) | https://github.com/google-gemini/gemini-cli/issues/4906 |
| Extensions: install to `~/.gemini/extensions/<name>`; `gemini extensions install|update|list|enable|disable`; manifest `gemini-extension.json` (`name`, `version`, `description`, `mcpServers`, `contextFileName`, `excludeTools`, `settings`, `plan`); bundle `commands/*.toml`, `skills/<name>/SKILL.md`, `agents/*.md`, `hooks/hooks.json`, `policies/*.toml` | OD | https://geminicli.com/docs/extensions/reference/ |

### C.4 Agent Skills

| Fact | Status | Source |
|---|---|---|
| Discovery tiers (lowest→highest): built-in → extension → user `~/.gemini/skills/` **or `~/.agents/skills/` alias** → workspace `.gemini/skills/` **or `.agents/skills/` alias** ("interoperable path… compatible across different AI tools") | OD | https://geminicli.com/docs/cli/skills/ (2026-04-30) |
| **`.claude/skills` NOT read** (not mentioned anywhere) | ND / absent | same |
| Frontmatter: `name` ("should match the directory name" — but "The skill name comes from the `name:` field, not the directory name"), `description`; SKILL.md silently skipped if either missing or if anything precedes the opening `---` | OD | https://geminicli.com/docs/cli/creating-skills/ ; skills best-practices (via search) |
| `/skills list [all] [nodesc]`, `/skills enable|disable <name>`, `/skills reload|refresh`, `/skills link <path> [--scope user|workspace]`; terminal `gemini skills list --all`, `gemini skills install <source> --consent`, `gemini skills uninstall <name> --scope workspace`, `gemini skills link` ("create a reference to your local directory") | OD | skills ; https://geminicli.com/docs/cli/using-agent-skills/ |
| `skills.enabled` (default true); activation consent required each time a skill triggers | OD | configuration ; using-agent-skills |
| Version history: core skill infrastructure + `gemini skills` command in **v0.24.0** (release page; skills preview discussed for v0.23.0); "promote skills settings to stable" in **v0.27.0** | OD | https://github.com/google-gemini/gemini-cli/releases/tag/v0.24.0 ; .../v0.27.0 (page year read as 2025 by the fetch summarizer; the surrounding release cadence — v0.58.0 on 2026-09-01, skills issues opened 2026-01 — places these in Jan/Feb **2026**) |
| Symlinked skills dirs | **ND**; issue #16247 "Support symlinked skills directories" (opened 2026-01-09, closed, no maintainer statement visible); #18294 proposed `skills link`; #24816 Windows permission error with skills linking | https://github.com/google-gemini/gemini-cli/issues/16247 |

### C.5 Hooks and subagents

| Fact | Status | Source |
|---|---|---|
| Hooks configured in **`settings.json`** (`.gemini/settings.json` project, `~/.gemini/settings.json` user, `/etc/gemini-cli/settings.json` system) and extensions' `hooks/hooks.json`; **no `.gemini/hooks/` directory**. Events: `SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, BeforeTool, AfterTool, PreCompress, Notification`; `type: "command"` only; stdout must be JSON only; exit 2 = block; `/hooks panel|enable-all|disable-all|enable|disable`; `hooksConfig.enabled/disabled/notifications` | OD | https://geminicli.com/docs/hooks/ ; configuration |
| Hooks enabled by default & "remove 'experimental'" in **v0.27.0** (v0.26.0 weekly update also announced hooks) | OD | v0.27.0 release ; https://github.com/google-gemini/gemini-cli/discussions/17812 |
| Claude-Code hook compatibility | ND / absent | hooks page |
| Subagents: **`.gemini/agents/*.md`** (project), `~/.gemini/agents/*.md` (user), extensions, `settings.json` `agents.overrides`; frontmatter `name`, `description` (required), `kind local|remote`, `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins`; built-ins `codebase_investigator`, `cli_help`, `generalist`, `browser_agent`; `/agents`; `@agent-name`; toggle `experimental.enableAgents` (default **true**) | OD | https://geminicli.com/docs/core/subagents/ ; configuration |
| Status label: subagents page presents them as core; docs homepage lists "Subagents (experimental)"; setting lives under `experimental.*` — treat as **stable-by-default but experimental-labelled** | OD (conflicting labels) | same |
| `.claude/agents` read? | ND / absent | — |

---

## D. Standards re-check (2026-09-04)

| Fact | Status | Source |
|---|---|---|
| AGENTS.md: "a simple, open format for guiding coding agents"; "AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation"; plain Markdown, no required headings; nested: "Agents automatically read the nearest file in the directory tree, so the closest one takes precedence"; 60k+ repos; supporters listed include Cursor, Gemini CLI, GitHub Copilot Coding Agent, VS Code, Codex, Jules, Devin, Amp, Zed, Warp, goose, opencode, Aider, Factory, RooCode, Kilo Code, Windsurf, Augment, Junie, UiPath, Phoenix, Semgrep, Ona | OD | https://agents.md |
| Agent Skills spec: required `name` (1–64 chars; lowercase a-z 0-9 and `-`; no leading/trailing hyphen; no `--`; **must match parent directory name**), `description` (1–1024, non-empty); optional `license`, `compatibility` (1–500), `metadata` (string→string map), `allowed-tools` (space-separated, experimental); layout `SKILL.md` + optional `scripts/`, `references/`, `assets/`; progressive disclosure (metadata ~100 tokens, body <5000 tokens recommended, keep SKILL.md <500 lines); validator `skills-ref validate ./my-skill` (github.com/agentskills/agentskills/tree/main/skills-ref) | OD — **unchanged vs prior verification** | https://agentskills.io/specification |

Note: Cursor's documented frontmatter adds non-spec fields (`paths`, `icon`, `color`, `disable-model-invocation`); VS Code adds `argument-hint`, `user-invocable`, `disable-model-invocation`, `context`; Copilot CLI docs list `allowed-tools`; Gemini docs list only `name`/`description`. All state agentskills.io as the base.

---

## E. Cross-harness summary tables

### E.1 Which files each harness reads (repository level)

| File / dir | Copilot cloud agent | Copilot CLI | Copilot VS Code | Cursor (IDE) | Cursor CLI `agent` | Gemini CLI |
|---|---|---|---|---|---|---|
| `AGENTS.md` root | OD | OD | OD (`chat.useAgentsMdFile`) | OD | OD | **only via `context.fileName` setting** (OD, not default) |
| `AGENTS.md` nested | OD (nearest wins) | OD (root, cwd, intermediates, file path dirs) | OD experimental (`chat.useNestedAgentsMdFiles`) | OD (hierarchical, specific wins) | ND (docs say "at the project root") | via `context.fileName` + JIT ancestor scan (OD for GEMINI.md; extrapolated for renamed file → ND) |
| `CLAUDE.md` root | OD | OD (+ `.claude/CLAUDE.md`) | DCB (root, `.claude/`, `~/.claude/CLAUDE.md`) | DCB (root; always applied) | DCB | ND (only via `context.fileName`) |
| `GEMINI.md` root | OD | OD (no `@` expansion) | ND (not listed) | ND | ND | OD (native) |
| `.github/copilot-instructions.md` | OD | OD | OD | ND | ND | ND |
| `.github/instructions/*.instructions.md` (`applyTo`) | OD | OD | OD | ND | ND | ND |
| `.cursor/rules/*.mdc` | ND | ND | ND | OD | OD | ND |
| `.github/skills/` | OD | OD | OD | ND | ND | ND |
| **`.agents/skills/`** | **OD** | **OD** | **OD** | **OD** (nested anywhere) | OD (2.4 CLI) | **OD** (alias) |
| **`.claude/skills/`** | **OD/DCB** | **OD/DCB** | **OD/DCB** | **DCB** ("Claude and Codex directories") | DCB (CLI changelog) | **not read** |
| `.cursor/skills/`, `.codex/skills/` | ND | ND | ND | OD / DCB | OD / DCB | ND |
| `.gemini/skills/` | ND | ND | ND | ND | ND | OD |
| `.github/agents/*.agent.md` | OD | OD | OD | ND | ND | ND |
| `.claude/agents/` | ND | ND | DCB | DCB | DCB | ND |
| `.cursor/agents/` | ND | ND | ND | OD | OD | ND |
| `.gemini/agents/*.md` | ND | ND | ND | ND | ND | OD |
| `.github/prompts/*.prompt.md` | not supported (OD) | not supported (OD) | OD | ND | ND | ND |
| `.cursor/commands/*.md` | ND | ND | ND | OD (changelog 1.6) | ND | ND |
| `.gemini/commands/*.toml` | ND | ND | ND | ND | ND | OD |
| Hooks | `.github/hooks/*.json` (OD) | `.github/hooks/*.json`, `~/.copilot/hooks/`, `.github/copilot/settings.json`, **`.claude/settings(.local).json`** (OD/DCB) | `.github/hooks/*.json`, `.claude/settings*.json` (OD/DCB, Preview) | `.cursor/hooks.json` (OD) | same (OD) | `settings.json` `hooks` key (OD); no hooks dir |
| MCP | repo Settings UI (OD) | `~/.copilot/mcp-config.json`, `.mcp.json`, `.github/mcp.json` (OD) | `.vscode/mcp.json` (VS Code) | `.cursor/mcp.json` (OD) | `.cursor/mcp.json` (OD) | `settings.json` `mcpServers` / `gemini mcp` (OD) |

### E.2 Non-interactive "what got loaded" inspection (for AgentUnison real-harness verification)

| Harness | Binary | Non-interactive run | Lists loaded skills/agents non-interactively | Lists loaded instruction/context files non-interactively | Interactive equivalents |
|---|---|---|---|---|---|
| GitHub Copilot CLI | `copilot` | `copilot -p "..." [-s] [--allow-all-tools]` (OD) | `copilot skill list` (OD); `copilot plugins list` "non-interactively inspect every plugin, MCP server, skill…" (OD) | **none documented** (ND) | `/instructions` (per-file enable/disable), `/skills list`, `/agent`, `/context`, `/env` (OD) |
| Cursor CLI | `agent` | `agent -p "..." --output-format json` (OD) | **none documented** (ND) | **none documented** (ND) | none documented for rules/skills (only `/mcp`) (ND) |
| Gemini CLI | `gemini` | `gemini -p "..." -o json` (OD) | `gemini skills list --all`, `gemini extensions list` (OD) | **none documented**; `/memory list` + `/memory show` are interactive-only as documented (ND for `-p`) | `/memory list|show|refresh`, `/skills list`, `/agents list`, `/hooks list`, `/extensions list`, `/mcp list` (OD) |

Practical fallback for all three (ND, not a documented API): run the harness non-interactively with a prompt like "List verbatim the file paths of every instruction/context file and skill available to you" and parse the model response — behaviorally verifiable but not a contract.

### E.3 Windows / symlink relevance

- **No harness documents following symlinks for instruction, rules, skills, or agent files.** The only official symlink statement found is Copilot CLI's `~/.copilot/settings.json` (writes follow the symlink). Everything else is issue-tracker/community evidence:
  - Copilot CLI: #1021 symlinked skills not detected (2026-01, closed, no visible resolution); #3264 asks to document symlink behavior on Windows for `~/.copilot` (open, 2026-05-12); #1655 nested AGENTS.md (closed) mentions users symlinking nested AGENTS.md into `.github/instructions/*.instructions.md` as a workaround.
  - Gemini CLI: #11547 symlinked `~/.gemini/GEMINI.md` not read (closed **not planned**); #16247 symlinked skills dirs (closed, no statement); #4906 symlinked commands directory not read while individually symlinked files worked; #24816 Windows 10 permission error with `skills link`. Gemini v0.58.0 note: "ensure consistent symlink evaluation in ignore path handling" (security hardening, not a feature). Gemini's own remedy is `gemini skills link` / `/skills link` (registers a reference rather than relying on filesystem symlinks).
  - Cursor: symlinked `.mdc` rules regressed in 2.2.17 (2025-12), staff-reported fixed in 2.5 (2026-02-20); symlinked folders inside `.cursor/rules/` reported unloaded (2.5.25) — traced to `.gitignore` match, so ignore rules also gate discovery. Cursor CLI: "Skill and subagent scans no longer descend into hidden dot-directories" — a nested `.cursor/skills` is still found, but a skill placed under some other dot-dir is not.
- Windows-specific documented facts: Copilot hooks require both `bash` and `powershell` keys for cross-OS (cloud agent), CLI hook policy dir `C:\ProgramData\GitHub\Copilot\policy.d\`, user hooks `%USERPROFILE%\.copilot\hooks\`; Cursor enterprise hooks `C:\ProgramData\Cursor\hooks.json`, install via PowerShell `irm`; Gemini system settings `C:\ProgramData\gemini-cli\settings.json` / `system-defaults.json`. Windows symlink creation typically needs Developer Mode/admin — none of the three docs address this (ND).
- Implication for AgentUnison: generating **real files** (copies) per harness path is the only officially-supported strategy; symlink/junction-based fan-out is unsupported-or-undocumented on every harness and demonstrably broken in past versions of all three.

### E.4 Dead / moved URLs observed on 2026-09-04
- 404: `docs.github.com/en/copilot/reference/custom-instructions`, `/copilot/how-tos/configure-custom-instructions/add-prompt-files`, `/copilot/reference/copilot-cli-reference/{programmatic-reference,command-reference,configuration-directory}`, `/copilot/how-tos/use-copilot-agents/use-copilot-cli/add-hooks` → live equivalents are `/copilot/reference/custom-instructions-support`, `/copilot/tutorials/customization-library/prompt-files`, `/copilot/reference/copilot-cli-reference/{cli-programmatic-reference,cli-command-reference,cli-config-dir-reference}`, `/copilot/how-tos/copilot-cli/customize-copilot/use-hooks`.
- Cursor: `/docs/context/commands` and `/docs/agent/chat/commands` now serve the Skills page; `/docs/commands`, `/docs/skills.md`, `/docs/rules.md` 404. Canonical: `/docs/rules`, `/docs/skills`, `/docs/context/subagents`, `/docs/agent/hooks`, `/docs/cli/*`, help center `/help/customization/{rules,skills}`.
- Gemini: `/docs/cli/commands/` → `/docs/reference/commands/`; `/docs/cli/settings/` is a partial page, full reference at `/docs/reference/configuration/`; `docs/core/memport.md` raw path 404 → `/docs/reference/memport/`.
