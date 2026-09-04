#!/usr/bin/env bash
# Creates the "messy legacy" fixture repo in $1: two divergent root instruction files, skills in
# two places (identical + conflicting + native-only), legacy commands (incl. namespaced), native
# agents/config for three harnesses, .cursorrules, copilot-instructions, a stale path reference.
set -euo pipefail
R="$1"; rm -rf "$R"; mkdir -p "$R"; cd "$R"; git init -q .
cat > AGENTS.md <<'MD'
# Acme Gateway

Canonical rules for agents.

## Hard rules
- Never push to main. Every change goes through a PR against develop.
- Stage files by explicit path.

## Commands
Run `scripts/test-all.sh` before claiming done. See `docs/nope.md` for details.
MD
cat > CLAUDE.md <<'MD'
# Acme Gateway

## Hard rules
- Never push to main. Every change goes through a PR against develop.
- Stage files by explicit path.

## Deploy notes
Deploy only to the dev cluster; production is owner-gated.

## Claude specifics
Use the `reviewer` subagent in `.claude/agents` before every commit.
MD
mkdir -p .agents/skills/deploy .agents/skills/review .claude/skills/deploy .claude/skills/review .claude/skills/local-only .claude/commands/frontend .claude/agents .codex .opencode/agents .github
printf -- '---\nname: deploy\ndescription: Use when deploying one service to the dev cluster.\n---\n# Deploy\nSteps.\n' > .agents/skills/deploy/SKILL.md
cp .agents/skills/deploy/SKILL.md .claude/skills/deploy/SKILL.md
printf -- '---\nname: review\ndescription: Use when reviewing a PR against the repo rules.\n---\n# Review\nCanonical version.\n' > .agents/skills/review/SKILL.md
printf -- '---\nname: review\ndescription: Use when reviewing a PR against the repo rules.\n---\n# Review\nOLDER divergent version.\n' > .claude/skills/review/SKILL.md
printf -- '---\nname: local-only\ndescription: Use when rotating API keys.\n---\n# Rotate keys\nSteps.\n' > .claude/skills/local-only/SKILL.md
printf -- '---\ndescription: Cut a release PR.\n---\nCut the release for $ARGUMENTS. Never bump versions.\n' > .claude/commands/release.md
printf -- 'Scaffold a component named $ARGUMENTS in tf-portal-web.\n' > .claude/commands/frontend/component.md
printf -- '---\nname: reviewer\ndescription: Adversarial read-only reviewer.\ntools: Read, Grep\nmodel: opus\n---\nYou review diffs.\n' > .claude/agents/reviewer.md
printf -- '[agents]\nmax_threads = 2\n' > .codex/config.toml
printf -- '---\ndescription: OpenCode helper\nmode: subagent\n---\nHelp.\n' > .opencode/agents/helper.md
printf -- 'Always use TypeScript strict mode.\n' > .cursorrules
cp AGENTS.md .github/copilot-instructions.md
git add -A >/dev/null && git -c user.name=fixture -c user.email=f@x -c commit.gpgsign=false commit -qm "messy fixture"
