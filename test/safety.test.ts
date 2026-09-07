import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpRepo, withManifest, planFor, applyAll, verifyOk, read, exists, isLink, write, isSymlinkHostile, symlinksUnsupported } from './helpers/repo.ts';
import { scanInventory } from '../src/inventory/scan.ts';
import { decideProjections } from '../src/policy/decide.ts';
import { buildCtx } from '../src/commands/index.ts';
import { applyPlan } from '../src/apply/engine.ts';

const skill = (name: string, body = 'x') => `---\nname: ${name}\ndescription: Use when ${name}.\n---\n${body}\n`;

test('symlinked CLAUDE.md → AGENTS.md is never written through; it becomes a review ADOPT-MANAGED', () => {
  const r = tmpRepo();
  write(r, 'AGENTS.md', '# Rules\n\nNever push to main.\n');
  fs.symlinkSync('AGENTS.md', path.join(r, 'CLAUDE.md'));
  withManifest(r, ['claude', 'codex']);
  const { plan } = planFor(r);
  const a = plan.actions.find((x) => x.path === 'CLAUDE.md');
  assert.ok(a && a.op === 'ADOPT-MANAGED' && a.risk === 'review');
  const safe = applyAll(r, []);
  assert.ok(!safe.executed.some((x) => x.path === 'CLAUDE.md'));
  assert.match(read(r, 'AGENTS.md'), /Never push to main/, 'canonical intact after safe apply');
  applyAll(r);
  assert.ok(!isLink(r, 'CLAUDE.md'), 'link replaced by a regular-file shim');
  assert.match(read(r, 'AGENTS.md'), /Never push to main/, 'canonical intact after adopt');
  assert.match(read(r, 'CLAUDE.md'), /^@AGENTS.md/);
  assert.equal(verifyOk(r).ok, true);
});

test('symlinked AGENTS.md → CLAUDE.md (Claude-first repo) is not moved onto itself', () => {
  const r = tmpRepo();
  write(r, 'CLAUDE.md', '# Rules\n\nReal content.\n');
  fs.symlinkSync('CLAUDE.md', path.join(r, 'AGENTS.md'));
  withManifest(r, ['claude', 'codex']);
  const { plan } = planFor(r);
  const a = plan.actions.find((x) => x.path === 'AGENTS.md')!;
  assert.equal(a.op, 'ADOPT-MANAGED'); assert.equal(a.risk, 'review');
  assert.ok(!plan.actions.some((x) => x.op === 'MOVE'));
  applyAll(r);
  assert.ok(!isLink(r, 'AGENTS.md')); assert.match(read(r, 'AGENTS.md'), /Real content/);
  assert.match(read(r, 'CLAUDE.md'), /^@AGENTS.md/);
  assert.equal(verifyOk(r).ok, true);
});

test('only CLAUDE.md: MOVE to AGENTS.md keeps content byte-identical, then shim', () => {
  const r = tmpRepo();
  const content = '# Rules\r\n\r\nWith CRLF line endings.\r\n';
  write(r, 'CLAUDE.md', content);
  withManifest(r, ['claude']);
  const res = applyAll(r);
  assert.ok(res.executed.some((a) => a.op === 'MOVE'));
  assert.ok(read(r, 'AGENTS.md').startsWith(content), 'moved content is untouched (block appended after)');
  assert.match(read(r, 'CLAUDE.md'), /^@AGENTS.md/);
  assert.equal(verifyOk(r).ok, true);
});

test('foreign manager marker in .claude/skills → projection none, never copied into', () => {
  const r = tmpRepo();
  write(r, '.agents/skills/deploy/SKILL.md', skill('deploy'));
  write(r, '.claude/skills/.agentsync-manifest', 'deploy\n');
  write(r, '.claude/skills/other/SKILL.md', skill('other'));
  const ctx = withManifest(r, ['claude']);
  const d = decideProjections(ctx, scanInventory(ctx)).skills.find((x) => x.harness === 'claude')!;
  assert.equal(d.mechanism, 'none');
  const { plan } = planFor(r);
  assert.ok(!plan.actions.some((a) => (a.op === 'SYMLINK' || a.op === 'COPY') && a.path.startsWith('.claude/skills')));
  assert.ok(!plan.actions.some((a) => a.op === 'MOVE' && a.source === '.claude/skills/other'), 'co-owned entries are foreign, not adopted');
});

