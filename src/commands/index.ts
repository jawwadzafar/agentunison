import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { Action, Finding, HarnessId, Inventory, Plan, VerifyReport, LedgerEntry } from '../model/types.ts';
import { HARNESS_IDS } from '../model/types.ts';
import { loadMatrix } from '../matrix/loader.ts';
import { probePlatform } from '../matrix/probe.ts';
import { defaultManifest, loadLedger, loadLocalState, loadManifest, saveLedger, saveManifestDecisions, saveLocalState, MANIFEST_FILE, LEDGER_FILE, LOCAL_DIR } from '../model/manifest.ts';
import { scanInventory } from '../inventory/scan.ts';
import { runAudit } from '../audit/rules.ts';
import { decideProjections } from '../policy/decide.ts';
import { buildPlan } from '../plan/build.ts';
import { applyPlan, type ApplyResult } from '../apply/engine.ts';
import { verifyStructural } from '../verify/structural.ts';
import { verifyLive, whichBinary, binaryVersion } from '../verify/live.ts';
import { abs, existsExact, findRepoRoot, pathType, readTextIfFile, writeFileSafe, removePath, copyTree, resolveLink } from '../util/fs.ts';
import { parseShim, removeBlock, HS_BEGIN, HS_END } from '../adapters/shim.ts';
import { generateOpenCodeAgent } from '../adapters/agents.ts';

export interface CommandIO { out: (s: string) => void; err: (s: string) => void; json: boolean; isTTY: boolean }

export function buildCtx(cwd: string): Ctx {
  const root = findRepoRoot(cwd);
  const matrix = loadMatrix();
  const manifest = loadManifest(root);
  const ledger = loadLedger(root);
  const local = loadLocalState(root);
  const platform = local?.platform && local.platform.os === process.platform ? local.platform : probePlatform(root);
  return { root, matrix, manifest, ledger, platform, localMechanisms: local?.mechanisms ?? {} };
}

export function detectTargets(ctx: Ctx, inv: Inventory): HarnessId[] {
  const set = new Set<HarnessId>(inv.harnessesDetected);
  for (const h of HARNESS_IDS) if (ctx.matrix[h].detect.binaries.some((b) => whichBinary(b))) set.add(h);
  const out = HARNESS_IDS.filter((h) => set.has(h) && !ctx.matrix[h].optIn);
  return out.length ? out : (['claude', 'codex', 'opencode'] as HarnessId[]);
}

/** Run the pure pipeline; optionally with a provisional manifest (init). */
export function pipeline(ctx: Ctx): { inv: Inventory; findings: Finding[]; plan: Plan } {
  const inv = scanInventory(ctx);
  const findings = runAudit(ctx, inv);
  const decisions = decideProjections(ctx, inv);
  const plan = buildPlan(ctx, inv, findings, decisions);
  addAgentAdapters(ctx, inv, plan);
  return { inv, findings, plan };
}

function addAgentAdapters(ctx: Ctx, inv: Inventory, plan: Plan): void {
  for (const spec of ctx.manifest?.adapters?.agents ?? []) {
    for (const to of spec.to) {
      if (to !== 'opencode') { plan.findings.push({ id: `ADAPTER:${spec.source}:${to}`, rule: 'ADAPTER', severity: 'medium', message: `agent adapter to ${to} is not supported (only opencode is, opt-in); ${spec.source} left native`, paths: [spec.source] }); continue; }
      const text = readTextIfFile(abs(ctx.root, spec.source));
      if (text === undefined) { plan.findings.push({ id: `ADAPTER:${spec.source}`, rule: 'ADAPTER', severity: 'medium', message: `adapter source ${spec.source} not found`, paths: [spec.source] }); continue; }
      const gen = generateOpenCodeAgent(spec.source, text, ctx.manifest!.id);
      if ('error' in gen) { plan.findings.push({ id: `ADAPTER:${spec.source}`, rule: 'ADAPTER', severity: 'medium', message: gen.error, paths: [spec.source] }); continue; }
      const target = `.opencode/agents/${gen.name}.md`;
      const existing = inv.items.find((i) => i.path === target);
      const led = ctx.ledger.managed.find((e) => e.path === target);
      if (existing && !led) { plan.actions.push({ id: `PRESERVE:${target}`, op: 'PRESERVE', risk: 'safe', kind: 'agent', path: target, reason: 'target exists and is not managed; refusing to overwrite a native agent', preconditions: [] }); continue; }
      const cur = readTextIfFile(abs(ctx.root, target));
      if (cur === gen.content) continue;
      plan.actions.push({ id: `GENERATE:${target}`, op: 'GENERATE', risk: 'safe', kind: 'agent', path: target, harness: 'opencode', source: spec.source, mechanism: 'generated', content: gen.content, reason: `generated from ${spec.source} (opt-in adapter); dropped fields: ${gen.dropped.join(', ') || 'none'}`, preconditions: [], degradation: gen.dropped.map((d) => `${d} has no OpenCode equivalent`) });
    }
  }
}

