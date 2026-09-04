import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, lintSkillFrontmatter, slugifySkillName, renderFrontmatter } from '../src/util/frontmatter.ts';
import { paragraphs, paragraphKey, similarity, unifiedDiff, claudeOnlySyntax } from '../src/util/text.ts';
import { renderShim, parseShim, shimHash, renderAgentsBlock, findBlock, upsertBlock, removeBlock } from '../src/adapters/shim.ts';
import { loadMatrix, verifiedFor, validateHarness } from '../src/matrix/loader.ts';
import { sha256Text, sha256Tree } from '../src/util/hash.ts';
import { stringifyStable } from '../src/util/yamlio.ts';
import { validateManifest } from '../src/model/manifest.ts';
import { generateOpenCodeAgent } from '../src/adapters/agents.ts';
import { HARNESS_IDS } from '../src/model/types.ts';
import { tmpRepo, write } from './helpers/repo.ts';

test('frontmatter: parses, tolerates errors, renders', () => {
  const fm = parseFrontmatter('---\nname: x\ndescription: Use when x.\n---\nBody\n');
  assert.equal(fm.present, true); assert.equal(fm.data['name'], 'x'); assert.equal(fm.body.trim(), 'Body');
  assert.equal(parseFrontmatter('no frontmatter').present, false);
  assert.match(parseFrontmatter('---\nname: [\n---\n').error ?? '', /invalid YAML/);
  assert.match(renderFrontmatter({ name: 'a', description: 'b' }, 'c'), /^---\nname: a\ndescription: b\n---\nc/);
});

test('skill lint follows the Agent Skills spec', () => {
  const ok = lintSkillFrontmatter('deploy', parseFrontmatter('---\nname: deploy\ndescription: Use when deploying.\n---\nx'), 10);
  assert.deepEqual(ok.blocking, []);
  const bad = lintSkillFrontmatter('deploy', parseFrontmatter('---\nname: Deploy_Prod\ndescription: x\n---\n'), 10);
  assert.ok(bad.blocking.some((b) => b.includes('must equal directory')));
  assert.ok(bad.blocking.some((b) => b.includes('must match')));
  const extra = lintSkillFrontmatter('a', parseFrontmatter('---\nname: a\ndescription: Use when a.\nmodel: opus\ncustom: 1\n---\n'), 600, ['model']);
  assert.ok(extra.degraded.some((d) => d.includes('Claude Code-specific')));
  assert.ok(extra.degraded.some((d) => d.includes('not in the Agent Skills spec')));
  assert.ok(extra.degraded.some((d) => d.includes('> 500')));
});

test('slugify produces spec-valid names', () => {
  assert.equal(slugifySkillName('frontend/component.md'), 'frontend-component');
  assert.equal(slugifySkillName('Deploy_Prod.md'), 'deploy-prod');
  assert.equal(slugifySkillName('review-PR'), 'review-pr');
  assert.equal(slugifySkillName('___'), 'skill');
});

test('paragraphs + exact keys + report-only similarity', () => {
  const a = '# T\n\npara one\n\n```\ncode\n\nkept\n```\n\npara two';
  const ps = paragraphs(a);
  assert.equal(ps.length, 4);
  assert.equal(paragraphKey('para   one\n'), 'para one');
  assert.ok(similarity(a, a) === 1);
  assert.ok(similarity('never push to main', 'always push to main') < 1);
  assert.ok(unifiedDiff('a\nb', 'a\nc', 'f').includes('-b'));
  assert.deepEqual(claudeOnlySyntax('do $ARGUMENTS and !`ls`', { context: 'fork' }).length, 3);
});

test('shim: render/parse/hash, harness-specific section excluded from hash', () => {
  const s = renderShim({ harness: 'Claude Code', importLine: '@AGENTS.md', canonical: 'AGENTS.md', id: 'abcdef12' });
  const ps = parseShim(s);
  assert.equal(ps.isShim, true); assert.equal(ps.id, 'abcdef12'); assert.equal(ps.extraneous, false);
  const withHs = renderShim({ harness: 'Claude Code', importLine: '@AGENTS.md', canonical: 'AGENTS.md', id: 'abcdef12' }, 'Claude only text');
  assert.equal(shimHash(withHs), shimHash(s), 'harness-specific section must not change the managed hash');
  assert.equal(parseShim(withHs).harnessSpecific, 'Claude only text');
  assert.notEqual(shimHash(s + 'Always deploy to prod.\n'), shimHash(s));
  assert.equal(parseShim('# Real instructions\ntext').isShim, false);
});

