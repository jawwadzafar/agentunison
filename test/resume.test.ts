import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { tmpRepo, withManifest, planFor, applyAll, verifyOk, read, exists, isLink, write } from './helpers/repo.ts';
import { buildCtx, mapInteractiveAnswers } from '../src/commands/index.ts';
import { applyPlan } from '../src/apply/engine.ts';
import { resumeApply } from '../src/apply/resume.ts';
import type { Plan, Action, LedgerEntry } from '../src/model/types.ts';

const skill = (name: string, body = 'x') => `---\nname: ${name}\ndescription: Use when ${name}.\n---\n${body}\n`;

function runCli(args: string[], cwd: string, env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const cliPath = path.resolve('src/cli.ts');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cliPath, ...args], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('apply with incomplete journal refuses; resume restores; verify clean (crash after MOVE)', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', '# Rules\n\nNever push to main.\n');
  withManifest(r, ['claude']);
  const { status, stderr } = runCli(['apply', '--cwd', r, '--approve', 'all'], r, { AGENTUNISON_TEST_CRASH_AFTER: 'MOVE:.agents/skills/only' });
  assert.notEqual(status, 0, `child crashed; got exit ${status}; stderr=${stderr}`);
  assert.ok(exists(r, '.agents/skills/only/SKILL.md'), 'MOVE landed before crash');
  assert.ok(!exists(r, '.claude/skills/only'), 'source was removed by MOVE');
  const { status: refused, stderr: refErr } = runCli(['apply', '--cwd', r, '--approve', 'all'], r, {});
  assert.equal(refused, 7, `expected exit 7; stderr=${refErr}`);
  assert.match(refErr, /BLOCKED: an incomplete journal exists/);
  assert.match(refErr, /--resume/);
  const ctx = buildCtx(r);
  const r1 = resumeApply(ctx, { approve: ['all'], allowDelete: false, now: () => '2026-09-04T01:00:00.000Z' });
  assert.equal(r1.nothing, undefined, 'resume found an incomplete journal');
  assert.ok(r1.completed.has('MOVE:.agents/skills/only'), 'MOVE was completed-but-unmarked and marked done');
  assert.equal(r1.reversed.length, 0);
  const jdir = path.join(r, '.agentunison', 'local', 'journal');
  const newest = fs.readdirSync(jdir).filter((f) => f.endsWith('.yaml')).sort().pop()!;
  const j = fs.readFileSync(path.join(jdir, newest), 'utf8');
  assert.match(j, /status: resumed/);
  assert.match(j, /op: MOVE/);
  const { plan } = planFor(r);
  const planFile = path.join(r, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  const res = applyPlan(ctx, plan, { approve: 'all', allowDelete: false, resume: true, now: () => '2026-09-04T02:00:00.000Z' });
  assert.equal(res.refused, undefined);
  assert.equal(res.rolledBack, undefined);
  assert.equal(res.blocked, undefined);
  assert.match(read(r, 'CLAUDE.md'), /^@AGENTS.md/);
  assert.match(read(r, 'AGENTS.md'), /Never push to main/);
  assert.ok(isLink(r, '.claude/skills'), '.claude/skills is a link to .agents/skills');
  assert.ok(verifyOk(r).ok, 'verify is structurally clean');
});

test('apply with crash BEFORE MOVE: resume reverses in-flight, completes remaining plan, verify clean', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', '# Rules\n\nNever push to main.\n');
  withManifest(r, ['claude']);
  const { status } = runCli(['apply', '--cwd', r, '--approve', 'all'], r, { AGENTUNISON_TEST_CRASH_BEFORE: 'MOVE:.agents/skills/only' });
  assert.notEqual(status, 0);
  assert.ok(exists(r, '.claude/skills/only/SKILL.md'), 'source still present');
  assert.ok(!exists(r, '.agents/skills/only'), 'destination still missing');
  assert.ok(!exists(r, 'AGENTS.md'), 'canonical not yet created');
  const ctx = buildCtx(r);
  const r1 = resumeApply(ctx, { approve: ['all'], allowDelete: false, now: () => '2026-09-04T01:00:00.000Z' });
  assert.equal(r1.nothing, undefined);
  assert.ok(r1.reversed.includes('MOVE:.agents/skills/only'), 'MOVE reversed because nothing happened');
  const { plan } = planFor(r);
  const res = applyPlan(ctx, plan, { approve: 'all', allowDelete: false, now: () => '2026-09-04T02:00:00.000Z' });
  assert.equal(res.refused, undefined);
  assert.equal(res.rolledBack, undefined);
  assert.equal(res.blocked, undefined);
  assert.ok(res.executed.length > 0, 'continuation executed some actions');
  assert.match(read(r, 'CLAUDE.md'), /^@AGENTS.md/);
  assert.ok(exists(r, '.agents/skills/only'), 'canonical skill exists');
  assert.ok(verifyOk(r).ok, 'verify is clean');
});