// ── formatting ──────────────────────────────────────────────────────────────────
export function formatInventory(inv: Inventory): string {
  const lines = [`Inventory of ${inv.root}`, `Harnesses detected: ${inv.harnessesDetected.join(', ') || 'none'}`, ''];
  const byCls = new Map<string, typeof inv.items>();
  for (const i of inv.items) byCls.set(i.cls, [...(byCls.get(i.cls) ?? []), i]);
  for (const cls of ['canonical', 'managed', 'unmanaged-compatible', 'native', 'legacy', 'vendored', 'foreign']) {
    const items = byCls.get(cls); if (!items?.length) continue;
    lines.push(`${cls} (${items.length})`);
    for (const i of items) lines.push(`  ${pad(i.type, 7)} ${i.path}${i.linkTarget ? ` -> ${i.linkTarget}` : ''}${i.harness && i.harness !== 'shared' ? `  [${i.harness}]` : ''}${i.lines ? `  ${i.lines}L` : ''}  (${i.evidence[0]})`);
  }
  for (const n of inv.notes) lines.push(`note: ${n}`);
  return lines.join('\n');
}

export function formatFindings(f: Finding[]): string {
  if (!f.length) return 'No findings.';
  const lines = [`${f.length} finding(s):`];
  for (const x of f) {
    lines.push(`  [${x.severity.toUpperCase().padEnd(6)}] ${x.rule} ${x.message}`);
    for (const q of x.questions ?? []) lines.push(`           ? ${q}`);
  }
  return lines.join('\n');
}

export function formatPlan(plan: Plan, opts: { diff?: boolean } = {}): string {
  if (!plan.actions.length) return 'Nothing to do.';
  const lines = [`Plan (${plan.actions.length} action(s); ${plan.pending.review} need approval, ${plan.pending.destructive} destructive):`];
  for (const a of plan.actions) {
    const flag = a.op === 'PRESERVE' ? '·' : a.preApproved ? '✓' : a.risk === 'safe' ? ' ' : a.risk === 'review' ? '?' : '!';
    lines.push(`  ${flag} ${a.op.padEnd(13)} ${a.path}${a.source ? `  ← ${a.source}` : ''}${a.target ? `  -> ${a.target}` : ''}`);
    lines.push(`                  ${a.reason}`);
    if (a.evidence?.length) lines.push(`                  evidence: ${a.evidence.join('; ')}`);
    for (const d of a.degradation ?? []) lines.push(`                  degradation: ${d}`);
    if (a.risk !== 'safe' && !a.preApproved) lines.push(`                  approve with: --approve "${a.id}"`);
    if (opts.diff && a.diff) lines.push(...a.diff.split('\n').map((l) => `      ${l}`));
  }
  return lines.join('\n');
}

export function formatVerify(r: VerifyReport): string {
  const lines = [`targets: ${r.summary.targets.join(', ')} · canonical: ${r.summary.canonical.instructions}, ${r.summary.canonical.skills} · managed paths: ${r.summary.managed}`];
  if (r.issues.length === 0) lines.push('structural: OK'); else for (const i of r.issues) lines.push(`structural: [${i.code}] ${i.path ? i.path + ': ' : ''}${i.message}${i.fix ? `  → ${i.fix}` : ''}`);
  for (const l of r.live ?? []) lines.push(`live: ${l.harness.padEnd(9)} ${l.status.padEnd(16)} ${l.detail}`);
  return lines.join('\n');
}

