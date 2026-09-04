# 001 — Product vision: AgentConcord

*"Make every coding agent agree on your repository."*

## The problem, precisely

A repository that is worked on by more than one coding agent (Claude Code, Codex,
OpenCode, Copilot, Cursor, Gemini CLI, …) accumulates one instruction system per
tool: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
`.cursor/rules/*.mdc`, `.claude/skills`, `.agents/skills`, `.claude/agents`,
`.codex/agents`, `.opencode/agents`, `.claude/commands`, settings, hooks. They start
as copies and end as forks. Each agent then reads a different truth, the always-loaded
context grows, and every new agent session is tempted to add a fourth copy.

Existing tools attack fragments of this (compile a spec, symlink a skills dir, copy
agents into four formats, prescribe a layout). None of them **inspects an existing
repository, understands what is there, decides what the canonical architecture should
be, converges to it without destroying anything, projects it into each harness in the
form that harness actually reads, verifies real behavior, and keeps it from drifting.**
That whole loop is the product.

## What AgentConcord is

A repository-scoped CLI. One command against an existing repo runs:

```
inspect → inventory → understand → classify → propose → plan (dry run)
        → approve where it matters → apply → validate → verify live → protect
```

- **Inspect/understand**: read every harness surface the capability matrix knows, plus
  the repository shape (languages, build files, docs, tests) needed to judge whether an
  asset is domain-shaped or generic.
- **Classify**: canonical candidate · portable · harness-native · generated · managed ·
  user-owned · legacy · duplicate · conflicting · stale candidate.
- **Converge**: pick or confirm the canonical source for each asset kind, adopt content
  into it, reduce the rest to projections. Preserve first; quarantine rather than delete.
- **Project**: per harness, the form it reads — native path, symlink, tiny shim, managed
  copy, or a generated adapter when formats differ — chosen by an explicit policy over a
  versioned, evidence-tagged capability matrix and the current platform.
- **Verify**: structural checks always; real-harness probes (`codex debug prompt-input`,
  `opencode debug skill`, `claude -p --debug-file`, …) where the binary is installed;
  honest "structural only" where it is not.
- **Protect**: an ownership ledger, pinned shims, marker-delimited managed blocks, a
  `verify` command for CI, and routing text inside `AGENTS.md` so the *agents themselves*
  know where new assets belong and stop recreating duplicates.

## What it is not

- Not a sync tool. Copying/symlinking is one projection mechanism among five, selected by
  policy; the value is in inspection, judgment, safety, and verification.
- Not a marketplace or template library. It never ships generic agents or skills. It
  should make repositories **smaller**: fewer, better, domain-shaped assets.
- Not a universal agent format. Where the ecosystem has a standard (`AGENTS.md`, Agent
  Skills) it uses it; where it does not (subagents), it keeps the native file as the
  source and generates adapters only when the mapping is lossless and explicitly requested.
- Not an LLM-in-the-loop compiler. Every decision the tool makes is deterministic and
  testable; judgment calls are surfaced as questions in the audit for a human or an agent
  to answer, and recorded once.

## Users and journeys

1. **Fresh repository.** `agentconcord init` → detects/asks which harnesses are used,
   writes a short `AGENTS.md` skeleton, `.agents/skills/` (empty), the harness shims and
   discovery links the matrix says are needed, a manifest and ledger, and a `verify`
   hook for CI. Two minutes, nothing to learn.
2. **Mature messy repository** (the important one). `agentconcord init` (or `audit` →
   `plan` → `apply`) → truthful inventory with evidence, findings (duplicates with
   similarity %, stale references, oversize always-loaded files, non-portable frontmatter,
   overlapping agents), a plan listing every action with risk class, approvals for
   MOVE/MODIFY/QUARANTINE, never an unrequested DELETE, then apply + verify + status.
3. **Ongoing.** `agentconcord verify` in CI and locally; `status` shows drift in one
   screen; `plan` after adding a skill shows exactly what will change; `uninstall`
   removes only what the ledger says AgentConcord created.

## Principles (ranked)

1. **Never destroy.** Preserve → quarantine → (explicit) delete. Land before removing.
2. **Own only what you create, record what you own.** The ledger is the boundary. Foreign
   files are inventoried, never adopted or "repaired" silently.
3. **One source of truth per asset kind, in the ecosystem's location when one exists.**
4. **Policy over the verified matrix, not over folklore.** Every compatibility fact carries
   evidence class, harness version, and date. Unknown ⇒ safe fallback, loudly.
5. **Dry run is the default shape of every change.** Plan first; apply what was planned.
6. **Idempotent and byte-stable.** A second run changes nothing; no timestamp churn.
7. **Fewer, better assets.** The audit asks the delete test; the tool never mass-generates.
8. **Deterministic, CI-gateable, cross-platform.** Non-zero exit on drift; Windows is a
   first-class platform for the fallback path.

## v1 scope

- Harnesses: **Claude Code, Codex CLI, OpenCode** fully (matrix + projections + live
  verify — all three are installed on the development machine). **Copilot, Cursor, Gemini
  CLI** with matrix entries and structural projections (shim for Gemini, native for
  Copilot/Cursor), live verification only where a documented non-interactive probe exists.
- Asset kinds converged: root instructions, skills, legacy commands (→ skills). Audited but
  preserved: nested instructions, path-scoped rules, subagents, settings/hooks/MCP.
- Optional generated adapter: one native subagent file (Claude format) → OpenCode and
  Codex forms, opt-in per agent, header-marked, with degradation notes.
- Platforms: macOS/Linux (symlinks) and Windows (copy/shim fallbacks, junction for dirs
  where allowed), all decided by probe at run time and overridable in the manifest.

Out of scope for v1: user-global (`~/.claude`, `~/.codex`) surfaces, MCP config
merging, hooks translation, plugin/marketplace formats, an LLM-authored knowledge base.
