# T-13 — Re-verification procedure (recurring) — DONE

When `doctor` reports an installed harness version differs from `matrix/<harness>.yaml`:

1. Read `docs/VERIFICATION.md` §V-06 (live harness probes) and §V-07 (dogfood).
2. Run per-harness probes against installed binary (see V-06 snippet):
   - `codex debug prompt-input hello | grep -c "agentunison:"`
   - `opencode debug skill | jq ...`
   - `env -u CLAUDECODE claude -p ...` + grep `/tmp/c.log`
3. Update `matrix/<harness>.yaml`: `versionsVerified`, `checkedOn`, `note`.
4. If probe output changed (unparseable / new error format): update the probe command in `matrix/` and `docs/VERIFICATION.md`.
5. Run `npm test`; update `dev_docs/2026-09-04/agentunison/PROGRESS.md`.
6. PR: `matrix: <harness> <version>` — only matrix + PROGRESS changes unless behavior changed.

Accept: checklist present; `doctor` warning has a documented resolution path.