function pad(s: string, n: number): string { return s.padEnd(n); }

// ── commands ─────────────────────────────────────────────────────────────────────
export function cmdInspect(ctx: Ctx, io: CommandIO): number {
  const inv = scanInventory(ctx);
  io.out(io.json ? JSON.stringify(inv, null, 2) : formatInventory(inv));
  return 0;
}

export function cmdAudit(ctx: Ctx, io: CommandIO): number {
  const inv = scanInventory(ctx);
  const findings = runAudit(ctx, inv);
  io.out(io.json ? JSON.stringify({ schema: 1, findings }, null, 2) : formatFindings(findings));
  return findings.some((f) => f.severity === 'high' || f.severity === 'medium') ? 2 : 0;
}

export function cmdPlan(ctx: Ctx, io: CommandIO, opts: { diff: boolean }): number {
  if (!ctx.manifest) { io.err('No agentunison.yaml — run `agentunison init` first (it plans before writing).'); return 1; }
  const { plan } = pipeline(ctx);
  io.out(io.json ? JSON.stringify(plan, null, 2) : formatPlan(plan, { diff: opts.diff }));
  return plan.actions.some((a) => a.op !== 'PRESERVE') ? 2 : 0;
}

export function cmdApply(ctx: Ctx, io: CommandIO, opts: { approve: string[]; allowDelete: boolean; planFile?: string }): number {
  if (!ctx.manifest) { io.err('No agentunison.yaml — run `agentunison init` first.'); return 1; }
  let plan: Plan;
  if (opts.planFile) plan = JSON.parse(fs.readFileSync(opts.planFile, 'utf8')) as Plan;
  else plan = pipeline(ctx).plan;
  const approve = opts.approve.includes('all') ? 'all' : new Set(opts.approve);
  const res = applyPlan(ctx, plan, { approve, allowDelete: opts.allowDelete });
  if (res.refused) {
    io.err(`REFUSED: ${res.refused.action.id} — precondition on ${res.refused.precondition.path}: ${res.refused.actual}. Nothing was written. Re-run \`agentunison plan\`.`);
    return 7;
  }
  if (res.rolledBack) {
    io.err(`FAILED at ${res.rolledBack.failedAction}: ${res.rolledBack.error}. Rolled back ${res.rolledBack.restored.length} operation(s)${res.rolledBack.notRestored.length ? `; could NOT restore: ${res.rolledBack.notRestored.join('; ')}` : ''}. Journal: .agentunison/local/journal/`);
    return 1;
  }
  // record approvals as decisions so re-runs do not re-ask
  const decisions = { ...ctx.manifest.decisions };
  for (const a of res.executed) if (a.risk !== 'safe') decisions[a.id] = 'approve';
  if (Object.keys(decisions).length !== Object.keys(ctx.manifest.decisions).length && existsExact(abs(ctx.root, MANIFEST_FILE))) saveManifestDecisions(ctx.root, decisions);
  reportApply(res, io);
  return 0;
}

export function reportApply(res: ApplyResult, io: CommandIO): void {
  if (io.json) { io.out(JSON.stringify({ schema: 1, executed: res.executed.map((a) => a.id), skipped: res.skipped.map((s) => ({ id: s.action.id, reason: s.reason })), warnings: res.warnings, quarantineDir: res.quarantineDir }, null, 2)); return; }
  for (const a of res.executed) io.out(`  applied ${a.op.padEnd(13)} ${a.path}`);
  const pending = res.skipped.filter((s) => s.action.op !== 'PRESERVE');
  for (const s of pending) io.out(`  pending ${s.action.op.padEnd(13)} ${s.action.path}  (${s.reason}; --approve "${s.action.id}")`);
  for (const w of res.warnings) io.out(`  WARNING ${w}`);
  if (res.quarantineDir) io.out(`  quarantine: ${res.quarantineDir} (kept until you delete it; MANIFEST.yaml lists every item)`);
  io.out(`${res.executed.length} applied, ${pending.length} pending approval.`);
}

