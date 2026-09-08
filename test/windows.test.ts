import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpRepo, withManifest, applyAll, verifyOk, read, exists, isLink, write, treeHash } from './helpers/repo.ts';
import { buildCtx, pipeline } from '../src/commands/index.ts';
import { decideProjections } from '../src/policy/decide.ts';
import { scanInventory } from '../src/inventory/scan.ts';
import { applyPlan } from '../src/apply/engine.ts';
import { saveLocalState } from '../src/model/manifest.ts';
import type { Ctx } from '../src/model/context.ts';

const skill = (name: string, body = 'x') => `---\nname: ${name}\ndescription: Use when ${name}.\n---\n${body}\n`;

/** Simulate a symlink-hostile checkout (GitHub windows-latest without Developer Mode) by
 *  overriding the probe result the pure pipeline consumes. Runs on every platform. */
function winless(ctx: Ctx): Ctx {
  ctx.platform = { ...ctx.platform, symlinks: false, junctions: true };
  return ctx;
}

test('windows: symlink-less probe degrades claude projections to managed copies, deps preserved', () => {
  const r = tmpRepo();
  write(r, '.agents/skills/deploy/SKILL.md', skill('deploy', 'v1\n'));
  const ctx = winless(withManifest(r, ['claude']));
  const inv = scanInventory(ctx);
  const d = decideProjections(ctx, inv).skills.find((x) => x.harness === 'claude')!;
  assert.equal(d.mechanism, 'copy');
  assert.match(d.reason, /platform cannot create symlinks \(probe\)/);
  const { plan } = pipeline(ctx);
  assert.ok(!plan.actions.some((a) => a.op === 'SYMLINK'), 'no link ops on a symlink-less platform');
  const copy = plan.actions.find((a) => a.op === 'COPY' && a.path === '.claude/skills/deploy')!;
  assert.ok(copy, 'the skill is projected as a managed copy');
  assert.equal(copy.risk, 'safe');
  const res = applyPlan(ctx, plan, { approve: 'all', allowDelete: false, now: () => '2026-09-04T00:00:00.000Z' });
  assert.equal(res.refused, undefined);
  assert.ok(!isLink(r, '.claude/skills/deploy') && exists(r, '.claude/skills/deploy/SKILL.md'));
  assert.equal(read(r, '.claude/skills/deploy/SKILL.md'), read(r, '.agents/skills/deploy/SKILL.md'));
  // the machine-local mechanism is recorded in local state (never in the committed ledger)
  const fresh = buildCtx(r);
  assert.equal(fresh.localMechanisms['.claude/skills/deploy'], 'copy');
  assert.ok(!read(r, '.agentunison/ledger.yaml').includes('platform'), 'committed ledger carries no machine facts');
  assert.equal(verifyOk(r).ok, true, 'structural verify accepts the recorded copy');
  // in-place edit of the copy is drift with a BACKPORT fix (same as policy.symlinks: never)
  fs.writeFileSync(path.join(r, '.claude/skills/deploy/SKILL.md'), skill('deploy', 'edited in copy\n'));
  const v = verifyOk(r);
  assert.ok(v.issues.some((i) => i.startsWith('drift:.claude/skills/deploy:') && i.includes('edited in place')));
});

test('windows: a link with an absolute (junction-style) target passes verify only when local state records junction', (t) => {
  const r = tmpRepo();
  write(r, '.agents/skills/deploy/SKILL.md', skill('deploy'));
  withManifest(r, ['claude']);
  applyAll(r);
  const link = path.join(r, '.claude/skills');
  if (!isLink(r, '.claude/skills')) { t.skip('platform did not create a link'); return; }
  // a junction is the same directory but readlink returns an absolute path
  const absolute = fs.realpathSync(path.join(r, '.agents/skills'));
  fs.unlinkSync(link);
  fs.symlinkSync(absolute, link, 'dir');
  let v = verifyOk(r);
  assert.ok(v.issues.some((i) => i.startsWith('drift:.claude/skills:')), 'unrecorded target change is drift');
  saveLocalState(r, buildCtx(r).platform, { '.claude/skills': 'junction' });
  v = verifyOk(r);
  assert.equal(v.ok, true, 'junction recording tolerates the absolute target');
});

test('windows: committed link materialized as a text file (core.symlinks=false checkout) reports environment, not drift', (t) => {
  const r = tmpRepo();
  write(r, '.agents/skills/deploy/SKILL.md', skill('deploy'));
  withManifest(r, ['claude']);
  applyAll(r);
  const link = path.join(r, '.claude/skills');
  if (!isLink(r, '.claude/skills')) { t.skip('platform did not create a link'); return; }
  fs.unlinkSync(link);
  fs.writeFileSync(link, '../.agents/skills\n'); // what git writes when it cannot create the link
  const v = verifyOk(r);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.startsWith('environment:.claude/skills:')));
  assert.ok(!v.issues.some((i) => i.startsWith('drift:.claude/skills:')), 'the repo is fine; the checkout is limited');
});

test('windows: symlink-less plan → copies → re-plan empty, second apply a no-op', () => {
  const r = tmpRepo();
  write(r, '.agents/skills/deploy/SKILL.md', skill('deploy'));
  const ctx = winless(withManifest(r, ['claude']));
  const p1 = pipeline(ctx).plan;
  assert.ok(p1.actions.some((a) => a.op === 'COPY'));
  const res = applyPlan(ctx, p1, { approve: 'all', allowDelete: false, now: () => '2026-09-04T00:00:00.000Z' });
  assert.equal(res.refused, undefined);
  const h1 = treeHash(r);
  const p2 = pipeline(winless(buildCtx(r))).plan;
  assert.equal(p2.actions.filter((a) => a.op !== 'PRESERVE').length, 0, 're-plan is empty after the copies land');
  const res2 = applyPlan(winless(buildCtx(r)), p2, { approve: 'all', allowDelete: false, now: () => '2026-09-04T00:00:00.000Z' });
  assert.equal(res2.executed.length, 0);
  assert.equal(treeHash(r), h1, 'second apply is a no-op');
});
