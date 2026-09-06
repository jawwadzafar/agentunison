import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { messyRepo, withManifest, planFor, applyAll, verifyOk, treeHash, read, exists, isLink, canSymlink } from './helpers/repo.ts';
import { scanInventory } from '../src/inventory/scan.ts';
import { runAudit } from '../src/audit/rules.ts';
import { applyPlan } from '../src/apply/engine.ts';
import { buildCtx } from '../src/commands/index.ts';
import { parseShim } from '../src/adapters/shim.ts';

test('messy: inventory classifies every surface truthfully', () => {
  const r = messyRepo();
  const ctx = withManifest(r);
  const inv = scanInventory(ctx);
  const cls = (p: string) => inv.items.find((i) => i.path === p)?.cls;
  assert.equal(cls('AGENTS.md'), 'canonical');
  assert.equal(cls('CLAUDE.md'), 'native');
  assert.equal(cls('.agents/skills/deploy'), 'canonical');
  assert.equal(cls('.claude/skills/deploy'), 'native');
  assert.equal(cls('.claude/commands/release.md'), 'legacy');
  assert.equal(cls('.claude/commands/frontend/component.md'), 'legacy');
  assert.equal(cls('.claude/agents/reviewer.md'), 'native');
  assert.equal(cls('.codex/config.toml'), 'native');
  assert.equal(cls('.opencode/agents/helper.md'), 'native');
  assert.equal(cls('.cursorrules'), 'legacy');
  assert.equal(cls('.github/copilot-instructions.md'), 'native');
  assert.ok(inv.harnessesDetected.includes('claude') && inv.harnessesDetected.includes('codex') && inv.harnessesDetected.includes('opencode'));
});

test('messy: audit finds the divergence, duplicates, conflict, legacy commands, stale path; never acts', () => {
  const r = messyRepo();
  const ctx = withManifest(r);
  const f = runAudit(ctx, scanInventory(ctx));
  const rules = new Set(f.map((x) => x.rule));
  for (const rule of ['A01', 'A03', 'A04', 'A06', 'A14']) assert.ok(rules.has(rule), `rule ${rule} fired`);
  assert.ok(f.some((x) => x.rule === 'A04' && x.message.includes("'review'") && x.message.includes('DIFFERENT')));
  assert.ok(f.some((x) => x.rule === 'A04' && x.message.includes("'deploy'") && x.message.includes('identical')));
  assert.ok(f.some((x) => x.rule === 'A06' && (x.questions ?? []).some((q) => q.includes('Delete test'))));
  const a14 = f.find((x) => x.rule === 'A14')!;
  assert.match(a14.message, /preserved/);
});

test('messy: plan proposes the right ops with review risk; safe subset is harmless', () => {
  const r = messyRepo();
  withManifest(r);
  const { plan } = planFor(r);
  const ops = (op: string) => plan.actions.filter((a) => a.op === op).map((a) => a.path);
  assert.deepEqual(ops('MOVE'), ['.agents/skills/local-only']);
  assert.deepEqual(ops('ADOPT').sort(), ['.agents/skills/frontend-component', '.agents/skills/release']);
  assert.deepEqual(ops('QUARANTINE').sort(), ['.claude/skills/deploy', '.claude/skills/review']);
  const linkOp = canSymlink(r) ? 'SYMLINK' : 'COPY'; // symlink-less platforms degrade to managed copies
  assert.ok(plan.actions.filter((a) => a.op === linkOp).every((a) => a.path.startsWith('.claude/skills/')), 'per-skill projections, not a whole-dir link, because .claude/skills has content');
  assert.equal(ops('DELETE').length, 0, 'never a DELETE without a request');
  assert.ok(plan.actions.filter((a) => a.op === 'MODIFY').every((a) => a.risk === 'review'));
  assert.ok(plan.actions.some((a) => a.op === 'MODIFY' && a.path === 'AGENTS.md' && /Deploy notes/.test(a.content ?? '')), 'generic CLAUDE.md paragraph is adopted');
  assert.ok(plan.actions.some((a) => a.op === 'MODIFY' && a.path === 'CLAUDE.md' && /Claude specifics/.test(a.content ?? '')), 'Claude-specific paragraph stays in the shim');
  // links/copies onto not-yet-existing canonical skills must depend on their creating action
  const link = plan.actions.find((a) => a.op === linkOp && a.path === '.claude/skills/release')!;
  assert.ok(link.dependsOn?.includes('ADOPT:.agents/skills/release'));
  // safe-only apply: creates nothing dangling
  const res = applyAll(r, []);
  assert.ok(res.executed.every((a) => a.risk === 'safe'));
  for (const a of res.executed) if (a.op === 'SYMLINK' || a.op === 'COPY') assert.ok(fs.existsSync(path.join(r, a.path)), `${a.path} must not dangle`);
  assert.ok(res.skipped.some((s) => (s.action.op === 'SYMLINK' || s.action.op === 'COPY') && s.action.dependsOn?.length), 'dependent projections wait for their prerequisites');
  assert.ok(exists(r, 'CLAUDE.md') && !parseShim(read(r, 'CLAUDE.md')).isShim, 'CLAUDE.md untouched without approval');
});

