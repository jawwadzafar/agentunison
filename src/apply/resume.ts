import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { Action, Ledger, LedgerEntry, MechanismUsed, Op, PathType, Precondition } from '../model/types.ts';
import { abs, pathType, readlink, removePath, writeFileSafe } from '../util/fs.ts';
import { sha256Path, sha256Text, sha256Tree } from '../util/hash.ts';
import { shimHash } from '../adapters/shim.ts';
import { saveLedger, saveLocalState } from '../model/manifest.ts';
import { stringifyStable } from '../util/yamlio.ts';
import { findIncompleteJournal, journalDir } from './journal.ts';

export interface ResumeOptions {
  approve: string[] | 'all';
  allowDelete: boolean;
  now?: () => string;
}

export interface ResumeResult {
  nothing?: true;
  error?: string;
  journal: string;
  completed: Set<string>;
  reversed: string[];
  unknown: string[];
  warnings: string[];
  skippedIds: Set<string>;
}

/**
 * Finish or roll back the single in-flight action of an incomplete journal, replay the
 * ledger effects of every `done` record in that journal (they were never persisted), and
 * return the set of action ids that the caller should skip when applying the continuation
 * plan.
 *
 * Algorithm (the in-flight record is the LAST `intent` entry; the journal is written
 * strictly sequentially, so a run that crashed after op k leaves at most one intent record):
 *   1. Per op type, classify `completed` | `not-started` | `partial` from the filesystem
 *      and the snapshotted action in the journal.
 *   2. `completed` → finish any remaining side effects (e.g. remove source for MOVE),
 *      mark the record `done`, replay its ledger effect.
 *   3. `partial` → reverse the partial effect (using the precondition's pre-image) when
 *      possible, otherwise leave the filesystem as-is and record the record as `unknown`.
 *   4. `not-started` → nothing to do on disk; record the record as `reversed`.
 *   5. Persist ledger + local state, append `{ status: 'resumed' }` to the journal.
 */
export function resumeApply(ctx: Ctx, opts: ResumeOptions): ResumeResult {
  const open = findIncompleteJournal(ctx.root);
  if (!open) return { nothing: true, journal: '', completed: new Set(), reversed: [], unknown: [], warnings: [], skippedIds: new Set() };
  const entries = open.entries;
  const ledger: Ledger = { version: 1, managed: [...ctx.ledger.managed] };
  const local: Record<string, MechanismUsed> = { ...(ctx.localMechanisms as Record<string, MechanismUsed>) };
  const completed = new Set<string>();
  const reversed: string[] = [];
  const unknown: string[] = [];
  const warnings: string[] = [];

  // Replay ledger effects for every `done` record first (in order) — their fs effects are
  // already present (kill happened after the done flush), only the ledger wasn't saved.
  for (const e of entries) {
    if (e['status'] !== 'done') continue;
    try { replayLedgerEffect(ctx, e, ledger, local, warnings); completed.add(String(e['id'])); }
    catch (err) { warnings.push(`replay ${e['id']}: ${(err as Error).message}`); }
  }
  // Resolve the in-flight intent record.
  const inFlight = entries.find((e) => e['status'] === 'intent');
  if (inFlight) {
    const id = String(inFlight['id']);
    const outcome = classifyAndResolve(ctx, inFlight, ledger, local, warnings);
    if (outcome === 'done') {
      inFlight['status'] = 'done';
      try { replayLedgerEffect(ctx, inFlight, ledger, local, warnings); completed.add(id); }
      catch (err) { warnings.push(`replay ${id}: ${(err as Error).message}`); unknown.push(id); }
    } else if (outcome === 'reversed') {
      inFlight['status'] = 'reversed';
      reversed.push(id);
    } else {
      inFlight['status'] = 'unknown';
      unknown.push(id);
    }
  }
  // Persist ledger + local state, then close the journal.
  saveLedger(ctx.root, ledger);
  saveLocalState(ctx.root, ctx.platform, local);
  const now = opts.now ?? (() => new Date().toISOString());
  const stamp = now().replace(/[:.]/g, '-');
  const newFile = path.join(journalDir(ctx.root), `${stamp}-resumed.yaml`);
  const closedEntries = entries.slice();
  closedEntries.push({ status: 'resumed', completed: [...completed], reversed, unknown, warnings });
  fs.writeFileSync(newFile, stringifyStable({ version: 1, entries: closedEntries }));
  // Remove the old incomplete journal so it cannot be rediscovered.
  try { fs.unlinkSync(open.file); } catch { /* */ }
  return { journal: path.relative(ctx.root, newFile), completed, reversed, unknown, warnings, skippedIds: completed };
}

type Outcome = 'done' | 'reversed' | 'unknown';