test('managed block: upsert is idempotent, damaged markers detected, remove restores', () => {
  const block = renderAgentsBlock({ id: 'abcdef12', canonicalInstructions: 'AGENTS.md', canonicalSkills: '.agents/skills', shims: ['CLAUDE.md'], claudeSkillsLink: true });
  assert.ok(block.split('\n').length <= 12);
  const once = upsertBlock('# Title\n\nbody\n', block);
  const twice = upsertBlock(once, block);
  assert.equal(once, twice);
  assert.equal(findBlock(once + '\n' + block), 'damaged');
  assert.equal(removeBlock(once), '# Title\n\nbody\n');
});

test('matrix loads, validates, and every fact carries evidence + date', () => {
  const m = loadMatrix();
  for (const h of HARNESS_IDS) { assert.equal(m[h].harness, h); validateHarness(m[h], h); }
  assert.equal(m.claude.instructions.readsAgentsMd.value, false);
  assert.equal(m.codex.skills.readsCanonical.value, true);
  assert.equal(verifiedFor(m.claude.skills.followsDirSymlink, 'posix'), true);
  assert.equal(verifiedFor(m.claude.skills.followsDirSymlink, 'win32'), false, 'darwin evidence must not cover win32');
  assert.equal(verifiedFor(m.copilot.skills.followsDirSymlink, 'posix'), false, 'unknown facts are not verified');
  assert.throws(() => validateHarness({ ...m.claude, skills: { ...m.claude.skills, dedup: 'maybe' as never } }, 'x'), /dedup/);
});

test('hashes are LF-normalized and tree hashes are content-only', () => {
  assert.equal(sha256Text('a\r\nb'), sha256Text('a\nb'));
  const r = tmpRepo();
  write(r, 'd/x.txt', 'hello'); write(r, 'd/.DS_Store', 'junk');
  const h1 = sha256Tree(`${r}/d`);
  write(r, 'd/.DS_Store', 'other junk');
  assert.equal(sha256Tree(`${r}/d`), h1);
});

test('stable YAML: sorted keys, no folding', () => {
  const y = stringifyStable({ b: 1, a: { d: 'x'.repeat(200), c: 2 } });
  assert.ok(y.indexOf('a:') < y.indexOf('b:'));
  assert.ok(!y.includes('\n  ' + 'x'.repeat(10) + '\n'), 'long scalars are not folded');
});

test('manifest validation is strict and coerces numeric-looking ids', () => {
  assert.throws(() => validateManifest({ version: 1, id: 'abcdef12', targets: ['claude'], bogus: 1 }), /unknown key/);
  assert.throws(() => validateManifest({ version: 1, id: 'abcdef12', targets: ['nope'] }), /unknown target/);
  assert.equal(validateManifest({ version: 1, id: 12345678, targets: ['claude'] }).id, '12345678');
  assert.throws(() => validateManifest({ version: 1, id: 'abcdef12', targets: ['claude'], canonical: { skills: '../x' } }), /repo-relative/);
});

test('opencode agent adapter drops non-mappable fields and refuses reserved names', () => {
  const g = generateOpenCodeAgent('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews.\ntools: Read\nmodel: opus\n---\nBody.\n', 'abcdef12');
  assert.ok('content' in g);
  if ('content' in g) { assert.deepEqual(g.dropped, ['tools', 'model']); assert.match(g.content, /mode: subagent/); assert.match(g.content, /Dropped Claude-only fields: tools, model/); }
  const bad = generateOpenCodeAgent('.claude/agents/plan.md', '---\nname: plan\ndescription: x\n---\n', 'abcdef12');
  assert.ok('error' in bad && /built-in OpenCode agent/.test(bad.error));
});