test('messy: approve-all converges, verify is clean, re-plan is empty, quarantine is complete and neutral', () => {
  const r = messyRepo();
  withManifest(r);
  const res = applyAll(r);
  assert.equal(res.refused, undefined);
  assert.equal(res.skipped.filter((s) => s.action.op !== 'PRESERVE').length, 0);
  // canonical skills
  const linksWork = canSymlink(r);
  for (const n of ['deploy', 'review', 'local-only', 'release', 'frontend-component']) {
    assert.ok(exists(r, `.agents/skills/${n}/SKILL.md`), `${n} canonical`);
    if (linksWork) {
      assert.ok(isLink(r, `.claude/skills/${n}`), `${n} linked for Claude`);
      assert.equal(fs.readlinkSync(path.join(r, '.claude/skills', n)), `../../.agents/skills/${n}`);
    } else {
      assert.ok(exists(r, `.claude/skills/${n}/SKILL.md`), `${n} materialized as a managed copy for Claude`);
    }
  }
  assert.match(read(r, '.agents/skills/review/SKILL.md'), /Canonical version/, 'conflict keeps the canonical');
  assert.match(read(r, '.agents/skills/release/SKILL.md'), /^---\nname: release\ndescription: Cut a release PR\./);
  // instructions
  const shim = parseShim(read(r, 'CLAUDE.md'));
  assert.equal(shim.isShim, true); assert.match(shim.harnessSpecific ?? '', /reviewer/);
  const agents = read(r, 'AGENTS.md');
  assert.match(agents, /## Merged from CLAUDE.md/); assert.match(agents, /Deploy notes/); assert.match(agents, /agentunison:begin/);
  assert.ok(!/Claude specifics/.test(agents));
  // natives untouched
  assert.equal(read(r, '.claude/agents/reviewer.md').includes('You review diffs.'), true);
  assert.ok(exists(r, '.codex/config.toml') && exists(r, '.opencode/agents/helper.md') && exists(r, '.cursorrules') && exists(r, '.github/copilot-instructions.md'));
  // originals quarantined, not deleted; harness-neutral layout
  const qdir = path.join(r, res.quarantineDir!);
  assert.ok(fs.existsSync(path.join(qdir, '_dot_claude/skills/deploy/SKILL.md')));
  assert.ok(fs.existsSync(path.join(qdir, '_dot_claude/commands/release.md')));
  assert.ok(!fs.existsSync(path.join(qdir, '.claude')), 'no dot-dir inside quarantine (would be rescanned by harnesses)');
  assert.match(read(r, `${res.quarantineDir}/MANIFEST.yaml`), /from: .claude\/skills\/review/);
  assert.ok(!exists(r, '.claude/commands/release.md') && !exists(r, '.claude/commands/frontend'));
  // decisions recorded; verify clean; re-plan empty; idempotent
  assert.match(read(r, 'agentunison.yaml'), /MODIFY:CLAUDE.md:to-shim: approve/);
  assert.deepEqual(verifyOk(r), { ok: true, issues: [] });
  const h = treeHash(r);
  const again = applyAll(r);
  assert.equal(again.executed.length, 0);
  assert.equal(treeHash(r), h);
});

test('messy: apply refuses when the tree changed after planning (preconditions)', () => {
  const r = messyRepo();
  const { ctx, plan } = (() => { withManifest(r); return planFor(r); })();
  fs.appendFileSync(path.join(r, '.claude/skills/local-only/SKILL.md'), '\nedited after plan\n');
  const res = applyPlan(ctx, plan, { approve: 'all', allowDelete: false });
  assert.ok(res.refused, 'must refuse');
  assert.equal(res.executed.length, 0, 'nothing written');
  assert.ok(exists(r, '.claude/skills/local-only/SKILL.md') && !exists(r, '.agents/skills/local-only'));
  assert.ok(!exists(r, '.agentunison/ledger.yaml'), 'ledger not written on refusal');
});

test('messy: partial approval only executes the approved chain', () => {
  const r = messyRepo();
  withManifest(r);
  const second = canSymlink(r) ? 'SYMLINK:.claude/skills/release:after-adoption' : 'COPY:.claude/skills/release:after-adoption';
  const res = applyAll(r, ['ADOPT:.agents/skills/release', second]);
  assert.deepEqual(res.executed.filter((a) => a.risk !== 'safe').map((a) => a.id).sort(), ['ADOPT:.agents/skills/release', second]);
  if (canSymlink(r)) assert.ok(isLink(r, '.claude/skills/release') && exists(r, '.agents/skills/release/SKILL.md'));
  else assert.ok(exists(r, '.claude/skills/release/SKILL.md') && exists(r, '.agents/skills/release/SKILL.md'));
  assert.ok(!isLink(r, '.claude/skills/local-only'), 'unapproved chain untouched');
  const v = verifyOk(r);
  assert.ok(v.issues.every((i) => i.startsWith('invariant:')), 'remaining issues are the known un-converged natives, not drift');
  const ctx = buildCtx(r);
  assert.match(read(r, 'agentunison.yaml'), /ADOPT:.agents\/skills\/release: approve/);
  assert.ok(ctx.manifest?.decisions['ADOPT:.agents/skills/release'] === 'approve');
});