function asAction(e: { [k: string]: unknown }): Action {
  // The journal stores a JSON-serializable snapshot of Action. We re-hydrate the fields we use.
  return e as unknown as Action;
}

function findPre(e: { [k: string]: unknown }, p: string): Precondition | undefined {
  const pre = (e['preconditions'] as Precondition[] | undefined) ?? [];
  return pre.find((x) => x.path === p);
}

function expectPre(e: { [k: string]: unknown }, p: string): PathType | undefined {
  return findPre(e, p)?.expect;
}

function classifyAndResolve(ctx: Ctx, e: { [k: string]: unknown }, _ledger: Ledger, local: Record<string, MechanismUsed>, warnings: string[]): Outcome {
  const a = asAction(e);
  const op = a.op as Op;
  const t = abs(ctx.root, a.path);
  switch (op) {
    case 'MOVE': return resolveMove(ctx, e, a, t, warnings);
    case 'ADD':
    case 'GENERATE': return resolveAddOrGenerate(ctx, e, a, t, warnings);
    case 'MODIFY':
    case 'REPAIR': return resolveModify(ctx, e, a, t, warnings);
    case 'SYMLINK': return resolveSymlink(ctx, e, a, t, local, warnings);
    case 'COPY':
    case 'BACKPORT': return resolveCopy(ctx, e, a, t, warnings);
    case 'ADOPT': return resolveAdopt(ctx, e, a, t, warnings);
    case 'ADOPT-MANAGED': return resolveAdoptManaged(ctx, e, a, t, local, warnings);
    case 'QUARANTINE': return resolveQuarantine(ctx, e, a, t, warnings);
    case 'DELETE': return resolveDelete(ctx, e, a, t, warnings);
    case 'PRESERVE': return 'done';
  }
}

function safeRemove(p: string): void {
  const t = pathType(p);
  if (t === 'file' || t === 'symlink') { try { fs.unlinkSync(p); } catch { /* */ } }
  else if (t === 'dir') { try { fs.rmSync(p, { recursive: true, force: false }); } catch { /* */ } }
}

function resolveMove(ctx: Ctx, e: { [k: string]: unknown }, a: Action, dst: string, warnings: string[]): Outcome {
  const src = abs(ctx.root, a.source ?? '');
  const dstType = pathType(dst);
  const srcType = pathType(src);
  if (dstType === 'missing') {
    if (srcType === 'missing') { warnings.push(`${a.id}: MOVE not started and source is missing — left as-is`); return 'unknown'; }
    return 'reversed';
  }
  if (srcType === 'missing') return 'done';
  const hSrc = sha256Path(src); const hDst = sha256Path(dst);
  if (hSrc && hDst && hSrc === hDst) {
    try { removePath(src); } catch (err) { warnings.push(`${a.id}: could not finalize MOVE (remove ${a.source}): ${(err as Error).message}`); return 'unknown'; }
    return 'done';
  }
  // Partial copy with mismatching hashes — reverse.
  try { removePath(dst); } catch (err) { warnings.push(`${a.id}: partial MOVE left a divergent copy at ${a.path}; remove failed: ${(err as Error).message}`); return 'unknown'; }
  return 'reversed';
}

function resolveAddOrGenerate(ctx: Ctx, e: { [k: string]: unknown }, a: Action, target: string, warnings: string[]): Outcome {
  const t = pathType(target);
  if (t === 'missing') return 'reversed';
  if (a.kind === 'skills-root') return t === 'dir' ? 'done' : 'unknown';
  if (t === 'dir') return 'unknown';
  const expect = expectPre(e, a.path);
  const content = (e['content'] as string | undefined) ?? '';
  if (expect === 'missing' && content) {
    const want = shimHash(content) === sha256Path(target) || sha256Text(content) === sha256Path(target);
    if (!want) {
      const chk = sha256Path(target);
      if (chk !== sha256Text(content)) { warnings.push(`${a.id}: file exists at ${a.path} but its hash does not match the action's content (precondition expected missing); left as-is for human review`); return 'unknown'; }
    }
  }
  return 'done';
}

function resolveModify(ctx: Ctx, e: { [k: string]: unknown }, a: Action, target: string, warnings: string[]): Outcome {
  const t = pathType(target);
  if (t === 'missing') {
    const expect = expectPre(e, a.path);
    if (expect === 'file') { warnings.push(`${a.id}: MODIFY precondition expected a file at ${a.path} but it is missing; left as-is`); return 'unknown'; }
    return 'reversed';
  }
  if (t === 'dir') return 'unknown';
  const content = (e['content'] as string | undefined);
  if (content !== undefined) {
    const chk = sha256Path(target);
    if (chk !== sha256Text(content)) { warnings.push(`${a.id}: MODIFY target ${a.path} has unexpected content (cannot reconstruct the pre-image); left as-is`); return 'unknown'; }
  }
  return 'done';
}