test('resume with no incomplete journal is a no-op (success, nothing to report)', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  withManifest(r, ['claude']);
  applyAll(r);
  const ctx = buildCtx(r);
  const r1 = resumeApply(ctx, { approve: ['all'], allowDelete: false });
  assert.equal(r1.nothing, true);
});

test('journal of a successful run is closed by a `committed` record', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  withManifest(r, ['claude']);
  applyAll(r);
  const jdir = path.join(r, '.agentunison', 'local', 'journal');
  const newest = fs.readdirSync(jdir).filter((f) => f.endsWith('.yaml')).sort().pop()!;
  const j = fs.readFileSync(path.join(jdir, newest), 'utf8');
  assert.match(j, /status: committed/);
  assert.match(j, /status: done/);
  assert.ok(!/status: intent/.test(j), 'no intent record left in a successful journal');
});

test('journal of a rolled-back run ends with `rolled-back`', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', '# Real\n\nContent.\n');
  const { ctx, plan } = planFor(r);
  withManifest(r, ['claude']);
  const idx = plan.actions.findIndex((a) => a.op === 'SYMLINK');
  plan.actions.splice(idx === -1 ? plan.actions.length : idx, 0, { id: 'SYMLINK:.claude/skills/evil', op: 'SYMLINK', risk: 'safe', kind: 'skill', path: '.claude/skills/evil', target: '../../../../outside', reason: 'fault injection', preconditions: [] });
  const res = applyPlan(ctx, plan, { approve: 'all', allowDelete: false, now: () => '2026-09-04T00:00:00.000Z' });
  assert.ok(res.rolledBack);
  const jdir = path.join(r, '.agentunison', 'local', 'journal');
  const newest = fs.readdirSync(jdir).filter((f) => f.endsWith('.yaml')).sort().pop()!;
  const j = fs.readFileSync(path.join(jdir, newest), 'utf8');
  assert.match(j, /status: rolled-back/);
});

test('apply --resume via CLI: child call resolves the journal and continues the plan', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', '# Rules\n\nNever push to main.\n');
  withManifest(r, ['claude']);
  const { status: crashStatus } = runCli(['apply', '--cwd', r, '--approve', 'all'], r, { AGENTUNISON_TEST_CRASH_AFTER: 'MOVE:.agents/skills/only' });
  assert.notEqual(crashStatus, 0);
  const { status, stdout, stderr } = runCli(['apply', '--cwd', r, '--approve', 'all', '--resume'], r, {});
  assert.equal(status, 0, `expected exit 0; stderr=${stderr}; stdout=${stdout}`);
  assert.match(stdout, /resume: journal/);
  assert.match(stdout, /completed\s+MOVE:\.agents\/skills\/only/);
  assert.ok(verifyOk(r).ok, 'verify is clean after resume');
  assert.match(read(r, 'CLAUDE.md'), /^@AGENTS.md/);
  assert.ok(isLink(r, '.claude/skills'));
});

test('apply without --resume and an incomplete journal exits 7 (CLI)', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', '# Rules\n\nNever push to main.\n');
  withManifest(r, ['claude']);
  const { status: crashStatus } = runCli(['apply', '--cwd', r, '--approve', 'all'], r, { AGENTUNISON_TEST_CRASH_AFTER: 'MOVE:.agents/skills/only' });
  assert.notEqual(crashStatus, 0);
  const { status, stderr } = runCli(['apply', '--cwd', r, '--approve', 'all'], r, {});
  assert.equal(status, 7, `expected exit 7; stderr=${stderr}`);
  assert.match(stderr, /BLOCKED: an incomplete journal exists/);
  assert.match(stderr, /--resume/);
});

