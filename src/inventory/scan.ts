import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { AssetKind, ContentClass, HarnessId, Inventory, InventoryItem, PathType } from '../model/types.ts';
import { HARNESS_IDS } from '../model/types.ts';
import { abs, existsExact, isInside, listDir, pathType, readlink, resolveLink, readTextIfFile, rel } from '../util/fs.ts';
import { sha256Path } from '../util/hash.ts';
import { parseFrontmatter } from '../util/frontmatter.ts';
import { countLines } from '../util/text.ts';
import { parseShim } from '../adapters/shim.ts';

/** Signals that a skills tree is vendored/tool-managed and must be treated read-only. */
const VENDOR_LOCKS = ['skills-lock.json', '.skills-lock.json'];
const FOREIGN_MARKERS = ['.agentsync-manifest', '.sync-origin', '.agents-skills-sync.json', '.claude-config-collisions', '.codex-config-collisions'];

export function scanInventory(ctx: Ctx): Inventory {
  const items: InventoryItem[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const ledgerByPath = new Map(ctx.ledger.managed.map((e) => [e.path, e] as const));
  const canonInstr = ctx.manifest?.canonical.instructions ?? 'AGENTS.md';
  const canonSkills = ctx.manifest?.canonical.skills ?? '.agents/skills';

  const push = (it: InventoryItem) => {
    if (seen.has(it.path)) return;
    seen.add(it.path);
    items.push(it);
  };

  const describe = (relPath: string): { type: PathType; linkTarget?: string; resolvesTo?: string; sha256?: string } => {
    const a = abs(ctx.root, relPath);
    const type = pathType(a);
    const out: { type: PathType; linkTarget?: string; resolvesTo?: string; sha256?: string } = { type };
    if (type === 'symlink') {
      out.linkTarget = readlink(a);
      const r = resolveLink(a);
      if (r.kind === 'ok') out.resolvesTo = isInside(ctx.root, r.realpath) ? rel(ctx.root, r.realpath) : 'outside';
      else out.resolvesTo = r.kind;
    }
    const h = sha256Path(a);
    if (h) out.sha256 = h;
    return out;
  };

  // ── canonical surfaces ────────────────────────────────────────────────────────
  if (existsExact(abs(ctx.root, canonInstr))) {
    const d = describe(canonInstr);
    const text = readTextIfFile(abs(ctx.root, canonInstr));
    push({ path: canonInstr, ...d, harness: 'shared', kind: 'instructions', cls: d.type === 'symlink' ? classifyLink(canonInstr, d, ledgerByPath, undefined) : 'canonical', evidence: [`manifest canonical.instructions (default AGENTS.md)`], ...(text !== undefined ? { lines: countLines(text) } : {}) });
  }
  if (existsExact(abs(ctx.root, canonSkills))) {
    const d = describe(canonSkills);
    push({ path: canonSkills, ...d, harness: 'shared', kind: 'skills-root', cls: d.type === 'symlink' ? classifyLink(canonSkills, d, ledgerByPath, undefined) : 'canonical', evidence: ['manifest canonical.skills (default .agents/skills)'] });
    if (d.type === 'dir') scanSkillsDir(ctx, canonSkills, 'shared', 'canonical', push, describe, ledgerByPath);
  }

  // ── per-harness surfaces from the matrix ──────────────────────────────────────
  const detected = new Set<HarnessId>();
  for (const h of HARNESS_IDS) {
    const m = ctx.matrix[h];
    const s = m.surfaces;
    let present = false;
    const mark = () => { present = true; };

    for (const f of [...(s.instructions?.root ?? []), ...(s.instructions?.legacyRoot ?? [])]) {
      if (f === canonInstr) continue;
      if (!existsExact(abs(ctx.root, f))) continue;
      mark();
      const d = describe(f);
      const text = readTextIfFile(abs(ctx.root, f));
      const isLegacy = (s.instructions?.legacyRoot ?? []).includes(f);
      let cls: ContentClass = isLegacy ? 'legacy' : 'native';
      const evidence = [`${h}.surfaces.instructions`];
      if (d.type === 'symlink') cls = classifyLink(f, d, ledgerByPath, canonInstr);
      else if (text !== undefined) {
        const led = ledgerByPath.get(f);
        const ps = parseShim(text);
        if (led && led.mechanism === 'shim') { cls = 'managed'; evidence.push('ledger: shim'); }
        else if (ps.isShim && ps.importLine && ps.importLine.replace(/^@(\.\/)?/, '') === canonInstr) { cls = 'unmanaged-compatible'; evidence.push(`imports ${canonInstr} but not ledgered`); }
      }
      push({ path: f, ...d, harness: h, kind: 'instructions', cls, evidence, ...(text !== undefined ? { lines: countLines(text) } : {}) });
    }

    for (const dir of [...(s.skills?.dirs ?? []), ...(s.skills?.legacyDirs ?? [])]) {
      if (dir === canonSkills) { if (existsExact(abs(ctx.root, dir))) mark(); continue; }
      if (!existsExact(abs(ctx.root, dir))) continue;
      mark();
      const d = describe(dir);
      const legacy = (s.skills?.legacyDirs ?? []).includes(dir);
      const cls: ContentClass = d.type === 'symlink' ? classifyLink(dir, d, ledgerByPath, canonSkills) : legacy ? 'legacy' : 'native';
      push({ path: dir, ...d, harness: h, kind: 'skills-root', cls, evidence: [`${h}.surfaces.skills`] });
      if (d.type === 'dir') {
        const foreign = listDir(abs(ctx.root, dir)).some((e) => FOREIGN_MARKERS.includes(e.name));
        if (foreign) notes.push(`${dir}: foreign manager marker present — directory treated as co-owned`);
        scanSkillsDir(ctx, dir, h, legacy ? 'legacy' : 'native', push, describe, ledgerByPath, canonSkills, foreign);
      }
    }

    for (const dir of s.commands?.dirs ?? []) {
      if (!existsExact(abs(ctx.root, dir))) continue;
      mark();
      for (const f of walkMd(ctx.root, dir)) {
        const d = describe(f);
        const text = readTextIfFile(abs(ctx.root, f));
        const fm = text !== undefined ? parseFrontmatter(text) : undefined;
        push({ path: f, ...d, harness: h, kind: 'command', cls: s.commands?.legacy ? 'legacy' : 'native', name: path.posix.basename(f, '.md'), evidence: [`${h}.surfaces.commands${s.commands?.legacy ? ' (legacy: unified with skills)' : ''}`], ...(fm ? { frontmatter: fm.data } : {}), ...(text !== undefined ? { lines: countLines(text) } : {}) });
      }
    }

    for (const dir of [...(s.agents?.dirs ?? []), ...(s.agents?.legacyDirs ?? [])]) {
      if (!existsExact(abs(ctx.root, dir))) continue;
      mark();
      const dd = describe(dir);
      if (dd.type === 'symlink') push({ path: dir, ...dd, harness: h, kind: 'agent', cls: classifyLink(dir, dd, ledgerByPath, undefined), evidence: [`${h}.surfaces.agents`] });
      for (const f of walkAny(ctx.root, dir, ['.md', '.toml'])) {
        const d = describe(f);
        const text = readTextIfFile(abs(ctx.root, f));
        const fm = text !== undefined && f.endsWith('.md') ? parseFrontmatter(text) : undefined;
        const led = ledgerByPath.get(f);
        push({ path: f, ...d, harness: h, kind: 'agent', cls: led?.mechanism === 'generated' ? 'managed' : (s.agents?.legacyDirs ?? []).includes(dir) ? 'legacy' : 'native', name: path.posix.basename(f).replace(/\.(md|toml)$/, ''), evidence: [`${h}.surfaces.agents (${s.agents?.format})`], ...(fm ? { frontmatter: fm.data } : {}), ...(text !== undefined ? { lines: countLines(text) } : {}) });
      }
    }

    for (const dir of s.rules?.dirs ?? []) {
      if (!existsExact(abs(ctx.root, dir))) continue;
      mark();
      for (const f of walkAny(ctx.root, dir, ['.md', '.mdc'])) push({ path: f, ...describe(f), harness: h, kind: 'rule', cls: 'native', evidence: [`${h}.surfaces.rules`] });
    }
    for (const f of s.settings?.files ?? []) {
      if (!existsExact(abs(ctx.root, f))) continue;
      mark();
      push({ path: f, ...describe(f), harness: h, kind: 'settings', cls: 'native', evidence: [`${h}.surfaces.settings`] });
    }
    for (const f of s.hooks?.files ?? []) {
      if (!existsExact(abs(ctx.root, f))) continue;
      mark();
      push({ path: f, ...describe(f), harness: h, kind: 'hooks', cls: 'native', evidence: [`${h}.surfaces.hooks`] });
    }
    for (const dir of s.hooks?.dirs ?? []) {
      if (!existsExact(abs(ctx.root, dir))) continue;
      mark();
      for (const f of walkAny(ctx.root, dir, ['.json'])) push({ path: f, ...describe(f), harness: h, kind: 'hooks', cls: 'native', evidence: [`${h}.surfaces.hooks`] });
    }
    for (const pd of m.detect.projectDirs) if (existsExact(abs(ctx.root, pd))) mark();
    if (present) detected.add(h);
  }

  // ── nested instruction files (one level of evidence; not converged in v1) ────
  for (const nested of findNested(ctx.root, ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'])) {
    push({ path: nested, ...describe(nested), harness: 'shared', kind: 'instructions', cls: 'native', evidence: ['nested instruction file (audited only in v1)'] });
  }

  // ── AgentConcord's own files ──────────────────────────────────────────────────
  for (const f of ['agentconcord.yaml', '.agentconcord/ledger.yaml']) {
    if (existsExact(abs(ctx.root, f))) push({ path: f, ...describe(f), kind: 'manifest', cls: 'managed', evidence: ['agentconcord'] });
  }

  // ── ledgered paths that no longer exist ───────────────────────────────────────
  for (const e of ctx.ledger.managed) {
    if (!seen.has(e.path) && !existsExact(abs(ctx.root, e.path))) push({ path: e.path, type: 'missing', kind: e.kind, cls: 'managed', evidence: ['ledgered but missing on disk'] });
  }

  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { schema: 1, root: ctx.root, items, harnessesDetected: HARNESS_IDS.filter((h) => detected.has(h)), notes };
}

function classifyLink(relPath: string, d: { resolvesTo?: string; linkTarget?: string }, ledger: Map<string, { mechanism: string; target?: string }>, expectedTarget: string | undefined): ContentClass {
  const led = ledger.get(relPath);
  if (led && led.mechanism === 'link') return 'managed';
  if (expectedTarget && d.resolvesTo === expectedTarget) return 'unmanaged-compatible';
  return 'foreign';
}

function scanSkillsDir(
  ctx: Ctx,
  dir: string,
  harness: HarnessId | 'shared',
  baseCls: ContentClass,
  push: (it: InventoryItem) => void,
  describe: (p: string) => { type: PathType; linkTarget?: string; resolvesTo?: string; sha256?: string },
  ledger: Map<string, { mechanism: string; target?: string }>,
  canonSkills?: string,
  foreignDir = false,
): void {
  const absDir = abs(ctx.root, dir);
  // lock files sit beside the skills tree's package root: <pkg>/skills-lock.json with <pkg>/.agents/skills
  const vendored = VENDOR_LOCKS.some((l) => existsExact(path.join(absDir, l)) || existsExact(path.join(path.dirname(absDir), l)) || existsExact(path.join(path.dirname(path.dirname(absDir)), l)));
  for (const e of listDir(absDir)) {
    if (e.name.startsWith('.') && !e.isDirectory() && !e.isSymbolicLink()) continue;
    const p = `${dir}/${e.name}`;
    const d = describe(p);
    if (d.type === 'symlink') {
      const expected = canonSkills ? `${canonSkills}/${e.name}` : undefined;
      push({ path: p, ...d, harness, kind: 'skill', name: e.name, cls: classifyLink(p, d, ledger, expected), evidence: [`skill entry link in ${dir}`] });
      continue;
    }
    if (d.type !== 'dir') { push({ path: p, ...d, harness, kind: 'other', cls: FOREIGN_MARKERS.includes(e.name) ? 'foreign' : 'foreign', evidence: [`non-skill entry in ${dir}`] }); continue; }
    const skillMd = path.join(absDir, e.name, 'SKILL.md');
    const text = readTextIfFile(skillMd);
    const fm = text !== undefined ? parseFrontmatter(text) : undefined;
    const led = ledger.get(p);
    let cls: ContentClass = baseCls;
    const evidence = [`skill dir in ${dir}`];
    if (vendored) { cls = 'vendored'; evidence.push('vendored (skills lock file present)'); }
    else if (led?.mechanism === 'copy') { cls = 'managed'; evidence.push('ledger: copy'); }
    else if (led?.mechanism === 'adopted') { cls = 'canonical'; evidence.push(`adopted from ${(led as { origin?: string }).origin ?? '?'}`); }
    else if (foreignDir) { cls = 'foreign'; evidence.push('directory co-owned by another manager'); }
    if (text === undefined) evidence.push('no SKILL.md');
    push({ path: p, ...d, harness, kind: 'skill', name: e.name, cls, evidence, ...(fm ? { frontmatter: fm.data } : {}), ...(text !== undefined ? { lines: countLines(text) } : {}) });
  }
}

function walkMd(root: string, dir: string): string[] { return walkAny(root, dir, ['.md']); }

function walkAny(root: string, dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const visit = (relDir: string) => {
    for (const e of listDir(abs(root, relDir))) {
      const p = `${relDir}/${e.name}`;
      if (e.isDirectory()) visit(p);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  };
  visit(dir);
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.agentconcord', 'target', '.venv', 'venv', '__pycache__']);

function findNested(root: string, names: string[], maxDepth = 4): string[] {
  const out: string[] = [];
  const visit = (relDir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const e of listDir(abs(root, relDir || '.'))) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const p = relDir ? `${relDir}/${e.name}` : e.name;
      for (const n of names) if (existsExact(abs(root, `${p}/${n}`))) out.push(`${p}/${n}`);
      visit(p, depth + 1);
    }
  };
  visit('', 1);
  return out;
}

export function itemsOfKind(inv: Inventory, kind: AssetKind): InventoryItem[] {
  return inv.items.filter((i) => i.kind === kind);
}
