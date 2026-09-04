import type { Ctx } from '../model/context.ts';
import type { HarnessId, Inventory } from '../model/types.ts';
import { evidenceTag, verifiedFor } from '../matrix/loader.ts';

export type InstructionsMechanism = 'native' | 'shim' | 'none';
export type SkillsMechanism = 'native' | 'symlink-dir' | 'symlink-entries' | 'copy' | 'none';

export interface Decision<M extends string> {
  harness: HarnessId;
  kind: 'instructions' | 'skills';
  mechanism: M;
  reason: string;
  evidence: string[];
  degradation: string[];
  shimImportLine?: string;
}

export interface Decisions {
  instructions: Decision<InstructionsMechanism>[];
  skills: Decision<SkillsMechanism>[];
}

/**
 * The projection policy ladder (003 §4, amended). Pure: inputs are the matrix, the platform
 * probe, the manifest and the inventory; output cites the matrix facts it relied on.
 */
export function decideProjections(ctx: Ctx, inv: Inventory): Decisions {
  const m = ctx.manifest;
  if (!m) return { instructions: [], skills: [] };
  const out: Decisions = { instructions: [], skills: [] };
  const canonSkills = m.canonical.skills;
  const canonInstr = m.canonical.instructions;

  for (const h of m.targets) {
    const hm = ctx.matrix[h];
    const pin = m.projections?.[h] ?? {};

    // ── instructions ─────────────────────────────────────────────────────────
    if (hm.instructions.readsAgentsMd.value && canonInstr === 'AGENTS.md') {
      out.instructions.push({ harness: h, kind: 'instructions', mechanism: 'native', reason: `${hm.displayName} reads ${canonInstr} natively`, evidence: [evidenceTag(h, 'instructions.readsAgentsMd', hm.instructions.readsAgentsMd)], degradation: [] });
    } else if (hm.instructions.importSyntax.value) {
      const tmpl = hm.instructions.importSyntax.value;
      const relForm = h === 'gemini' ? `./${canonInstr}` : canonInstr;
      const importLine = tmpl.replace('{path}', relForm);
      const deg: string[] = [];
      if (hm.instructions.importSyntax.evidence !== 'test') deg.push(`import behaviour for ${hm.displayName} is documented but not fixture-verified here`);
      const d: Decision<InstructionsMechanism> = { harness: h, kind: 'instructions', mechanism: 'shim', reason: `${hm.displayName} does not read ${canonInstr}; a shim imports it`, evidence: [evidenceTag(h, 'instructions.readsAgentsMd', hm.instructions.readsAgentsMd), evidenceTag(h, 'instructions.importSyntax', hm.instructions.importSyntax)], degradation: deg, shimImportLine: importLine };
      out.instructions.push(d);
    } else {
      out.instructions.push({ harness: h, kind: 'instructions', mechanism: 'none', reason: `${hm.displayName} neither reads ${canonInstr} nor supports imports`, evidence: [evidenceTag(h, 'instructions.readsAgentsMd', hm.instructions.readsAgentsMd)], degradation: [`${hm.displayName} will not see the canonical instructions`] });
    }

    // ── skills ───────────────────────────────────────────────────────────────
    if (hm.skills.readsCanonical.value && canonSkills === '.agents/skills') {
      out.skills.push({ harness: h, kind: 'skills', mechanism: 'native', reason: `${hm.displayName} reads ${canonSkills} natively`, evidence: [evidenceTag(h, 'skills.readsCanonical', hm.skills.readsCanonical)], degradation: [] });
      continue;
    }
    const nativeDir = hm.surfaces.skills?.dirs[0];
    if (!nativeDir) { out.skills.push({ harness: h, kind: 'skills', mechanism: 'none', reason: `${hm.displayName} has no project skills surface`, evidence: [], degradation: [] }); continue; }
    const pinned = pin['skills'];
    const linkOk = ctx.platform.symlinks && m.policy.symlinks !== 'never';
    const dirVerified = verifiedFor(hm.skills.followsDirSymlink, ctx.platform.family);
    const entryVerified = verifiedFor(hm.skills.followsEntrySymlink, ctx.platform.family);
    const nativeRoot = inv.items.find((i) => i.path === nativeDir);
    const nativeHasContent = nativeRoot?.type === 'dir' && inv.items.some((i) => i.path.startsWith(`${nativeDir}/`) && i.cls !== 'managed');
    const foreign = inv.notes.some((n) => n.startsWith(`${nativeDir}:`));
    const others = m.targets.filter((t) => t !== h && (ctx.matrix[t].surfaces.skills?.dirs ?? []).includes(nativeDir));
    const dupDeg = others.length ? [`${others.map((t) => ctx.matrix[t].displayName).join(', ')} also ${others.length>1?'scan':'scans'} ${nativeDir}: ${others.map((t) => `${ctx.matrix[t].skills.dedup === 'first-wins' ? 'dedups by name' : ctx.matrix[t].skills.dedup === 'none' ? 'shows duplicates' : 'dedup unknown'}`).join('/')}`] : [];

    if (foreign) {
      out.skills.push({ harness: h, kind: 'skills', mechanism: 'none', reason: `${nativeDir} is co-owned by another manager (marker present); refusing to project into it`, evidence: [], degradation: [`${hm.displayName} keeps reading ${nativeDir} as-is`] });
      continue;
    }
    let mech: SkillsMechanism;
    let reason: string;
    const ev: string[] = [evidenceTag(h, 'skills.readsCanonical', hm.skills.readsCanonical)];
    if (pinned === 'copy' || pinned === 'none' || pinned === 'symlink-dir' || pinned === 'symlink-entries') {
      mech = pinned; reason = `pinned in agentconcord.yaml projections.${h}.skills`;
      if ((mech === 'symlink-dir' || mech === 'symlink-entries') && !linkOk) { mech = 'copy'; reason += ' — but symlinks unavailable here, falling back to copy'; }
    } else if (linkOk && (m.policy.symlinks === 'always' || dirVerified || entryVerified)) {
      if (nativeHasContent) {
        mech = entryVerified || m.policy.symlinks === 'always' ? 'symlink-entries' : 'copy';
        reason = `${nativeDir} exists with content: per-skill links keep unrelated entries untouched`;
        ev.push(evidenceTag(h, 'skills.followsEntrySymlink', hm.skills.followsEntrySymlink));
      } else {
        mech = dirVerified || m.policy.symlinks === 'always' ? 'symlink-dir' : entryVerified ? 'symlink-entries' : 'copy';
        reason = `${nativeDir} is absent/empty: one directory link covers every current and future skill`;
        ev.push(evidenceTag(h, 'skills.followsDirSymlink', hm.skills.followsDirSymlink));
      }
    } else {
      mech = 'copy';
      reason = !ctx.platform.symlinks ? 'platform cannot create symlinks (probe) — managed copies' : m.policy.symlinks === 'never' ? 'policy.symlinks: never — managed copies' : `symlink following not verified for ${hm.displayName} on ${ctx.platform.family} — managed copies`;
      ev.push(evidenceTag(h, 'skills.followsDirSymlink', hm.skills.followsDirSymlink));
    }
    const deg = [...dupDeg];
    if (mech === 'copy') deg.push('copies drift: edits made in the copy must be back-ported (agentconcord apply --approve BACKPORT:…)');
    out.skills.push({ harness: h, kind: 'skills', mechanism: mech, reason, evidence: ev, degradation: deg });
  }
  return out;
}
