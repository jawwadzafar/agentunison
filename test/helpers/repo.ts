import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCtx, pipeline, type CommandIO } from '../../src/commands/index.ts';
import { applyPlan } from '../../src/apply/engine.ts';
import { verifyStructural } from '../../src/verify/structural.ts';
import { scanInventory } from '../../src/inventory/scan.ts';
import { defaultManifest, renderManifest, saveManifestDecisions } from '../../src/model/manifest.ts';
import type { HarnessId, Plan, Inventory, LedgerEntry } from '../../src/model/types.ts';
import type { Ctx } from '../../src/model/context.ts';

export const FIXTURES = path.resolve(import.meta.dirname, '..', 'fixtures');

export function tmpRepo(prefix = 'ac-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q', dir]);
  return fs.realpathSync(dir);
}

export function messyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-messy-'));
  execFileSync('bash', [path.join(FIXTURES, 'make-messy.sh'), dir], { stdio: 'ignore' });
  return fs.realpathSync(dir);
}

export function write(root: string, rel: string, content: string): void {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

export function exists(root: string, rel: string): boolean {
  try { fs.lstatSync(path.join(root, ...rel.split('/'))); return true; } catch { return false; }
}

export function isLink(root: string, rel: string): boolean {
  try { return fs.lstatSync(path.join(root, ...rel.split('/'))).isSymbolicLink(); } catch { return false; }
}

/** Write a manifest with the given targets (like init would) and return a fresh ctx. */
export function withManifest(root: string, targets: HarnessId[] = ['claude', 'codex', 'opencode'], extra: (m: ReturnType<typeof defaultManifest>) => void = () => {}): Ctx {
  const m = defaultManifest(targets, 'abcdef12');
  extra(m);
  let text = renderManifest(m);
  if (m.policy.symlinks !== 'auto') text = text.replace(/symlinks: auto/, `symlinks: ${m.policy.symlinks}`);
  fs.writeFileSync(path.join(root, 'agentunison.yaml'), text);
  return buildCtx(root);
}

export function planFor(root: string): { ctx: Ctx; plan: Plan; inv: Inventory } {
  const ctx = buildCtx(root);
  const { inv, plan } = pipeline(ctx);
  return { ctx, plan, inv };
}

export function applyAll(root: string, approve: 'all' | string[] = 'all'): ReturnType<typeof applyPlan> {
  const { ctx, plan } = planFor(root);
  const res = applyPlan(ctx, plan, { approve: approve === 'all' ? 'all' : new Set(approve), allowDelete: false, now: () => '2026-09-04T00:00:00.000Z' });
  // mirror cmdApply: persist approvals as decisions
  if (!res.refused && ctx.manifest && exists(root, 'agentunison.yaml')) {
    const decisions = { ...ctx.manifest.decisions };
    for (const a of res.executed) if (a.risk !== 'safe') decisions[a.id] = 'approve';
    if (Object.keys(decisions).length !== Object.keys(ctx.manifest.decisions).length) saveManifestDecisions(root, decisions);
  }
  return res;
}

export function verifyOk(root: string): { ok: boolean; issues: string[] } {
  const ctx = buildCtx(root);
  const r = verifyStructural(ctx, scanInventory(ctx));
  return { ok: r.ok, issues: r.issues.map((i) => `${i.code}:${i.path ?? ''}:${i.message}`) };
}

/** Stable hash of the whole tree (files + link targets), excluding .git and local journal timestamps. */
export function treeHash(root: string): string {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p);
      if (rel === '.git' || rel.startsWith(`.agentunison${path.sep}local${path.sep}journal`)) continue;
      if (e.isSymbolicLink()) out.push(`${rel} -> ${fs.readlinkSync(p)}`);
      else if (e.isDirectory()) { out.push(`${rel}/`); visit(p); }
      else out.push(`${rel} ${fs.readFileSync(p, 'utf8')}`);
    }
  };
  visit(root);
  return out.join('\n');
}

export const silentIO: CommandIO = { out: () => {}, err: () => {}, json: false, isTTY: false };
