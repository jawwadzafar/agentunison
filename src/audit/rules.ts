import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { Finding, Inventory, InventoryItem, HarnessId } from '../model/types.ts';
import { abs, readTextIfFile, existsExact } from '../util/fs.ts';
import { paragraphs, paragraphKey, similarity, claudeOnlySyntax } from '../util/text.ts';
import { parseFrontmatter, lintSkillFrontmatter } from '../util/frontmatter.ts';
import { parseShim } from '../adapters/shim.ts';
import { countLines } from '../util/text.ts';

/**
 * Deterministic audit rules. Findings carry evidence and, where a judgment is needed,
 * `questions` for a human/agent — the tool never answers them. Similarity is report-only.
 */
export function runAudit(ctx: Ctx, inv: Inventory): Finding[] {
  const out: Finding[] = [];
  const targets = ctx.manifest?.targets ?? inv.harnessesDetected;
  const canonInstr = ctx.manifest?.canonical.instructions ?? 'AGENTS.md';
  const canonSkills = ctx.manifest?.canonical.skills ?? '.agents/skills';

  // A01 — multiple root instruction files with non-shim content
  const rootInstr = inv.items.filter((i) => i.kind === 'instructions' && !i.path.includes('/') && i.type === 'file');
  const nonShim = rootInstr.filter((i) => {
    const t = readTextIfFile(abs(ctx.root, i.path)) ?? '';
    return !parseShim(t).isShim;
  });
  if (nonShim.length > 1) {
    const texts = new Map(nonShim.map((i) => [i.path, readTextIfFile(abs(ctx.root, i.path)) ?? '']));
    const pairs: Record<string, unknown>[] = [];
    for (let a = 0; a < nonShim.length; a++) for (let b = a + 1; b < nonShim.length; b++) {
      const pa = paragraphs(texts.get(nonShim[a]!.path)!), pb = paragraphs(texts.get(nonShim[b]!.path)!);
      const keysB = new Set(pb.map(paragraphKey));
      const shared = pa.filter((p) => keysB.has(paragraphKey(p))).length;
      pairs.push({ a: nonShim[a]!.path, b: nonShim[b]!.path, sharedParagraphsExact: shared, paragraphsA: pa.length, paragraphsB: pb.length, similarityReportOnly: Number(similarity(texts.get(nonShim[a]!.path)!, texts.get(nonShim[b]!.path)!).toFixed(2)) });
    }
    out.push({ id: `A01:${nonShim.map((i) => i.path).join('+')}`, rule: 'A01', severity: 'high', message: `${nonShim.length} root instruction files carry real content (${nonShim.map((i) => i.path).join(', ')}); agents read different truths`, paths: nonShim.map((i) => i.path), evidence: { pairs }, questions: ['Which file is canonical? Paragraphs unique to the non-canonical file must be adopted into it or kept as harness-specific.'] });
  }

  // A02 — budgets (line/byte) per targeted harness
  for (const i of rootInstr) {
    const text = readTextIfFile(abs(ctx.root, i.path)) ?? '';
    for (const h of targets) {
      const m = ctx.matrix[h];
      const reads = i.path === canonInstr ? m.instructions.readsAgentsMd.value || h === 'claude' : m.surfaces.instructions?.root.includes(i.path);
      if (!reads) continue;
      if (m.instructions.lineBudget && countLines(text) > m.instructions.lineBudget) out.push({ id: `A02:${i.path}:${h}`, rule: 'A02', severity: 'medium', message: `${i.path} is ${countLines(text)} lines; ${m.displayName} guidance is ≤ ${m.instructions.lineBudget} (always-loaded context)`, paths: [i.path] });
      if (m.instructions.byteBudget && Buffer.byteLength(text, 'utf8') > m.instructions.byteBudget) out.push({ id: `A02b:${i.path}:${h}`, rule: 'A02', severity: 'medium', message: `${i.path} is ${Buffer.byteLength(text, 'utf8')} bytes; ${m.displayName} caps combined instructions at ${m.instructions.byteBudget}`, paths: [i.path] });
    }
  }

  // A03 — instruction text references repo paths that do not exist
  for (const i of rootInstr) {
    const text = readTextIfFile(abs(ctx.root, i.path)) ?? '';
    const missing = new Set<string>();
    for (const m of text.matchAll(/`((?:\.?[\w-]+\/)+[\w.-]+)`/g)) {
      const p = m[1]!;
      if (p.includes('<') || p.includes('*') || p.includes('{')) continue;
      if (!existsExact(abs(ctx.root, p)) && !existsExact(abs(ctx.root, p.replace(/\/$/, '')))) missing.add(p);
    }
    if (missing.size) out.push({ id: `A03:${i.path}`, rule: 'A03', severity: 'medium', message: `${i.path} references ${missing.size} path(s) that do not exist in the repo`, paths: [i.path], evidence: { missing: [...missing].sort().slice(0, 25) } });
  }

  // A04 — skill trees in more than one location; duplicates by name
  const skills = inv.items.filter((i) => i.kind === 'skill' && i.type === 'dir' && i.cls !== 'vendored');
  const byName = new Map<string, InventoryItem[]>();
  for (const s of skills) byName.set(s.name!, [...(byName.get(s.name!) ?? []), s]);
  const roots = new Set(skills.map((s) => path.posix.dirname(s.path)));
  if (roots.size > 1) {
    out.push({ id: `A04:roots`, rule: 'A04', severity: 'high', message: `skills live in ${roots.size} directories (${[...roots].sort().join(', ')}); harnesses that scan several of them load duplicates`, paths: [...roots].sort() });
  }
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const hashes = new Set(list.map((s) => s.sha256));
    out.push({ id: `A04:${name}`, rule: 'A04', severity: hashes.size > 1 ? 'high' : 'medium', message: hashes.size > 1 ? `skill '${name}' exists in ${list.length} places with DIFFERENT content — conflict` : `skill '${name}' exists in ${list.length} places with identical content — duplicate`, paths: list.map((s) => s.path), evidence: { identical: hashes.size === 1 } });
  }

  // A05 — skill frontmatter lint (spec)
  const claudeExtra = ctx.matrix.claude.skills.extraFrontmatter ?? [];
  for (const s of skills) {
    const text = readTextIfFile(path.join(abs(ctx.root, s.path), 'SKILL.md'));
    if (text === undefined) { out.push({ id: `A05:${s.path}`, rule: 'A05', severity: 'high', message: `${s.path}: no SKILL.md`, paths: [s.path] }); continue; }
    const lint = lintSkillFrontmatter(s.name!, parseFrontmatter(text), countLines(text), claudeExtra);
    if (lint.blocking.length) out.push({ id: `A05:${s.path}`, rule: 'A05', severity: 'high', message: `${s.path}: ${lint.blocking.join('; ')}`, paths: [s.path], evidence: { blocking: lint.blocking } });
    if (lint.degraded.length) out.push({ id: `A05d:${s.path}`, rule: 'A05', severity: 'low', message: `${s.path}: ${lint.degraded.join('; ')}`, paths: [s.path], evidence: { degraded: lint.degraded } });
    if (lint.info.length) out.push({ id: `A05i:${s.path}`, rule: 'A05', severity: 'info', message: `${s.path}: ${lint.info.join('; ')}`, paths: [s.path] });
  }

  // A06 — legacy surfaces
  for (const i of inv.items.filter((x) => x.cls === 'legacy')) {
    const cmd = i.kind === 'command';
    const text = cmd ? readTextIfFile(abs(ctx.root, i.path)) ?? '' : '';
    const fm = cmd ? parseFrontmatter(text) : undefined;
    const claudeOnly = cmd && fm ? claudeOnlySyntax(fm.body, fm.data) : [];
    out.push({ id: `A06:${i.path}`, rule: 'A06', severity: 'medium', message: cmd ? `${i.path} is a legacy prompt command (Claude Code unified commands with skills); adopt as a skill under ${canonSkills}` : `${i.path} is a legacy/superseded surface`, paths: [i.path], evidence: claudeOnly.length ? { claudeOnlySyntax: claudeOnly } : {}, questions: cmd ? ['Delete test: does this command encode a repeatable workflow with non-obvious repo knowledge, or is it a checklist someone found handy?'] : [] });
  }

  // A07 — agents with same name across harnesses (adapter candidates) — report only
  const agents = inv.items.filter((i) => i.kind === 'agent' && i.type === 'file');
  const agentsByName = new Map<string, InventoryItem[]>();
  for (const a of agents) agentsByName.set(a.name!, [...(agentsByName.get(a.name!) ?? []), a]);
  for (const [name, list] of agentsByName) {
    const harnesses = new Set(list.map((a) => a.harness));
    if (harnesses.size < 2) continue;
    out.push({ id: `A07:${name}`, rule: 'A07', severity: 'info', message: `agent '${name}' is defined for ${[...harnesses].join(', ')} — candidate for one source + generated adapter`, paths: list.map((a) => a.path), questions: ['Why does this role need context isolation rather than a skill? What output contract does it guarantee?'] });
  }

  // A11 — symlink-hostile signals
  for (const e of ctx.ledger.managed) {
    if (e.mechanism !== 'link') continue;
    const it = inv.items.find((i) => i.path === e.path);
    if (it && it.type === 'file' && ctx.localMechanisms[e.path] !== 'copy') out.push({ id: `A11:${e.path}`, rule: 'A11', severity: 'high', message: `${e.path} is a regular file where a committed symlink is expected (checkout without symlink support?)`, paths: [e.path], evidence: { fix: 'git config core.symlinks true && re-checkout, or set policy.symlinks: never and run agentunison plan' } });
  }

  // A12 — foreign manager markers
  for (const n of inv.notes) if (n.includes('foreign manager marker')) out.push({ id: `A12:${n.split(':')[0]}`, rule: 'A12', severity: 'medium', message: n, paths: [n.split(':')[0]!] });

  // A13 — vendored trees
  const vend = inv.items.filter((i) => i.cls === 'vendored');
  if (vend.length) out.push({ id: 'A13', rule: 'A13', severity: 'info', message: `${vend.length} vendored skill(s) detected (lock file present) — excluded from convergence`, paths: vend.map((v) => v.path) });

  // A14 — copilot-instructions duplicates AGENTS.md (report only, never acted on)
  const cop = inv.items.find((i) => i.path === '.github/copilot-instructions.md' && i.type === 'file');
  const canon = inv.items.find((i) => i.path === canonInstr && i.type === 'file');
  if (cop && canon) {
    const sim = similarity(readTextIfFile(abs(ctx.root, cop.path)) ?? '', readTextIfFile(abs(ctx.root, canon.path)) ?? '');
    out.push({ id: 'A14', rule: 'A14', severity: sim > 0.7 ? 'medium' : 'info', message: `.github/copilot-instructions.md and ${canonInstr} similarity ${sim.toFixed(2)} (report only). Copilot reads AGENTS.md natively, but Copilot Chat surfaces that do not read AGENTS.md still need this file — it is preserved.`, paths: [cop.path, canon.path] });
  }

  // A15 — shims read literally by targets that lack @-imports (cost only)
  const shims = rootInstr.filter((i) => parseShim(readTextIfFile(abs(ctx.root, i.path)) ?? '').isShim);
  for (const s of shims) for (const h of targets as HarnessId[]) {
    const lit = ctx.matrix[h].surfaces.instructions?.alsoReadsLiteral ?? [];
    if (lit.includes(s.path)) out.push({ id: `A15:${s.path}:${h}`, rule: 'A15', severity: 'info', message: `${ctx.matrix[h].displayName} reads ${s.path} literally alongside ${canonInstr} (a few duplicated lines; harmless)`, paths: [s.path] });
  }

  return out.sort((a, b) => sev(a.severity) - sev(b.severity) || (a.id < b.id ? -1 : 1));
}

function sev(s: Finding['severity']): number { return { high: 0, medium: 1, low: 2, info: 3 }[s]; }