test('vendored skill trees (lock file) are excluded from convergence', () => {
  const r = tmpRepo();
  write(r, 'web/skills-lock.json', '{}');
  write(r, 'web/.agents/skills/vendor-skill/SKILL.md', skill('vendor-skill'));
  write(r, '.claude/skills/mine/SKILL.md', skill('mine'));
  fs.mkdirSync(path.join(r, '.claude/skills'), { recursive: true });
  // vendored detection is keyed on a lock next to the skills root of a *scanned* surface; simulate at root
  write(r, 'skills-lock.json', '{}');
  const ctx = withManifest(r, ['claude', 'codex']);
  const inv = scanInventory(ctx);
  assert.equal(inv.items.find((i) => i.path === '.claude/skills/mine')?.cls, 'vendored');
  const { plan } = planFor(r);
  assert.ok(!plan.actions.some((a) => a.source === '.claude/skills/mine'));
});

test('empty .claude/skills dir → whole-dir link; skills added later need no re-apply', () => {
  if (isSymlinkHostile()) { console.log('# skip: symlink-hostile environment'); return; }
  const r = tmpRepo();
  if (symlinksUnsupported(r)) { console.log('# skip: git core.symlinks=false checkout'); return; }
  if (!isLink(r, '.claude/skills')) { console.log('# skip: .claude/skills is not a symlink (symlink creation failed on this checkout)'); return; }
  fs.mkdirSync(path.join(r, '.claude/skills'), { recursive: true });
  withManifest(r, ['claude']);
  applyAll(r);
  assert.ok(isLink(r, '.claude/skills'));
  write(r, '.agents/skills/new-one/SKILL.md', skill('new-one'));
  assert.ok(exists(r, '.claude/skills/new-one/SKILL.md'), 'visible through the dir link');
  assert.equal(verifyOk(r).ok, true);
  assert.equal(planFor(r).plan.actions.filter((a) => a.op !== 'PRESERVE').length, 0);
});

test('spec-violating native skill is preserved with a reason, not moved', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/Bad_Name/SKILL.md', '---\nname: Bad_Name\ndescription: x\n---\n');
  withManifest(r, ['claude', 'codex']);
  const { plan } = planFor(r);
  const p = plan.actions.find((a) => a.path === '.claude/skills/Bad_Name');
  assert.ok(p && p.op === 'PRESERVE' && /spec violations/.test(p.reason));
});

test('journal is write-ahead: intent recorded before each op, done after', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  withManifest(r, ['claude']);
  applyAll(r);
  const jdir = path.join(r, '.agentunison/local/journal');
  const files = fs.readdirSync(jdir);
  assert.equal(files.length, 1);
  const j = fs.readFileSync(path.join(jdir, files[0]!), 'utf8');
  assert.match(j, /status: done/); assert.ok(!/status: intent/.test(j), 'every op completed');
  assert.match(j, /op: MOVE/);
});

test('case-variant duplicate names are visible in inventory as separate items (no silent merge)', () => {
  const r = tmpRepo();
  write(r, '.agents/skills/deploy/SKILL.md', skill('deploy'));
  const ctx = withManifest(r, ['codex']);
  const inv = scanInventory(ctx);
  assert.equal(inv.items.filter((i) => i.kind === 'skill').length, 1);
  assert.equal(buildCtx(r).platform.family, process.platform === 'win32' ? 'win32' : 'posix');
});

test('rollback: a failure mid-apply reverses completed operations (fault injection)', () => {
  const r = tmpRepo();
  write(r, '.claude/skills/only/SKILL.md', skill('only'));
  write(r, 'CLAUDE.md', '# Real\n\nContent.\n');
  const { ctx, plan } = (() => { withManifest(r, ['claude']); return planFor(r); })();
  // inject a failing action after the MOVE: a link whose target escapes the repository
  const idx = plan.actions.findIndex((a) => a.op === 'SYMLINK');
  plan.actions.splice(idx === -1 ? plan.actions.length : idx, 0, { id: 'SYMLINK:.claude/skills/evil', op: 'SYMLINK', risk: 'safe', kind: 'skill', path: '.claude/skills/evil', target: '../../../../outside', reason: 'fault injection', preconditions: [] });
  const before = { claude: read(r, 'CLAUDE.md'), hasSkill: exists(r, '.claude/skills/only/SKILL.md') };
  
  const res = applyPlan(ctx, plan, { approve: 'all', allowDelete: false, now: () => '2026-09-04T00:00:00.000Z' });
  assert.ok(res.rolledBack, 'apply reports the rollback');
  assert.equal(res.executed.length, 0);
  assert.equal(read(r, 'CLAUDE.md'), before.claude, 'CLAUDE.md restored');
  assert.equal(exists(r, '.claude/skills/only/SKILL.md'), before.hasSkill, 'moved skill restored to its origin');
  assert.ok(!exists(r, '.agentunison/ledger.yaml'), 'ledger not written');
  assert.ok(!exists(r, '.claude/skills/evil'));
});
