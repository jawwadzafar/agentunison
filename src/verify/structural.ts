import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { Inventory, VerifyIssue, VerifyReport } from '../model/types.ts';
import { abs, existsExact, pathType, readlink, readTextIfFile, resolveLink, isInside, rel, listDir } from '../util/fs.ts';
import { sha256Path, sha256Text, sha256Tree } from '../util/hash.ts';
import { findBlock, parseShim, shimHash } from '../adapters/shim.ts';
import { lintSkillFrontmatter, parseFrontmatter } from '../util/frontmatter.ts';
import { countLines } from '../util/text.ts';

/**
 * Structural verification: ledger ↔ filesystem, invariants, spec. Pure and fast; the CI gate.
 */
export function verifyStructural(ctx: Ctx, inv: Inventory): VerifyReport {
  const issues: VerifyIssue[] = [];
  const m = ctx.manifest;
  const canonInstr = m?.canonical.instructions ?? 'AGENTS.md';
  const canonSkills = m?.canonical.skills ?? '.agents/skills';
  const push = (i: VerifyIssue) => issues.push(i);

  if (!m) push({ code: 'invariant', message: 'agentunison.yaml missing — run `agentunison init`' });

  // ledger entries
  for (const e of ctx.ledger.managed) {
    const a = abs(ctx.root, e.path);
    const t = pathType(a);
    const localMech = ctx.localMechanisms[e.path];
    switch (e.mechanism) {
      case 'shim': {
        if (t !== 'file') { push({ code: 'drift', path: e.path, message: `shim missing or not a regular file (${t})`, fix: 'agentunison apply' }); break; }
        const text = readTextIfFile(a) ?? '';
        const ps = parseShim(text);
        if (!ps.isShim) push({ code: 'drift', path: e.path, message: 'shim no longer starts with the @import line', fix: 'agentunison plan (REPAIR)' });
        else if (shimHash(text) !== e.sha256) push({ code: 'drift', path: e.path, message: 'shim managed part differs from the ledger (instructions were added to the shim?)', fix: `move the text into ${canonInstr}, then agentunison apply --approve REPAIR:${e.path}` });
        if (ps.harnessSpecific && countLines(ps.harnessSpecific) > 40) push({ code: 'invariant', path: e.path, message: `harness-specific section is ${countLines(ps.harnessSpecific)} lines — drifting into a second instruction file` });
        break;
      }
      case 'link': {
        if (localMech === 'copy') {
          if (t !== 'dir') push({ code: 'environment', path: e.path, message: 'recorded as a machine-local copy but the directory is missing', fix: 'agentunison apply' });
          break;
        }
        if (t === 'file') push({ code: 'environment', path: e.path, message: 'committed symlink materialized as a text file (checkout without symlink support)', fix: 'git config core.symlinks true && git checkout -- ' + e.path + ' ; or set policy.symlinks: never and re-plan' });
        else if (t !== 'symlink') push({ code: 'drift', path: e.path, message: `expected a symlink, found ${t}`, fix: 'agentunison plan' });
        else {
          const raw = readlink(a);
          if (raw !== e.target && localMech !== 'junction') push({ code: 'drift', path: e.path, message: `link target is ${raw}, ledger says ${e.target}` });
          const r = resolveLink(a);
          if (r.kind !== 'ok') push({ code: 'drift', path: e.path, message: `link is ${r.kind}` });
          else if (!isInside(ctx.root, r.realpath)) push({ code: 'invariant', path: e.path, message: 'link escapes the repository' });
        }
        break;
      }
      case 'copy': {
        if (t === 'missing') { push({ code: 'drift', path: e.path, message: 'managed copy missing', fix: 'agentunison apply' }); break; }
        const h = t === 'dir' ? sha256Tree(a) : sha256Path(a);
        if (h !== e.sha256) {
          const srcHash = e.source ? sha256Path(abs(ctx.root, e.source)) : undefined;
          if (srcHash && srcHash === h) push({ code: 'drift', path: e.path, message: 'managed copy matches a newer canonical but the ledger is stale', fix: 'agentunison apply' });
          else if (srcHash && srcHash !== e.sha256 && h === e.sha256) { /* fine */ }
          else push({ code: 'drift', path: e.path, message: 'managed copy was edited in place', fix: `agentunison apply --approve BACKPORT:${e.source ?? '?'}` });
        } else if (e.source) {
          const srcHash = sha256Path(abs(ctx.root, e.source));
          if (srcHash && srcHash !== e.sha256) push({ code: 'drift', path: e.path, message: 'canonical changed; managed copy is stale', fix: 'agentunison apply' });
        }
        break;
      }
      case 'generated': {
        if (t !== 'file') { push({ code: 'drift', path: e.path, message: 'generated file missing' }); break; }
        if (sha256Text(readTextIfFile(a) ?? '') !== e.sha256) push({ code: 'drift', path: e.path, message: 'generated file was edited (edit the source instead)', fix: e.source ? `edit ${e.source} and run agentunison apply` : undefined });
        else if (e.source && e.sourceSha256 && sha256Path(abs(ctx.root, e.source)) !== e.sourceSha256) push({ code: 'drift', path: e.path, message: `source ${e.source} changed; adapter is stale`, fix: 'agentunison apply' });
        break;
      }
      case 'adopted': {
        if (t === 'missing') push({ code: 'drift', path: e.path, message: `adopted skill missing (moved or deleted?) — origin was ${e.origin ?? '?'}`, fix: 'remove the ledger entry if the removal was intended' });
        break;
      }
      case 'block': {
        if (t !== 'file') { push({ code: 'drift', path: e.path, message: 'file with managed block missing' }); break; }
        const loc = findBlock(readTextIfFile(a) ?? '');
        if (loc === 'damaged') push({ code: 'block-damaged', path: e.path, message: 'managed block markers are duplicated or unpaired', fix: 'restore a single begin/end pair or run agentunison apply --approve MODIFY:' + e.path + ':block' });
        else if (!loc) push({ code: 'drift', path: e.path, message: 'managed block removed', fix: 'agentunison apply' });
        else if (sha256Text(loc.text) !== e.sha256) push({ code: 'drift', path: e.path, message: 'managed block content differs from the ledger', fix: 'agentunison apply' });
        break;
      }
    }
  }

  // invariants
  if (m) {
    const root = inv.items.filter((i) => i.kind === 'instructions' && !i.path.includes('/') && i.type === 'file');
    for (const i of root) {
      if (i.path === canonInstr) continue;
      const text = readTextIfFile(abs(ctx.root, i.path)) ?? '';
      const owner = m.targets.find((h) => ctx.matrix[h].surfaces.instructions?.root.includes(i.path));
      if (owner && !parseShim(text).isShim && ctx.matrix[owner].instructions.importSyntax.value) push({ code: 'invariant', path: i.path, message: `second root instruction file with real content for ${ctx.matrix[owner].displayName}; canonical is ${canonInstr}`, fix: 'agentunison plan' });
    }
    if (!existsExact(abs(ctx.root, canonInstr))) push({ code: 'invariant', path: canonInstr, message: 'canonical instructions file missing' });
    if (pathType(abs(ctx.root, canonInstr)) === 'symlink') push({ code: 'invariant', path: canonInstr, message: 'canonical instructions must be a regular file, not a symlink' });

    // duplicate skill names across all skill dirs
    const seen = new Map<string, string[]>();
    for (const s of inv.items) if (s.kind === 'skill' && s.type === 'dir' && s.cls !== 'vendored' && s.cls !== 'managed') seen.set(s.name!, [...(seen.get(s.name!) ?? []), s.path]);
    for (const [name, paths] of seen) if (paths.length > 1) push({ code: 'invariant', message: `skill '${name}' exists in ${paths.length} places: ${paths.join(', ')}`, fix: 'agentunison plan' });

    // spec lint on canonical skills
    const claudeExtra = ctx.matrix.claude.skills.extraFrontmatter ?? [];
    if (pathType(abs(ctx.root, canonSkills)) === 'dir') {
      for (const e of listDir(abs(ctx.root, canonSkills))) {
        if (!e.isDirectory()) continue;
        const text = readTextIfFile(path.join(abs(ctx.root, canonSkills), e.name, 'SKILL.md'));
        if (text === undefined) { push({ code: 'spec', path: `${canonSkills}/${e.name}`, message: 'no SKILL.md' }); continue; }
        const lint = lintSkillFrontmatter(e.name, parseFrontmatter(text), countLines(text), claudeExtra);
        for (const b of lint.blocking) push({ code: 'spec', path: `${canonSkills}/${e.name}/SKILL.md`, message: b });
      }
    }

    // a real (non-link) skill tree in a native dir of a target while canonical exists
    for (const h of m.targets) {
      const hm = ctx.matrix[h];
      if (hm.skills.readsCanonical.value) continue;
      for (const dir of hm.surfaces.skills?.dirs ?? []) {
        for (const s of inv.items) if (s.kind === 'skill' && s.type === 'dir' && path.posix.dirname(s.path) === dir && s.cls !== 'managed' && s.cls !== 'vendored') push({ code: 'invariant', path: s.path, message: `real skill directory under ${dir} while canonical is ${canonSkills} — new skills belong in ${canonSkills}`, fix: 'agentunison plan (MOVE)' });
      }
    }
  }

  const summary = { targets: m?.targets ?? inv.harnessesDetected, managed: ctx.ledger.managed.length, canonical: { instructions: canonInstr, skills: canonSkills } };
  return { schema: 1, ok: issues.length === 0, issues, summary };
}

export { rel };