function resolveSymlink(ctx: Ctx, e: { [k: string]: unknown }, a: Action, target: string, local: Record<string, MechanismUsed>, warnings: string[]): Outcome {
  const t = pathType(target);
  const want = a.target;
  if (t === 'symlink' && want && readlink(target) === want) {
    local[a.path] = (process.platform === 'win32' && path.isAbsolute(readlink(target) ?? '')) ? 'junction' : 'symlink';
    return 'done';
  }
  if (t === 'dir') {
    // symlink → junction/copy fallback already happened.
    warnings.push(`${a.id}: SYMLINK produced a directory (fallback); treated as completed. Verify ${a.path} is the right mechanism.`);
    local[a.path] = 'copy';
    return 'done';
  }
  if (t === 'missing') {
    const pre = findPre(e, a.path);
    if (!pre) return 'reversed';
    if (pre.expect === 'symlink' && pre.linkTarget) {
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(pre.linkTarget, target); local[a.path] = 'symlink'; return 'reversed'; }
      catch (err) { warnings.push(`${a.id}: could not restore old symlink at ${a.path}: ${(err as Error).message}`); return 'unknown'; }
    }
    if (pre.expect === 'dir') { try { fs.mkdirSync(target, { recursive: true }); return 'reversed'; } catch { return 'unknown'; } }
    return 'reversed';
  }
  // Unexpected: a file at the link path. Refuse to clobber.
  warnings.push(`${a.id}: SYMLINK target ${a.path} is a file (precondition was ${String(findPre(e, a.path)?.expect)}); left as-is`); return 'unknown';
}

function resolveCopy(ctx: Ctx, e: { [k: string]: unknown }, a: Action, dst: string, warnings: string[]): Outcome {
  const t = pathType(dst);
  if (t === 'missing') return 'reversed';
  const src = abs(ctx.root, a.source ?? '');
  if (pathType(src) === 'missing') { warnings.push(`${a.id}: COPY source ${a.source} missing; cannot verify`); return 'unknown'; }
  const hSrc = sha256Path(src); const hDst = sha256Path(dst);
  if (hSrc && hDst && hSrc === hDst) return 'done';
  try { removePath(dst); } catch (err) { warnings.push(`${a.id}: partial COPY at ${a.path} had unexpected content; remove failed: ${(err as Error).message}`); return 'unknown'; }
  return 'reversed';
}

function resolveAdopt(ctx: Ctx, e: { [k: string]: unknown }, a: Action, target: string, warnings: string[]): Outcome {
  const src = abs(ctx.root, a.source ?? '');
  const srcType = pathType(src);
  const targetSkill = path.join(target, 'SKILL.md');
  if (srcType === 'missing') return 'done'; // already quarantined
  // Source still here → ADOPT did not finish. Reverse by removing the (just-written) target.
  safeRemove(target);
  // Also clean the SKILL.md path used in the engine.
  safeRemove(targetSkill);
  return 'reversed';
}

function resolveAdoptManaged(ctx: Ctx, e: { [k: string]: unknown }, a: Action, target: string, local: Record<string, MechanismUsed>, warnings: string[]): Outcome {
  const mech = a.mechanism;
  if (mech === 'link') { local[a.path] = 'symlink'; return 'done'; } // ledger-only effect
  // shim adoption: symlink was unlinked, then content was written.
  const t = pathType(target);
  if (t === 'symlink') {
    const pre = findPre(e, a.path);
    if (pre?.expect === 'symlink' && pre.linkTarget) {
      try { writeFileSafe(target, ''); fs.unlinkSync(target); fs.symlinkSync(pre.linkTarget, target); return 'reversed'; } catch (err) { warnings.push(`${a.id}: could not restore symlink at ${a.path}: ${(err as Error).message}`); return 'unknown'; }
    }
    return 'reversed';
  }
  if (t === 'missing') {
    const pre = findPre(e, a.path);
    if (pre?.expect === 'symlink' && pre.linkTarget) {
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(pre.linkTarget, target); return 'reversed'; } catch (err) { warnings.push(`${a.id}: could not restore symlink at ${a.path}: ${(err as Error).message}`); return 'unknown'; }
    }
    if (pre?.expect === 'missing') return 'reversed';
    return 'unknown';
  }
  if (t === 'file') {
    const content = (e['content'] as string | undefined);
    if (content !== undefined) {
      if (sha256Path(target) !== sha256Text(content)) { warnings.push(`${a.id}: ADOPT-MANAGED target ${a.path} has unexpected content; left as-is`); return 'unknown'; }
    }
    return 'done';
  }
  return 'unknown';
}

function resolveQuarantine(ctx: Ctx, _e: { [k: string]: unknown }, a: Action, target: string, warnings: string[]): Outcome {
  const t = pathType(target);
  if (t === 'missing') return 'done';
  // Path still here — quarantine did not move it. Nothing to reverse.
  return 'reversed';
}

