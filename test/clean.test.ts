import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpRepo, applyAll, planFor, verifyOk, treeHash, read, exists, isLink, silentIO, withManifest } from './helpers/repo.ts';
import { buildCtx, cmdInit, cmdUninstall, cmdVerify, pipeline } from '../src/commands/index.ts';
import { parseShim } from '../src/adapters/shim.ts';

test('clean repo: init creates the documented tree, all actions safe', () => {
  const r = tmpRepo();
  const code = cmdInit(buildCtx(r), silentIO, { targets: ['claude', 'codex', 'opencode'], approve: [], yes: true, allowDelete: false });
  assert.equal(code, 0);
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'agentconcord.yaml', '.agentconcord/ledger.yaml', '.agentconcord/local/.gitignore', '.agents/skills']) assert.ok(exists(r, p), `${p} exists`);
  assert.ok(isLink(r, '.claude/skills'));
  assert.equal(fs.readlinkSync(path.join(r, '.claude/skills')), '../.agents/skills');
  assert.equal(read(r, '.agentconcord/local/.gitignore'), '*\n');
  const shim = parseShim(read(r, 'CLAUDE.md'));
  assert.equal(shim.isShim, true); assert.equal(shim.importLine, '@AGENTS.md');
  assert.match(read(r, 'AGENTS.md'), /<!-- agentconcord:begin id=[a-f0-9]{8} -->/);
  const ledger = read(r, '.agentconcord/ledger.yaml');
  assert.match(ledger, /mechanism: shim/); assert.match(ledger, /mechanism: link/); assert.match(ledger, /mechanism: block/);
  assert.ok(!/createdAt|platform|tool:/.test(ledger), 'committed ledger carries no machine facts');
  assert.deepEqual(verifyOk(r), { ok: true, issues: [] });
});

test('clean repo: second apply is a byte-identical no-op and plan writes nothing', () => {
  const r = tmpRepo();
  cmdInit(buildCtx(r), silentIO, { targets: ['claude', 'codex'], approve: [], yes: true, allowDelete: false });
  const h1 = treeHash(r);
  const { plan } = planFor(r);
  assert.equal(treeHash(r), h1, 'plan must not write');
  assert.equal(plan.actions.filter((a) => a.op !== 'PRESERVE').length, 0);
  const res = applyAll(r);
  assert.equal(res.executed.length, 0);
  assert.equal(treeHash(r), h1, 'second apply must not change the tree');
});

test('clean repo: codex/opencode-only targets need no shim and no links', () => {
  const r = tmpRepo();
  cmdInit(buildCtx(r), silentIO, { targets: ['codex', 'opencode'], approve: [], yes: true, allowDelete: false });
  assert.ok(!exists(r, 'CLAUDE.md'));
  assert.ok(!exists(r, '.claude'));
  assert.ok(exists(r, 'AGENTS.md') && exists(r, '.agents/skills'));
});

test('tamper: shim edit, link → dir, block removal all fail verify with the right code', () => {
  const r = tmpRepo();
  cmdInit(buildCtx(r), silentIO, { targets: ['claude', 'codex', 'opencode'], approve: [], yes: true, allowDelete: false });
  fs.appendFileSync(path.join(r, 'CLAUDE.md'), '\nAlways deploy straight to prod.\n');
  let v = verifyOk(r);
  assert.equal(v.ok, false); assert.ok(v.issues.some((i) => i.startsWith('drift:CLAUDE.md')));
  fs.unlinkSync(path.join(r, '.claude/skills')); fs.mkdirSync(path.join(r, '.claude/skills/rogue'), { recursive: true });
  fs.writeFileSync(path.join(r, '.claude/skills/rogue/SKILL.md'), '---\nname: rogue\ndescription: use when rogue\n---\n');
  v = verifyOk(r);
  assert.ok(v.issues.some((i) => i.startsWith('drift:.claude/skills:')));
  assert.ok(v.issues.some((i) => i.includes('invariant:.claude/skills/rogue')));
  const agents = read(r, 'AGENTS.md');
  fs.writeFileSync(path.join(r, 'AGENTS.md'), agents.replace('<!-- agentconcord:end -->', ''));
  v = verifyOk(r);
  assert.ok(v.issues.some((i) => i.startsWith('block-damaged:AGENTS.md')));
  assert.equal(cmdVerify(buildCtx(r), silentIO, { live: false, allowApiCalls: false }), 4);
});