export function cmdVerify(ctx: Ctx, io: CommandIO, opts: { live: boolean; allowApiCalls: boolean }): number {
  const inv = scanInventory(ctx);
  const report = verifyStructural(ctx, inv);
  if (opts.live) report.live = verifyLive(ctx, { allowApiCalls: opts.allowApiCalls });
  io.out(io.json ? JSON.stringify(report, null, 2) : formatVerify(report));
  const liveFailed = (report.live ?? []).some((l) => l.status === 'failed');
  return report.ok && !liveFailed ? 0 : 4;
}

export function cmdDoctor(ctx: Ctx, io: CommandIO): number {
  const rows: Array<Record<string, unknown>> = [];
  for (const h of HARNESS_IDS) {
    const m = ctx.matrix[h];
    const bin = m.detect.binaries.map((b) => ({ b, p: whichBinary(b) })).find((x) => x.p);
    const version = bin ? binaryVersion(bin.b, m.detect.versionArgs ?? ['--version']) : undefined;
    const newer = version && m.versionsVerified.length ? !m.versionsVerified.some((v) => version.includes(v)) : undefined;
    rows.push({ harness: h, installed: !!bin, binary: bin?.p, version, verifiedOn: m.versionsVerified, warning: newer ? 'installed version differs from the versions the matrix was verified on — re-verify facts' : undefined, target: ctx.manifest?.targets.includes(h) ?? false, optIn: m.optIn ?? false });
  }
  const env = { root: ctx.root, platform: ctx.platform, manifest: !!ctx.manifest, ledgerEntries: ctx.ledger.managed.length, node: process.version };
  if (io.json) { io.out(JSON.stringify({ schema: 1, env, harnesses: rows }, null, 2)); return 0; }
  io.out(`repo: ${env.root}\nplatform: ${ctx.platform.os} (${ctx.platform.family}) symlinks=${ctx.platform.symlinks} junctions=${ctx.platform.junctions} caseSensitive=${ctx.platform.caseSensitive}\nmanifest: ${env.manifest ? 'present' : 'absent'} · ledger entries: ${env.ledgerEntries} · node ${env.node}`);
  for (const r of rows) io.out(`  ${String(r['harness']).padEnd(9)} ${r['installed'] ? 'installed' : 'absent   '} ${String(r['version'] ?? '').padEnd(28)} ${r['target'] ? 'target' : r['optIn'] ? 'opt-in' : ''}${r['warning'] ? `  ⚠ ${r['warning']}` : ''}`);
  return 0;
}

export function cmdInit(ctx: Ctx, io: CommandIO, opts: { targets?: HarnessId[]; approve: string[]; yes: boolean; allowDelete: boolean }): number {
  if (ctx.manifest) { io.out('agentunison.yaml already exists — running plan + apply.'); return cmdApply(ctx, io, { approve: opts.approve, allowDelete: opts.allowDelete }); }
  const inv0 = scanInventory(ctx);
  const targets = opts.targets ?? detectTargets(ctx, inv0);
  const manifest = defaultManifest(targets);
  const ctx2: Ctx = { ...ctx, manifest };
  const { inv, findings, plan } = pipeline(ctx2);
  const existingSetup = inv.items.some((i) => i.cls !== 'managed' && i.kind !== 'manifest');
  io.out(`targets: ${targets.join(', ')}${opts.targets ? '' : ' (detected; pass --targets to change)'}`);
  if (findings.length) io.out(formatFindings(findings));
  io.out(formatPlan(plan));
  const approve: string[] = [...opts.approve];
  if (existingSetup && plan.pending.review > 0 && !approve.includes('all')) {
    if (io.isTTY && !opts.yes) {
      io.out('\nThis repository already has an agent setup. Actions marked "?" change or move existing files and need approval.');
      io.out('Re-run with --approve all (or --approve "<id>,…") to apply them; safe actions are applied now.');
    } else {
      io.out('\nExisting setup detected: only safe actions are applied. Approve the rest with: agentunison apply --approve all');
    }
  }
  // the plan itself carries ADD agentunison.yaml (intent record) as its first safe action
  const res = applyPlan(ctx2, plan, { approve: approve.includes('all') ? 'all' : new Set(approve), allowDelete: opts.allowDelete });
  if (res.refused) { io.err(`REFUSED: ${res.refused.action.id}: ${res.refused.actual}`); return 7; }
  const decisions: Record<string, string> = {};
  for (const a of res.executed) if (a.risk !== 'safe') decisions[a.id] = 'approve';
  if (Object.keys(decisions).length) saveManifestDecisions(ctx.root, decisions);
  reportApply(res, io);
  const ctx3 = buildCtx(ctx.root);
  const report = verifyStructural(ctx3, scanInventory(ctx3));
  io.out(formatVerify(report));
  return report.ok ? 0 : 4;
}