function resolveDelete(ctx: Ctx, _e: { [k: string]: unknown }, a: Action, target: string, warnings: string[]): Outcome {
  return pathType(target) === 'missing' ? 'done' : 'reversed';
}

function replayLedgerEffect(ctx: Ctx, e: { [k: string]: unknown }, ledger: Ledger, local: Record<string, MechanismUsed>, warnings: string[]): void {
  const a = asAction(e);
  const upsert = (ent: LedgerEntry) => { const i = ledger.managed.findIndex((x) => x.path === ent.path); if (i === -1) ledger.managed.push(ent); else ledger.managed[i] = ent; };
  const drop = (p: string) => { const i = ledger.managed.findIndex((x) => x.path === p); if (i !== -1) ledger.managed.splice(i, 1); delete local[p]; };
  switch (a.op) {
    case 'ADD': {
      if (a.kind === 'skills-root') return;
      if (a.mechanism === 'shim') upsert({ path: a.path, kind: 'instructions', mechanism: 'shim', ...(a.harness ? { harness: a.harness } : {}), sha256: shimHash(a.content ?? '') });
      else if (a.kind === 'instructions') recordBlockInReplay(ledger, a.path, a.content ?? '', ctx);
      return;
    }
    case 'MODIFY':
    case 'REPAIR': {
      if (a.mechanism === 'shim') upsert({ path: a.path, kind: 'instructions', mechanism: 'shim', ...(a.harness ? { harness: a.harness } : {}), sha256: shimHash(a.content ?? '') });
      if (a.mechanism === 'block' || a.id.endsWith(':block') || a.id.includes('merge-from')) recordBlockInReplay(ledger, a.path, a.content ?? '', ctx);
      return;
    }
    case 'ADOPT-MANAGED': {
      if (a.mechanism === 'link') { upsert({ path: a.path, kind: a.kind, mechanism: 'link', ...(a.harness ? { harness: a.harness } : {}), ...(a.target ? { target: a.target } : {}) }); local[a.path] = 'symlink'; return; }
      if (a.mechanism === 'shim') upsert({ path: a.path, kind: 'instructions', mechanism: 'shim', ...(a.harness ? { harness: a.harness } : {}), sha256: shimHash(a.content ?? '') });
      return;
    }
    case 'MOVE':
    case 'ADOPT': {
      if (a.kind === 'skill') upsert({ path: a.path, kind: 'skill', mechanism: 'adopted', origin: a.source! });
      return;
    }
    case 'QUARANTINE':
    case 'DELETE': {
      drop(a.path); return;
    }
    case 'SYMLINK': {
      upsert({ path: a.path, kind: a.kind, mechanism: 'link', ...(a.harness ? { harness: a.harness } : {}), target: a.target! });
      const tgt = readlink(abs(ctx.root, a.path));
      local[a.path] = (process.platform === 'win32' && tgt && path.isAbsolute(tgt)) ? 'junction' : 'symlink';
      return;
    }
    case 'COPY': {
      const t = abs(ctx.root, a.path);
      const h = sha256Tree(t);
      upsert({ path: a.path, kind: a.kind, mechanism: 'copy', ...(a.harness ? { harness: a.harness } : {}), source: a.source!, sha256: h });
      local[a.path] = 'copy';
      return;
    }
    case 'BACKPORT': {
      const e2 = ledger.managed.find((x) => x.path === a.source!);
      if (e2) e2.sha256 = sha256Tree(abs(ctx.root, a.source!));
      return;
    }
    case 'GENERATE': {
      const src = a.source ? sha256Path(abs(ctx.root, a.source)) : undefined;
      upsert({ path: a.path, kind: a.kind, mechanism: 'generated', ...(a.harness ? { harness: a.harness } : {}), ...(a.source ? { source: a.source } : {}), ...(src ? { sourceSha256: src } : {}), sha256: sha256Text(a.content ?? '') });
      return;
    }
    case 'PRESERVE': return;
  }
}

function recordBlockInReplay(ledger: Ledger, file: string, content: string, ctx: Ctx): void {
  const id = ctx.manifest?.id ?? '';
  const m = /<!-- agentunison:begin id=[a-f0-9]{8} -->[\s\S]*?<!-- agentunison:end -->/.exec(content.replace(/\r\n/g, '\n'));
  if (!m) return;
  const i = ledger.managed.findIndex((x) => x.path === file && x.mechanism === 'block');
  const e: LedgerEntry = { path: file, kind: 'instructions', mechanism: 'block', marker: id, sha256: sha256Text(m[0]) };
  if (i === -1) ledger.managed.push(e); else ledger.managed[i] = e;
}