test('tamper: hand-edited shim is never overwritten by a safe action; REPAIR is review', () => {
  const r = tmpRepo();
  cmdInit(buildCtx(r), silentIO, { targets: ['claude'], approve: [], yes: true, allowDelete: false });
  fs.appendFileSync(path.join(r, 'CLAUDE.md'), '\nMy extra rule.\n');
  const before = read(r, 'CLAUDE.md');
  const res = applyAll(r, []);
  assert.equal(read(r, 'CLAUDE.md'), before, 'unapproved apply must not touch the edited shim');
  const { plan } = planFor(r);
  const repair = plan.actions.find((a) => a.op === 'REPAIR' && a.path === 'CLAUDE.md');
  assert.ok(repair && repair.risk === 'review');
  assert.ok(res.skipped.some((s) => s.action.op === 'REPAIR'));
});

test('no-symlink policy: copies with hashes, BACKPORT proposed after in-place edit', () => {
  const r = tmpRepo();
  fs.mkdirSync(path.join(r, '.agents/skills/deploy'), { recursive: true });
  fs.writeFileSync(path.join(r, '.agents/skills/deploy/SKILL.md'), '---\nname: deploy\ndescription: Use when deploying.\n---\nv1\n');
  withManifest(r, ['claude'], (m) => { m.policy.symlinks = 'never'; });
  const res = applyAll(r);
  assert.ok(res.executed.some((a) => a.op === 'COPY' && a.path === '.claude/skills/deploy'));
  assert.ok(!isLink(r, '.claude/skills/deploy') && exists(r, '.claude/skills/deploy/SKILL.md'));
  assert.equal(verifyOk(r).ok, true);
  fs.writeFileSync(path.join(r, '.claude/skills/deploy/SKILL.md'), '---\nname: deploy\ndescription: Use when deploying.\n---\nv2 edited in copy\n');
  assert.ok(verifyOk(r).issues.some((i) => i.includes('edited in place')));
  const { plan } = planFor(r);
  assert.ok(plan.actions.some((a) => a.op === 'BACKPORT' && a.source === '.claude/skills/deploy'));
  applyAll(r);
  assert.match(read(r, '.agents/skills/deploy/SKILL.md'), /v2 edited in copy/);
  assert.equal(verifyOk(r).ok, true);
});

test('uninstall leaves the harness working: links materialized, shim reduced, block removed, canonical kept', () => {
  const r = tmpRepo();
  fs.mkdirSync(path.join(r, '.agents/skills/deploy'), { recursive: true });
  fs.writeFileSync(path.join(r, '.agents/skills/deploy/SKILL.md'), '---\nname: deploy\ndescription: Use when deploying.\n---\nx\n');
  cmdInit(buildCtx(r), silentIO, { targets: ['claude', 'codex'], approve: [], yes: true, allowDelete: false });
  assert.ok(isLink(r, '.claude/skills'));
  assert.equal(cmdUninstall(buildCtx(r), silentIO, { keepLinks: false }), 0);
  assert.ok(!isLink(r, '.claude/skills') && exists(r, '.claude/skills/deploy/SKILL.md'), 'Claude still sees its skills');
  assert.equal(read(r, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.ok(!read(r, 'AGENTS.md').includes('agentconcord:begin'));
  assert.ok(exists(r, 'AGENTS.md') && exists(r, '.agents/skills/deploy/SKILL.md'));
  assert.ok(!exists(r, 'agentconcord.yaml') && !exists(r, '.agentconcord/ledger.yaml'));
  const { plan } = (() => { const ctx = buildCtx(r); return pipeline(ctx); })();
  assert.equal(plan.actions.length, 0, 'no manifest → nothing planned');
});