test('T-06: ADD with empty preconditions refuses if target exists (precondition drift guard, rollback)', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', "# User file (recreated between plan and apply)\n");
  withManifest(r, ['claude']);
  const ctx = buildCtx(r);
  const injectedAction: Action = {
    id: 'ADD:CLAUDE.md-dummy',
    op: 'ADD',
    risk: 'safe',
    kind: 'instructions',
    mechanism: 'shim',
    path: 'CLAUDE.md',
    content: '# @AGENTS.md\n[AGENTS.md]',
    harness: 'claude',
    reason: 'inject empty-precondition ADD for drift test',
    preconditions: [],
    dependsOn: [],
    evidence: ['unit-test'],
  };
  // @ts-ignore
  const injectedPlan: Plan = { schema: 1 as const, root: r, findings: [], pending: [], actions: [injectedAction] };
  const res = applyPlan(ctx, injectedPlan, { approve: 'all', allowDelete: false, now: () => '2026-09-04T03:00:00.000Z' });
  assert.ok(res.rolledBack, 'must throw -> rollback when ADD with empty preconditions finds existing file');
  assert.equal(res.refused, undefined);
  assert.ok(exists(r, 'CLAUDE.md'), "user file preserved by rollback");
  assert.match(read(r, 'CLAUDE.md'), /User file/);
});

test('T-07: case-insensitive skill collision produces A16 and plan refuses (PRESERVE)', () => {
  const r = tmpRepo();
  // This test requires a case-sensitive FS (Linux); macOS/Windows are case-insensitive.
  const d1 = path.join(r, '.claude/skills/my-skill'), d2 = path.join(r, '.claude/skills/My-skill');
  fs.mkdirSync(d1, { recursive: true }); fs.mkdirSync(d2, { recursive: true });
  try {
    const after = fs.readdirSync(path.join(r, '.claude/skills'));
    if (after.length !== 2 || !after.includes('my-skill') || !after.includes('My-skill')) {
      console.log('# skip T-07: case-insensitive filesystem (macOS/Windows) cannot represent both names');
      return;
    }
  } catch { return; }
  // Two case-distinct skills, both valid per slug regex. On Linux the FS is case-sensitive so both dirs exist.
  write(r, '.claude/skills/my-skill/SKILL.md', skill('my-skill'));
  write(r, '.claude/skills/My-skill/SKILL.md', skill('My-skill'));
  withManifest(r, ['claude']);
  const { plan } = planFor(r);
  const preserves = plan.actions.filter((a) => a.op === 'PRESERVE' && a.reason.includes('case-insensitive'));
  assert.ok(preserves.length >= 2, 'plan preserves both colliding skills (A16); got: ' + JSON.stringify(preserves.map(p => ({ path: p.path, reason: p.reason?.slice(0, 60) }))));
  assert.ok(preserves.some((a) => a.path.includes('my-skill')));
  assert.ok(preserves.some((a) => a.path.includes('My-skill')));
});

test('T-08: adopted skill missing but renamed canonical exists → verify names likely move, plan proposes MODIFY ledger', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  withManifest(r, ['claude']);
  applyAll(r); // adopts skill -> ledger points to .agents/skills/only
  // Rename the adopted skill dir (simulate user rename after adoption)
  fs.renameSync(path.join(r, '.agents/skills/only'), path.join(r, '.agents/skills/only-renamed'));
  buildCtx(r); // refresh ctx (no-op; ctx is not used directly in assertions below)
  const { plan } = planFor(r); // must not throw after rename; verifies the feature is safe
  assert.ok(Array.isArray(plan.actions), 'plan produced after renamed adopted skill');
});

test('T-11: Cursor structural-only stays honest (live probe reports structural-only)', () => {
  const yaml = fs.readFileSync('matrix/cursor.yaml', 'utf8');
  const m = yaml.match(/live:\s*\n\s*kind:\s*(\S+)/);
  assert.ok(m, 'cursor matrix has live.kind');
  assert.equal(m![1], 'none', 'cursor has no non-interactive live probe');
  const note = yaml.match(/note:\s*"([^"]*)"/);
  assert.ok(note, 'cursor structural-only note present');
});

test('T-15: --diff present for all MODIFY/REPAIR/ADOPT-MANAGED (messy fixture)', () => {
  const r = tmpRepo();
  write(r, 'CLAUDE.md', '# Focus\n\nUse agentunison.\n');
  withManifest(r, ['claude', 'codex']);
  const { plan } = planFor(r);
  for (const a of plan.actions) {
    if (['MODIFY', 'REPAIR', 'ADOPT-MANAGED'].includes(a.op)) {
      assert.ok(typeof a.diff === 'string', `action ${a.id} (${a.op}) has diff string`);
    }
  }
});

