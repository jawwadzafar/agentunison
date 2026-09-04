# Source links and revisions (research checked 2026-09-04)

## Reference repositories (clones under `/Users/jawwadzafar/repo/jawwadzafar/ideas/`)

| Name | URL | Revision studied | Commit date | License | Language | Notes |
|---|---|---|---|---|---|---|
| fleetsmith (local, read-only) | https://github.com/subhransusekhar/fleetsmith — local `/Users/jawwadzafar/repo/subhranshu/fleetsmith` | `5dde28b4fb78f9dcd399ad8feacc445c117f22be` (v0.7.1-2) | 2026-08-17 | MIT core; `ee/` AGPL-3.0 | Node ESM | `git ls-remote` confirms local HEAD == upstream `main` |
| agent-smith | https://github.com/rmonier/agent-smith | `f81f578e1a06766211579442b01157b538c442db` | 2026-07-19 | Apache-2.0 / CC-BY-4.0 docs | Python | |
| agent-sync | https://github.com/lidge-jun/agent-sync | `b0497eb324cd0c0718c80851770cd5c3db70e5d4` | 2026-06-01 | MIT declared, no LICENSE file | TypeScript | |
| agentsync | https://github.com/sarthak22gaur/agentsync | `6b915a183aa2410fb990da3394f53d5ff2c4ce02` | 2026-06-04 | MIT | Bash + SKILL.md | |
| hana | https://github.com/qodot/hana | `cfa1c6e5d60f6e9685445c7bb27aeb32b4d063af` | 2026-03-24 | MIT declared, no LICENSE file | Rust | |
| sync-skills | https://github.com/Tasihi89/sync-skills | `cd938e912da1fa78a24e20d4daf05bd523092190` | 2026-06-17 | none | Bash + SKILL.md | |
| wshobson/agents | https://github.com/wshobson/agents | `a30778f8c4e6b0a87567941b7cca4f534bf642b6` | 2026-09-01 | MIT | Markdown + Python 3.12 | 92 plugins / 202 agents / 183 skills |
| cc-agents | https://github.com/maemreyo/cc-agents | `a30778f8c4e6b0a87567941b7cca4f534bf642b6` | 2026-09-01 | MIT | — | byte-identical fork of wshobson/agents |
| agents-skills-sync | https://github.com/mateuszRybczonek/agents-skills-sync | `3374c84598cf30346a2bffe475bafb92f062cd85` (v0.5.1) | 2026-05-18 | MIT | TypeScript / Deno 2 | |
| Adobe AI repo harness guide | https://opensource.adobe.com/ai-repo-harness-guide/ · source https://github.com/adobe/ai-repo-harness-guide | `0331e369` (content v1.1.0, 2026-08-05) | 2026-08-28 | Apache-2.0 | Markdown + prompt skills | not cloned; fetched via web |

## Official harness documentation (all fetched 2026-09-04)

| Harness | Version context | Pages |
|---|---|---|
| Claude Code | CLI 2.1.259 installed | https://code.claude.com/docs/en/memory · /skills · /sub-agents · /settings · /permissions · /hooks · /hooks-guide · /large-codebases · /commands |
| Codex CLI | 0.144.4 installed; 0.153.1 current | https://developers.openai.com/codex/guides/agents-md (→ https://learn.chatgpt.com/docs/agent-configuration/agents-md) · https://learn.chatgpt.com/docs/build-skills · /config-file/config-reference · /config-file/config-advanced · /hooks · /agent-configuration/subagents · /developer-commands?surface=cli · https://github.com/openai/codex/releases |
| OpenCode | 1.18.20 installed; 1.18.27 current | https://opencode.ai/docs/rules · /skills · /agents · /commands · /permissions · /plugins · /config · /cli · https://opencode.ai/v2/docs/migrate-v1 · source https://github.com/anomalyco/opencode (`packages/opencode/src/session/instruction.ts`, `skill/index.ts`, `config/agent.ts`) |
| GitHub Copilot | coding agent + CLI + VS Code, docs current 2026-09-04 | https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions · custom agents (`.github/agents/*.agent.md`) · hooks (`.github/hooks/*.json`) · Agent Skills docs (`.github/skills`, `.claude/skills`, `.agents/skills`) — full URL list in `harness-docs-copilot-cursor-gemini.md` |
| Cursor | IDE + Cursor CLI (`agent`) | https://cursor.com/docs/context/rules · skills · agents · hooks · commands (see per-fact URLs in `harness-docs-copilot-cursor-gemini.md`) |
| Gemini CLI | v0.58.0 (2026-09-01); skills since v0.24.0, hooks/skills stable v0.27.0 | https://geminicli.com/docs/ (cli/configuration, memory/context files, skills, commands, hooks, agents) — per-fact URLs in `harness-docs-copilot-cursor-gemini.md` |

## Standards

| Standard | URL | Checked | Steward / status |
|---|---|---|---|
| AGENTS.md | https://agents.md · repo https://github.com/agentsmd/agents.md | 2026-09-04 | Agentic AI Foundation (Linux Foundation); filename + Markdown + nearest-file-wins only |
| Agent Skills | https://agentskills.io/specification · https://agentskills.io/clients · validator https://github.com/agentskills/agentskills/tree/main/skills-ref | 2026-09-04 | Originated by Anthropic; open (Apache-2.0 code, CC-BY-4.0 docs) |
| Subagent definition format | — | 2026-09-04 | **No standard exists** (confirmed by absence on agents.md, agentskills.io, aaif.io) |

## Local empirical evidence

Fixture probes run 2026-09-04 on macOS (Darwin 25.6, arm64) with the installed versions above; transcripts summarized in `harness-docs-claude-codex-opencode.md` §1–3. Fixture directories were throwaway (`scratchpad/fixture`, `scratchpad/fixture2`); no reference repo or the frozen previous repository was modified.
