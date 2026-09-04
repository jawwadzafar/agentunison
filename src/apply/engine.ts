import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { Action, Ledger, LedgerEntry, MechanismUsed, Plan, Precondition } from '../model/types.ts';
import { abs, copyTree, existsExact, isInside, makeSymlink, pathType, readlink, readTextIfFile, removePath, resolveLink, writeFileSafe, fsyncFile } from '../util/fs.ts';
import { sha256Path, sha256Text, sha256Tree } from '../util/hash.ts';
import { ensureLocalDir, saveLedger, saveLocalState, LOCAL_DIR } from '../model/manifest.ts';
import { shimHash } from '../adapters/shim.ts';
import { stringifyStable } from '../util/yamlio.ts';

export interface ApplyOptions {
  approve: Set<string> | 'all';
  allowDelete: boolean;
  now?: () => string;              // injectable clock for tests
}

export interface ApplyResult {
  executed: Action[];
  skipped: Array<{ action: Action; reason: string }>;
  refused?: { action: Action; precondition: Precondition; actual: string };
  warnings: string[];
  quarantineDir?: string;
  rolledBack?: { failedAction: string; error: string; restored: string[]; notRestored: string[] };
}

/**
 * The single writer. Two phases: (1) every selected action's preconditions are re-checked
 * against the filesystem; any mismatch refuses the whole run. (2) actions execute in plan
 * order with a write-ahead journal; every managed result is recorded in the ledger.
 */