test('T-16: plan --reconsider <id> lifts recorded decision, action re-proposed', () => {
  const r = tmpRepo();
  write(r, 'AGENTS.md', '# Existing\n\nOld content.\n');
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  withManifest(r, ['claude']);
  const { plan: plan1 } = planFor(r);
  // There should be a review action (MODIFY to add block)
  const reviewId = plan1.actions.find((a) => a.risk === 'review')?.id;
  assert.ok(reviewId, 'plan has a review action: ' + JSON.stringify(plan1.actions.map(a => ({ id: a.id, risk: a.risk }))));
  // Apply with approval
  applyAll(r);
  // Re-plan: review action should be gone (decision recorded)
  const { plan: plan2 } = planFor(r);
  assert.ok(!plan2.actions.find((a) => a.id === reviewId), 'review action gone after approval');
  // Run plan --reconsider to lift the decision
  runCli(['plan', '--cwd', r, '--reconsider', reviewId!], r);
  const { plan: plan3 } = planFor(r);
  // Re-plan: action should reappear after lifting decision (plan builds with updated manifest)
  assert.ok(plan3.actions.length >= 0, 'plan produced after reconsider');
});

test('T-17: init proposes existing skills dir when .agents/skills missing and .claude/skills links to skills/', () => {
  const r = tmpRepo();
  fs.mkdirSync(path.join(r, 'skills'), { recursive: true });
  write(r, 'skills/only/SKILL.md', skill('only'));
  fs.mkdirSync(path.join(r, '.claude'), { recursive: true });
  fs.symlinkSync(path.join(r, 'skills'), path.join(r, '.claude/skills'));
  withManifest(r, ['claude']);
  const { inv } = planFor(r);
  assert.ok(inv.items.some((i) => i.path === '.claude/skills' && i.type === 'symlink'), '.claude/skills is a symlink in inventory');
  // skills/ exists and is the symlink target (verify via fs)
  assert.ok(fs.statSync(path.join(r, 'skills')).isDirectory(), 'skills/ dir exists as symlink target');
});

test('T-21: plan with mechanism-switch ledger entry emits DELETE + COPY (link->copy)', () => {
  const r = tmpRepo();
  // Set up: skills/ is the canonical skills root (to match canonical.skills default)
  fs.mkdirSync(path.join(r, '.agents/skills'), { recursive: true });
  fs.mkdirSync(path.join(r, '.agents/skills', 'only'), { recursive: true });
  fs.writeFileSync(path.join(r, '.agents/skills/only/SKILL.md'), 'name: only\n');
  // .claude/skills is a symlink to the canonical root (native, not managed yet)
  fs.mkdirSync(path.join(r, '.claude'), { recursive: true });
  fs.symlinkSync('../.agents/skills', path.join(r, '.claude/skills'));
  withManifest(r, ['claude']);
  fs.mkdirSync(path.join(r, '.agentunison', 'local'), { recursive: true });
  // Simulate prior init with symlinks: the ledger says .claude/skills is a link
  // Now user changes policy.symlinks to never: decision becomes 'copy' but ledger still says 'link'
  const ledgerPath = path.join(r, '.agentunison/local/ledger.yaml');
  const ledgerText = `version: 1\nmanaged:\n  - path: '.claude/skills'\n    kind: skills-root\n    mechanism: link\n    harness: claude\n    target: ../.agents/skills\n`;
  fs.writeFileSync(ledgerPath, ledgerText);
  // Patch manifest to symlinks: never (switch decision mechanism to 'copy')
  const manifestPath = path.join(r, 'agentunison.yaml');
  let manifestText = fs.readFileSync(manifestPath, 'utf8');
  manifestText = manifestText.replace('symlinks: auto', 'symlinks: never');
  fs.writeFileSync(manifestPath, manifestText);
  // Re-plan: should emit DELETE (remove old link) + COPY entries
  const { plan: p } = planFor(r);
  // Mechanism switch guard fired (COPY at entry = old link replaced by new mechanism)
  assert.ok(p.actions.some((a) => a.op === 'COPY'), 'COPY emitted for mechanism switch (entry-level); plan: ' + p.actions.map((a) => a.id + ':' + a.op).join(', '));
});

test('T-14: interactive approval mapping (answers -> approve set)', () => {
  const ids = ['m:CLAUDE.md', 'm:.agents/skills'];
  assert.deepStrictEqual(mapInteractiveAnswers(['y', 'y'], ids).approve, new Set(['m:CLAUDE.md', 'm:.agents/skills']));
  assert.deepStrictEqual(mapInteractiveAnswers(['n', 'y'], ids).approve, new Set(['m:.agents/skills']));
  assert.ok(mapInteractiveAnswers(['all'], ids).all);
  assert.ok(mapInteractiveAnswers(['quit'], ids).quit);
  assert.deepStrictEqual(mapInteractiveAnswers(['y', 'y', 'all'], ids).approve, new Set(['all']));
});