export function cmdUninstall(ctx: Ctx, io: CommandIO, opts: { keepLinks: boolean }): number {
  if (!ctx.manifest && ctx.ledger.managed.length === 0) { io.out('Nothing managed by AgentUnison here.'); return 0; }
  const canonSkills = ctx.manifest?.canonical.skills ?? '.agents/skills';
  const done: string[] = [];
  const kept: string[] = [];
  const entries: LedgerEntry[] = [...ctx.ledger.managed].sort((a, b) => (a.path < b.path ? 1 : -1));
  for (const e of entries) {
    const a = abs(ctx.root, e.path);
    switch (e.mechanism) {
      case 'shim': {
        const text = readTextIfFile(a); if (text === undefined) break;
        const ps = parseShim(text);
        if (ps.harnessSpecific && ps.harnessSpecific.trim()) {
          writeFileSafe(a, `${ps.importLine ?? ''}\n\n${ps.harnessSpecific.trim()}\n`.replace(HS_BEGIN, '').replace(HS_END, ''));
          kept.push(`${e.path}: unmanaged (import line + your harness-specific text kept)`);
        } else { writeFileSafe(a, `${ps.importLine ?? '@AGENTS.md'}\n`); kept.push(`${e.path}: reduced to the bare import line (still works; delete it if unwanted)`); }
        break;
      }
      case 'link': {
        if (pathType(a) !== 'symlink') break;
        if (opts.keepLinks) { kept.push(`${e.path}: link kept (unmanaged)`); break; }
        const r = resolveLink(a);
        removePath(a);
        if (r.kind === 'ok') { copyTree(r.realpath, a); done.push(`${e.path}: link replaced by a real copy so the harness keeps working`); }
        break;
      }
      case 'copy': kept.push(`${e.path}: managed copy left in place (now unmanaged)`); break;
      case 'generated': removePath(a); done.push(`${e.path}: generated adapter removed (source ${e.source} untouched)`); break;
      case 'adopted': kept.push(`${e.path}: adopted skill kept (canonical content is never removed)`); break;
      case 'block': {
        const text = readTextIfFile(a); if (text === undefined) break;
        writeFileSafe(a, removeBlock(text)); done.push(`${e.path}: managed block removed`);
        break;
      }
    }
  }
  removePath(abs(ctx.root, LEDGER_FILE));
  removePath(abs(ctx.root, MANIFEST_FILE));
  const localState = abs(ctx.root, `${LOCAL_DIR}/state.yaml`); removePath(localState);
  try { if (fs.readdirSync(abs(ctx.root, '.agentunison')).length === 0) fs.rmdirSync(abs(ctx.root, '.agentunison')); } catch { /* keep */ }
  for (const d of done) io.out(`  ${d}`);
  for (const k of kept) io.out(`  ${k}`);
  const q = abs(ctx.root, `${LOCAL_DIR}/quarantine`);
  if (pathType(q) === 'dir') io.out(`  quarantine kept at ${LOCAL_DIR}/quarantine (restore anything you need from there; MANIFEST.yaml per run)`);
  io.out(`Uninstalled. Canonical content (${ctx.manifest?.canonical.instructions ?? 'AGENTS.md'}, ${canonSkills}) untouched.`);
  return 0;
}

export { saveLedger, saveLocalState, path };