export function applyPlan(ctx: Ctx, plan: Plan, opts: ApplyOptions): ApplyResult {
  const selected: Action[] = [];
  const skipped: ApplyResult['skipped'] = [];
  for (const a of plan.actions) {
    if (a.op === 'PRESERVE') { skipped.push({ action: a, reason: 'preserve (no change)' }); continue; }
    const approved = opts.approve === 'all' || opts.approve.has(a.id) || a.preApproved === true;
    if (a.risk === 'destructive' && !(approved && opts.allowDelete)) { skipped.push({ action: a, reason: 'destructive: needs --approve and --allow-delete' }); continue; }
    if (a.risk === 'review' && !approved) { skipped.push({ action: a, reason: 'needs approval (--approve <id>|all)' }); continue; }
    if (a.op === 'REPAIR' && a.content === undefined) { skipped.push({ action: a, reason: 'manual fix required' }); continue; }
    selected.push(a);
  }
  // dependent actions (links/copies onto skills that a MOVE/ADOPT/QUARANTINE creates or clears)
  // run only when every prerequisite is selected too; plan order already puts prerequisites first
  const selIds = new Set(selected.map((s) => s.id));
  for (const a of [...selected]) {
    if (a.dependsOn?.some((id) => !selIds.has(id))) { selected.splice(selected.indexOf(a), 1); skipped.push({ action: a, reason: `prerequisite not approved: ${a.dependsOn.filter((id) => !selIds.has(id)).join(', ')}` }); }
  }

  // Phase 1 — preconditions
  for (const a of selected) {
    for (const p of a.preconditions) {
      const actual = describeNow(ctx.root, p.path);
      if (actual.type !== p.expect) return refused(a, p, `expected ${p.expect}, found ${actual.type}`, skipped);
      if (p.sha256 && actual.sha256 !== p.sha256) return refused(a, p, `content changed since plan (hash ${actual.sha256?.slice(0, 8)} ≠ ${p.sha256.slice(0, 8)})`, skipped);
      if (p.linkTarget && actual.linkTarget !== p.linkTarget) return refused(a, p, `link target changed since plan`, skipped);
    }
  }

  // Phase 2 — execute with write-ahead journal
  const now = opts.now ?? (() => new Date().toISOString());
  const stamp = now().replace(/[:.]/g, '-');
  ensureLocalDir(ctx.root);
  const journalPath = path.join(ctx.root, LOCAL_DIR, 'journal', `${stamp}.yaml`);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const journal: Array<Record<string, unknown>> = [];
  const flush = () => { fs.writeFileSync(journalPath, stringifyStable({ version: 1, entries: journal })); try { fs.fsyncSync(fs.openSync(journalPath, 'r')); } catch { /* best effort */ } };
  void fsyncFile;

  const ledger: Ledger = { version: 1, managed: [...ctx.ledger.managed] };
  const local: Record<string, MechanismUsed> = { ...(ctx.localMechanisms as Record<string, MechanismUsed>) };
  const executed: Action[] = [];
  const warnings: string[] = [];
  let quarantineDir: string | undefined;
  const upsert = (e: LedgerEntry) => { const i = ledger.managed.findIndex((x) => x.path === e.path); if (i === -1) ledger.managed.push(e); else ledger.managed[i] = e; };
  const drop = (p: string) => { const i = ledger.managed.findIndex((x) => x.path === p); if (i !== -1) ledger.managed.splice(i, 1); delete local[p]; };
  const quarantine = (relPath: string, reason: string) => {
    if (!quarantineDir) quarantineDir = path.join(LOCAL_DIR, 'quarantine', stamp);
    const neutral = relPath.split('/').map((seg) => (seg.startsWith('.') ? `_dot_${seg.slice(1)}` : seg)).join('/');
    const dst = abs(ctx.root, `${quarantineDir}/${neutral}`);
    const src = abs(ctx.root, relPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const t = pathType(src);
    const entry: Record<string, unknown> = { from: relPath, to: `${quarantineDir}/${neutral}`, reason, type: t };
    if (t === 'symlink') { entry['linkTarget'] = readlink(src); fs.writeFileSync(`${dst}.link`, `${readlink(src) ?? ''}\n`); fs.unlinkSync(src); }
    else { entry['sha256'] = sha256Path(src); fs.renameSync(src, dst); }
    // tidy: remove now-empty parent directories up to (not including) the harness surface root
    let parent = path.dirname(src);
    while (isInside(ctx.root, parent) && parent !== ctx.root && relDepth(ctx.root, parent) > 2) {
      try { if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); else break; } catch { break; }
      parent = path.dirname(parent);
    }
    const manifestPath = abs(ctx.root, `${quarantineDir}/MANIFEST.yaml`);
    const existing = readTextIfFile(manifestPath);
    const list = existing ? ((JSON.parse(JSON.stringify(require_yaml(existing))) as { entries?: unknown[] }).entries ?? []) : [];
    fs.writeFileSync(manifestPath, stringifyStable({ version: 1, createdAt: stamp, entries: [...list, entry] }));
    drop(relPath);
  };

  // undo log: enough to reverse each completed op if a later one throws
  type Undo = { id: string; steps: Array<() => void>; desc: string };
  const undos: Undo[] = [];
  const snapshotFile = (relPath: string): (() => void) => {
    const a = abs(ctx.root, relPath);
    const t = pathType(a);
    if (t === 'file') { const prev = fs.readFileSync(a); return () => { fs.writeFileSync(a, prev); }; }
    if (t === 'symlink') { const l = fs.readlinkSync(a); return () => { try { removePath(a); } catch { /* */ } fs.symlinkSync(l, a); }; }
    if (t === 'missing') return () => { removePath(a); };
    return () => { /* directories are not snapshotted */ };
  };
  try {
  for (const a of selected) {
    const rec: Record<string, unknown> = { id: a.id, op: a.op, path: a.path, source: a.source, status: 'intent' };
    journal.push(rec); flush();
    const target = abs(ctx.root, a.path);
    const undo: Undo = { id: a.id, steps: [], desc: `${a.op} ${a.path}` };
    if (['ADD', 'MODIFY', 'REPAIR', 'ADOPT-MANAGED', 'SYMLINK', 'COPY', 'GENERATE', 'BACKPORT'].includes(a.op)) undo.steps.push(snapshotFile(a.path));
    if (a.op === 'MOVE') { const src = abs(ctx.root, a.source!); undo.steps.push(() => { if (pathType(target) !== 'missing' && pathType(src) === 'missing') fs.renameSync(target, src); }); }
    if (a.op === 'ADOPT') { undo.steps.push(() => { removePath(target); }); }
    undos.push(undo);
    if (pathType(target) === 'symlink' && !['SYMLINK', 'QUARANTINE', 'ADOPT-MANAGED'].includes(a.op)) throw new Error(`refusing to write through symlink ${a.path}`);
    switch (a.op) {
      case 'ADD': {
        if (a.kind === 'skills-root') { fs.mkdirSync(target, { recursive: true }); if (fs.readdirSync(target).length === 0) fs.writeFileSync(path.join(target, '.gitkeep'), ''); break; }
        writeFileSafe(target, a.content ?? '');
        if (a.mechanism === 'shim') upsert({ path: a.path, kind: 'instructions', mechanism: 'shim', ...(a.harness ? { harness: a.harness } : {}), sha256: shimHash(a.content ?? '') });
        else if (a.kind === 'instructions') recordBlock(ledger, a.path, a.content ?? '', ctx);
        break;
      }
      case 'MODIFY':
      case 'REPAIR': {
        writeFileSafe(target, a.content ?? '');
        if (a.mechanism === 'shim') upsert({ path: a.path, kind: 'instructions', mechanism: 'shim', ...(a.harness ? { harness: a.harness } : {}), sha256: shimHash(a.content ?? '') });
        if (a.mechanism === 'block' || a.id.endsWith(':block') || a.id.includes('merge-from')) recordBlock(ledger, a.path, a.content ?? '', ctx);
        break;
      }
      case 'ADOPT-MANAGED': {
        if (a.mechanism === 'link') { upsert({ path: a.path, kind: a.kind, mechanism: 'link', ...(a.harness ? { harness: a.harness } : {}), ...(a.target ? { target: a.target } : {}) }); local[a.path] = 'symlink'; break; }
        // shim adoption or symlinked canonical → regular file
        if (pathType(target) === 'symlink') fs.unlinkSync(target);
        writeFileSafe(target, a.content ?? '');
        if (a.mechanism === 'shim') upsert({ path: a.path, kind: 'instructions', mechanism: 'shim', ...(a.harness ? { harness: a.harness } : {}), sha256: shimHash(a.content ?? '') });
        break;
      }
      case 'MOVE': {
        const src = abs(ctx.root, a.source!);
        assertDistinct(src, target);
        landThenRemove(src, target);
        if (a.kind === 'skill') upsert({ path: a.path, kind: 'skill', mechanism: 'adopted', origin: a.source! });
        break;
      }
      case 'ADOPT': {
        writeFileSafe(target.endsWith('SKILL.md') ? target : path.join(target, 'SKILL.md'), a.content ?? '');
        upsert({ path: a.path, kind: 'skill', mechanism: 'adopted', origin: a.source! });
        quarantine(a.source!, `adopted as skill ${a.path}`);
        break;
      }
      case 'QUARANTINE': {
        quarantine(a.path, a.reason);
        break;
      }
      case 'SYMLINK': {
        const t = pathType(target);
        if (t === 'dir' && fs.readdirSync(target).length > 0) throw new Error(`refusing to replace non-empty directory ${a.path} with a link`);
        if (t === 'dir') fs.rmdirSync(target);
        if (t === 'file') throw new Error(`refusing to replace file ${a.path} with a link`);
        if (t === 'symlink') fs.unlinkSync(target);
        const resolvedTarget = path.resolve(path.dirname(target), a.target!);
        if (!isInside(ctx.root, resolvedTarget)) throw new Error(`link target escapes repository: ${a.target}`);
        const chk = resolveLink(resolvedTarget);
        if (chk.kind === 'cycle') throw new Error(`link target would create a cycle: ${a.target}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        let used: MechanismUsed;
        try {
          used = makeSymlink(target, a.target!, a.kind === 'skill' || a.kind === 'skills-root' ? 'dir' : 'file');
        } catch (e) {
          // loud fallback: copy, recorded as such
          copyTree(resolvedTarget, target);
          used = 'copy';
          warnings.push(`${a.path}: symlink failed (${(e as Error).message.split('\n')[0]}); a COPY was made instead and recorded locally — do not commit this directory as content`);
        }
        if (used === 'junction') warnings.push(`${a.path}: created as a junction (absolute target) — machine-local; do not commit. Suggested: git update-index --skip-worktree ${a.path}`);
        upsert({ path: a.path, kind: a.kind, mechanism: 'link', ...(a.harness ? { harness: a.harness } : {}), target: a.target! });
        local[a.path] = used;
        break;
      }
      case 'COPY': {
        const src = abs(ctx.root, a.source!);
        assertDistinct(src, target);
        if (pathType(target) !== 'missing') removePath(target);
        copyTree(src, target);
        upsert({ path: a.path, kind: a.kind, mechanism: 'copy', ...(a.harness ? { harness: a.harness } : {}), source: a.source!, sha256: sha256Tree(target) });
        local[a.path] = 'copy';
        break;
      }
      case 'BACKPORT': {
        const src = abs(ctx.root, a.source!);
        assertDistinct(src, target);
        removePath(target);
        copyTree(src, target);
        const e = ledger.managed.find((x) => x.path === a.source!);
        if (e) e.sha256 = sha256Tree(src);
        break;
      }
      case 'GENERATE': {
        writeFileSafe(target, a.content ?? '');
        const srcHash = a.source ? sha256Path(abs(ctx.root, a.source)) : undefined;
        upsert({ path: a.path, kind: a.kind, mechanism: 'generated', ...(a.harness ? { harness: a.harness } : {}), ...(a.source ? { source: a.source } : {}), ...(srcHash ? { sourceSha256: srcHash } : {}), sha256: sha256Text(a.content ?? '') });
        break;
      }
      case 'DELETE': {
        removePath(target);
        drop(a.path);
        break;
      }
      case 'PRESERVE':
        break;
    }
    rec['status'] = 'done'; flush();
    executed.push(a);
  }
  } catch (e) {
    // reverse completed ops (last first); quarantined items are restored from the quarantine dir
    const restored: string[] = [], notRestored: string[] = [];
    for (const u of [...undos].reverse()) {
      try { for (const step of u.steps) step(); restored.push(u.desc); } catch (err) { notRestored.push(`${u.desc}: ${(err as Error).message}`); }
    }
    if (quarantineDir) {
      const manifestPath = abs(ctx.root, `${quarantineDir}/MANIFEST.yaml`);
      const q = readTextIfFile(manifestPath);
      if (q) for (const ent of ((require_yaml(q) as { entries?: Array<Record<string, string>> }).entries ?? []).reverse()) {
        try {
          const from = abs(ctx.root, ent['from']!), to = abs(ctx.root, ent['to']!);
          if (ent['type'] === 'symlink') { if (pathType(from) === 'missing') fs.symlinkSync(ent['linkTarget'] ?? '', from); }
          else if (pathType(from) === 'missing' && pathType(to) !== 'missing') { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); }
          restored.push(`QUARANTINE ${ent['from']}`);
        } catch (err) { notRestored.push(`QUARANTINE ${ent['from']}: ${(err as Error).message}`); }
      }
    }
    journal.push({ status: 'rolled-back', error: (e as Error).message, restored, notRestored }); flush();
    return { executed: [], skipped, warnings, rolledBack: { failedAction: undos[undos.length - 1]?.id ?? '?', error: (e as Error).message, restored, notRestored } };
  }

  saveLedger(ctx.root, ledger);
  saveLocalState(ctx.root, ctx.platform, local);
  const res: ApplyResult = { executed, skipped, warnings };
  if (quarantineDir) res.quarantineDir = quarantineDir;
  return res;
}

function relDepth(root: string, p: string): number { return path.relative(root, p).split(path.sep).filter(Boolean).length; }

function refused(action: Action, precondition: Precondition, actual: string, skipped: ApplyResult['skipped']): ApplyResult {
  return { executed: [], skipped, refused: { action, precondition, actual }, warnings: [] };
}

function describeNow(root: string, relPath: string): { type: string; sha256?: string; linkTarget?: string } {
  const a = abs(root, relPath);
  const type = pathType(a);
  if (type === 'missing') return { type };
  const out: { type: string; sha256?: string; linkTarget?: string } = { type };
  const h = sha256Path(a); if (h) out.sha256 = h;
  if (type === 'symlink') { const l = readlink(a); if (l) out.linkTarget = l; }
  return out;
}

function assertDistinct(src: string, dst: string): void {
  const rs = resolveLink(src), rd = resolveLink(dst);
  if (rs.kind === 'ok' && rd.kind === 'ok' && rs.realpath === rd.realpath) throw new Error(`source and destination resolve to the same file: ${src}`);
  if (!existsExact(src)) throw new Error(`source missing: ${src}`);
}

/** MOVE = copy → re-read/hash → remove source (never a bare rename across a symlink). */
function landThenRemove(src: string, dst: string): void {
  if (pathType(dst) !== 'missing') throw new Error(`destination exists: ${dst}`);
  const before = sha256Path(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (pathType(src) === 'dir') copyTree(src, dst); else fs.copyFileSync(src, dst);
  const after = sha256Path(dst);
  if (before !== after) { removePath(dst); throw new Error(`copy verification failed for ${src}`); }
  removePath(src);
}

function recordBlock(ledger: Ledger, file: string, content: string, ctx: Ctx): void {
  const id = ctx.manifest?.id ?? '';
  const m = /<!-- agentunison:begin id=[a-f0-9]{8} -->[\s\S]*?<!-- agentunison:end -->/.exec(content.replace(/\r\n/g, '\n'));
  if (!m) return;
  const i = ledger.managed.findIndex((x) => x.path === file && x.mechanism === 'block');
  const e: LedgerEntry = { path: file, kind: 'instructions', mechanism: 'block', marker: id, sha256: sha256Text(m[0]) };
  if (i === -1) ledger.managed.push(e); else ledger.managed[i] = e;
}

// tiny local YAML reader for the quarantine manifest (avoids importing yaml here twice)
import YAML from 'yaml';
function require_yaml(text: string): unknown { return YAML.parse(text); }
