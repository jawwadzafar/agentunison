import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { Action, Finding, Inventory, InventoryItem, Plan, Precondition, HarnessId } from '../model/types.ts';
import type { Decisions } from '../policy/decide.ts';
import { abs, existsExact, pathType, readTextIfFile, listDir } from '../util/fs.ts';
import { sha256Path, sha256Text } from '../util/hash.ts';
import { parseFrontmatter, renderFrontmatter, slugifySkillName, lintSkillFrontmatter } from '../util/frontmatter.ts';
import { paragraphs, paragraphKey, unifiedDiff, countLines, claudeOnlySyntax } from '../util/text.ts';
import { renderShim, parseShim, renderAgentsBlock, findBlock, upsertBlock, shimHash } from '../adapters/shim.ts';
import { renderManifest } from '../model/manifest.ts';

const CLAUDE_VOCAB = /\.claude\/|subagent|\/[a-z][a-z0-9-]*:|CLAUDE\.md|hooks?\b|\bAllowedTools\b|permissionMode/i;

/**
 * Build the plan: a pure function of context + inventory + decisions. Every action carries
 * preconditions captured now (hashes, path types) that `apply` re-checks before writing.
 */
export function buildPlan(ctx: Ctx, inv: Inventory, findings: Finding[], decisions: Decisions, opts: { initTargets?: HarnessId[] } = {}): Plan {
  const actions: Action[] = [];
  const m = ctx.manifest;
  const canonInstr = m?.canonical.instructions ?? 'AGENTS.md';
  const canonSkills = m?.canonical.skills ?? '.agents/skills';
  const decisionsMap = m?.decisions ?? {};
  const pre = (p: string): Precondition => {
    const a = abs(ctx.root, p);
    const t = pathType(a);
    const out: Precondition = { path: p, expect: t };
    if (t !== 'missing') { const h = sha256Path(a); if (h) out.sha256 = h; }
    if (t === 'symlink') { const it = inv.items.find((i) => i.path === p); if (it?.linkTarget) out.linkTarget = it.linkTarget; }
    return out;
  };
  const add = (a: Omit<Action, 'id' | 'preApproved'> & { detail?: string }) => {
    const id = `${a.op}:${a.path}${a.detail ? `:${a.detail}` : ''}`;
    const { detail: _d, ...rest } = a;
    void _d;
    const act: Action = { id, ...rest };
    if (decisionsMap[id] === 'approve' || decisionsMap[id] === a.op.toLowerCase()) act.preApproved = true;
    if (decisionsMap[id] === 'preserve' && a.op !== 'PRESERVE') return; // user declined earlier
    actions.push(act);
  };

  // ── 0. manifest (init only) ────────────────────────────────────────────────
  if (!m && opts.initTargets) {
    // caller (init) constructs the manifest; nothing to plan here
    return { schema: 1, root: ctx.root, actions: [], findings, pending: { review: 0, destructive: 0 } };
  }
  if (!m) return { schema: 1, root: ctx.root, actions: [], findings, pending: { review: 0, destructive: 0 } };
  if (!existsExact(abs(ctx.root, 'agentconcord.yaml'))) {
    add({ op: 'ADD', risk: 'safe', kind: 'manifest', path: 'agentconcord.yaml', content: renderManifest(m), reason: 'record intent (targets, canonical paths, policy)', preconditions: [pre('agentconcord.yaml')] });
  }

  // ── 1. root instructions ───────────────────────────────────────────────────
  const canon = inv.items.find((i) => i.path === canonInstr);
  const claudeMd = inv.items.find((i) => i.path === 'CLAUDE.md' && i.harness === 'claude');
  const canonResolved = canon?.type === 'symlink' && canon.resolvesTo && !['broken', 'outside', 'cycle'].includes(canon.resolvesTo) ? canon.resolvesTo : undefined;
  const canonText = canon?.type === 'file' ? readTextIfFile(abs(ctx.root, canonInstr)) : canonResolved ? readTextIfFile(abs(ctx.root, canonResolved)) : undefined;

  if (canon?.type === 'symlink') {
    add({ op: 'ADOPT-MANAGED', risk: 'review', kind: 'instructions', path: canonInstr, reason: `${canonInstr} is a symlink (→ ${canon.resolvesTo}); the canonical instructions must be a regular file. Approve to replace the link with a real file holding the resolved content`, preconditions: [pre(canonInstr)], content: canon.resolvesTo && canon.resolvesTo !== 'broken' && canon.resolvesTo !== 'outside' && canon.resolvesTo !== 'cycle' ? readTextIfFile(abs(ctx.root, canon.resolvesTo)) ?? '' : '' });
  } else if (!canon && claudeMd?.type === 'file') {
    const t = readTextIfFile(abs(ctx.root, 'CLAUDE.md')) ?? '';
    if (!parseShim(t).isShim) add({ op: 'MOVE', risk: 'review', kind: 'instructions', path: canonInstr, source: 'CLAUDE.md', reason: `only CLAUDE.md exists; it becomes ${canonInstr} unchanged (content is not edited), then CLAUDE.md becomes a shim`, preconditions: [pre('CLAUDE.md'), pre(canonInstr)] });
  } else if (!canon) {
    const skeleton = renderSkeleton(ctx.root);
    add({ op: 'ADD', risk: 'safe', kind: 'instructions', path: canonInstr, content: skeleton, reason: `no instruction file exists; create a short ${canonInstr} skeleton`, preconditions: [pre(canonInstr)] });
  }

  // Merge: CLAUDE.md-only paragraphs when both exist with real content
  if (canonText !== undefined && claudeMd?.type === 'file') {
    const ct = readTextIfFile(abs(ctx.root, 'CLAUDE.md')) ?? '';
    const ps = parseShim(ct);
    if (!ps.isShim) {
      const canonKeys = new Set(paragraphs(canonText).map(paragraphKey));
      const unique = paragraphs(ct).filter((p) => !canonKeys.has(paragraphKey(p)));
      const toAdopt: string[] = [], toKeep: string[] = [];
      for (const p of unique) {
        const key = `merge:CLAUDE.md:${sha256Text(paragraphKey(p)).slice(0, 8)}`;
        const dec = decisionsMap[key];
        if (dec === 'keep-claude') toKeep.push(p);
        else if (dec === 'adopt') toAdopt.push(p);
        else if (CLAUDE_VOCAB.test(p)) toKeep.push(p); else toAdopt.push(p);
      }
      if (toAdopt.length) {
        const newText = `${canonText.replace(/\n+$/, '\n')}\n## Merged from CLAUDE.md (review and place)\n\n${toAdopt.join('\n\n')}\n`;
        add({ op: 'MODIFY', risk: 'review', kind: 'instructions', path: canonInstr, content: newText, detail: 'merge-from-CLAUDE.md', reason: `${toAdopt.length} paragraph(s) exist only in CLAUDE.md and contain no Claude-only vocabulary; append them to ${canonInstr} under a review heading (per-paragraph decisions: merge:CLAUDE.md:<sha8> = adopt|keep-claude)`, preconditions: [pre(canonInstr)], diff: unifiedDiff(canonText, newText, canonInstr), evidence: toAdopt.map((p) => `merge:CLAUDE.md:${sha256Text(paragraphKey(p)).slice(0, 8)}`) });
      }
      const shimDecision = decisions.instructions.find((d) => d.harness === 'claude');
      if (shimDecision?.mechanism === 'shim') {
        const content = renderShim({ harness: ctx.matrix.claude.displayName, importLine: shimDecision.shimImportLine!, canonical: canonInstr, id: m.id }, toKeep.length ? toKeep.join('\n\n') : undefined);
        add({ op: 'MODIFY', risk: 'review', kind: 'instructions', path: 'CLAUDE.md', harness: 'claude', mechanism: 'shim', content, detail: 'to-shim', reason: `reduce CLAUDE.md to a shim importing ${canonInstr}${toKeep.length ? `; ${toKeep.length} Claude-specific paragraph(s) kept in the harness-specific section` : ''}`, preconditions: [pre('CLAUDE.md')], diff: unifiedDiff(ct, content, 'CLAUDE.md'), evidence: shimDecision.evidence, degradation: shimDecision.degradation });
      }
    }
  }

  // Shims for harnesses whose decision is `shim` (fresh creation / adopt-managed / repair)
  for (const d of decisions.instructions) {
    if (d.mechanism !== 'shim') continue;
    const file = d.harness === 'claude' ? 'CLAUDE.md' : d.harness === 'gemini' ? 'GEMINI.md' : undefined;
    if (!file) continue;
    if (actions.some((a) => a.path === file)) continue; // handled by the merge branch above
    const moveAction = actions.find((a) => a.op === 'MOVE' && a.source === file);
    if (moveAction) {
      add({ op: 'ADD', risk: 'safe', kind: 'instructions', path: file, harness: d.harness, mechanism: 'shim', content: renderShim({ harness: ctx.matrix[d.harness].displayName, importLine: d.shimImportLine!, canonical: canonInstr, id: m.id }), reason: `${d.reason} (after the MOVE)`, preconditions: [], evidence: d.evidence, degradation: d.degradation, dependsOn: [moveAction.id] });
      continue;
    }
    const it = inv.items.find((i) => i.path === file);
    const expected = renderShim({ harness: ctx.matrix[d.harness].displayName, importLine: d.shimImportLine!, canonical: canonInstr, id: m.id });
    if (!it) {
      add({ op: 'ADD', risk: 'safe', kind: 'instructions', path: file, harness: d.harness, mechanism: 'shim', content: expected, reason: d.reason, preconditions: [pre(file)], evidence: d.evidence, degradation: d.degradation });
    } else if (it.type === 'file') {
      const text = readTextIfFile(abs(ctx.root, file)) ?? '';
      const ps = parseShim(text);
      const led = ctx.ledger.managed.find((e) => e.path === file);
      if (ps.isShim && !led) {
        const content = renderShim({ harness: ctx.matrix[d.harness].displayName, importLine: d.shimImportLine!, canonical: canonInstr, id: m.id }, ps.harnessSpecific ?? (ps.extraneous ? stripImport(text) : undefined));
        add({ op: 'ADOPT-MANAGED', risk: 'review', kind: 'instructions', path: file, harness: d.harness, mechanism: 'shim', content, reason: `${file} already imports ${canonInstr} but is not managed; adopt it as the managed shim${ps.extraneous ? ' (existing extra text kept in the harness-specific section)' : ''}`, preconditions: [pre(file)], diff: unifiedDiff(text, content, file), evidence: d.evidence });
      } else if (led && shimHash(text) !== led.sha256) {
        const content = renderShim({ harness: ctx.matrix[d.harness].displayName, importLine: d.shimImportLine!, canonical: canonInstr, id: m.id }, ps.harnessSpecific);
        add({ op: 'REPAIR', risk: 'review', kind: 'instructions', path: file, harness: d.harness, mechanism: 'shim', content, reason: `${file} managed part was edited; restore the pinned shim (harness-specific section kept)`, preconditions: [pre(file)], diff: unifiedDiff(text, content, file) });
      }
    } else if (it.type === 'symlink') {
      add({ op: 'ADOPT-MANAGED', risk: 'review', kind: 'instructions', path: file, harness: d.harness, mechanism: 'shim', content: expected, reason: `${file} is a symlink (→ ${it.resolvesTo}); replace it with a regular-file shim (symlinked instruction files break on symlink-hostile checkouts)`, preconditions: [pre(file)], evidence: d.evidence });
    }
  }

  // ── 2. skills: canonical root, adoption, duplicates, projections ────────────
  const canonSkillsRoot = inv.items.find((i) => i.path === canonSkills);
  if (!canonSkillsRoot) add({ op: 'ADD', risk: 'safe', kind: 'skills-root', path: canonSkills, reason: `create the canonical skills directory`, preconditions: [pre(canonSkills)] });
  const canonicalSkillNames = new Map<string, InventoryItem>();
  for (const s of inv.items) if (s.kind === 'skill' && s.type === 'dir' && path.posix.dirname(s.path) === canonSkills) canonicalSkillNames.set(s.name!, s);

  for (const s of inv.items.filter((i) => i.kind === 'skill' && i.type === 'dir' && path.posix.dirname(i.path) !== canonSkills)) {
    if (s.cls === 'vendored' || s.cls === 'foreign' || s.cls === 'managed') continue;
    const existing = canonicalSkillNames.get(s.name!);
    const text = readTextIfFile(path.join(abs(ctx.root, s.path), 'SKILL.md'));
    if (!existing) {
      if (text === undefined) { add({ op: 'PRESERVE', risk: 'safe', kind: 'skill', path: s.path, reason: 'directory without SKILL.md — not a skill; left alone', preconditions: [] }); continue; }
      const lint = lintSkillFrontmatter(s.name!, parseFrontmatter(text), countLines(text), ctx.matrix.claude.skills.extraFrontmatter ?? []);
      if (lint.blocking.length) { add({ op: 'PRESERVE', risk: 'safe', kind: 'skill', path: s.path, reason: `not adopted: spec violations (${lint.blocking.join('; ')}) — fix, then re-plan`, preconditions: [] }); continue; }
      add({ op: 'MOVE', risk: 'review', kind: 'skill', path: `${canonSkills}/${s.name}`, source: s.path, harness: s.harness === 'shared' ? undefined : s.harness, reason: `skill '${s.name}' lives only under ${path.posix.dirname(s.path)}; move it to the canonical ${canonSkills} (harness projection follows)`, preconditions: [pre(s.path), pre(`${canonSkills}/${s.name}`)] });
    } else if (existing.sha256 === s.sha256) {
      add({ op: 'QUARANTINE', risk: 'review', kind: 'skill', path: s.path, reason: `identical duplicate of ${existing.path}`, preconditions: [pre(s.path)] });
    } else {
      add({ op: 'QUARANTINE', risk: 'review', kind: 'skill', path: s.path, detail: 'conflict', reason: `CONFLICT: '${s.name}' differs from ${existing.path}. Approving quarantines this copy and keeps the canonical; to keep this one instead, quarantine the canonical manually and re-plan`, preconditions: [pre(s.path), pre(existing.path)] });
    }
  }

  // legacy commands → skills
  for (const c of inv.items.filter((i) => i.kind === 'command' && i.cls === 'legacy' && i.type === 'file')) {
    const text = readTextIfFile(abs(ctx.root, c.path)) ?? '';
    const fm = parseFrontmatter(text);
    const relName = c.path.split('/').slice(2).join('/');
    const name = slugifySkillName(relName);
    const target = `${canonSkills}/${name}`;
    if (canonicalSkillNames.has(name) || actions.some((a) => a.path === target)) {
      add({ op: 'PRESERVE', risk: 'safe', kind: 'command', path: c.path, reason: `name '${name}' already exists under ${canonSkills}; resolve manually`, preconditions: [] });
      continue;
    }
    const desc = typeof fm.data['description'] === 'string' ? fm.data['description'] : firstSentence(fm.body) || `Use when the user asks for /${name}`;
    const data: Record<string, unknown> = { name, description: desc };
    for (const k of ['license', 'compatibility', 'metadata', 'allowed-tools']) if (fm.data[k] !== undefined) data[k] = fm.data[k];
    const content = renderFrontmatter(data, `\n${fm.body.trim()}\n`);
    const claudeOnly = claudeOnlySyntax(fm.body, fm.data);
    add({ op: 'ADOPT', risk: 'review', kind: 'skill', path: target, source: c.path, harness: 'claude', content, reason: `legacy command → skill '${name}'${name !== relName.replace(/\.md$/, '') ? ` (renamed from '${relName}' to satisfy the spec)` : ''}${claudeOnly.length ? `; Claude-only syntax kept as-is: ${claudeOnly.join(', ')}` : ''}. The original is quarantined after the skill lands`, preconditions: [pre(c.path), pre(target)], degradation: claudeOnly.map((x) => `${x} is not interpreted by other harnesses`) });
  }

  // projections per harness
  for (const d of decisions.skills) {
    const hm = ctx.matrix[d.harness];
    const nativeDir = hm.surfaces.skills?.dirs[0];
    if (!nativeDir || d.mechanism === 'native' || d.mechanism === 'none') continue;
    const nativeItem = inv.items.find((i) => i.path === nativeDir);
    const led = ctx.ledger.managed.find((e) => e.path === nativeDir);
    if (d.mechanism === 'symlink-dir') {
      const target = path.posix.relative(path.posix.dirname(nativeDir), canonSkills);
      if (nativeItem?.type === 'symlink' && nativeItem.resolvesTo === canonSkills) {
        if (!led) add({ op: 'ADOPT-MANAGED', risk: 'review', kind: 'skills-root', path: nativeDir, harness: d.harness, mechanism: 'link', target, reason: `${nativeDir} already links to ${canonSkills} but is not managed; record it`, preconditions: [pre(nativeDir)], evidence: d.evidence });
        continue;
      }
      if (nativeItem && nativeItem.type !== 'missing') {
        // dir with content is handled by MOVE/QUARANTINE actions above; link only once it is empty at apply time
        const willBeEmptied = nativeItem.type === 'dir' && listDir(abs(ctx.root, nativeDir)).every((e) => actions.some((a) => (a.source === `${nativeDir}/${e.name}` || a.path === `${nativeDir}/${e.name}`) && (a.op === 'MOVE' || a.op === 'QUARANTINE')));
        if (nativeItem.type === 'dir' && listDir(abs(ctx.root, nativeDir)).length === 0) {
          add({ op: 'SYMLINK', risk: 'safe', kind: 'skills-root', path: nativeDir, harness: d.harness, mechanism: 'link', target, reason: `${d.reason} (empty directory replaced by the link)`, preconditions: [pre(nativeDir)], evidence: d.evidence, degradation: d.degradation });
        } else if (willBeEmptied) {
          const deps = actions.filter((a) => (a.source?.startsWith(`${nativeDir}/`) || a.path.startsWith(`${nativeDir}/`)) && (a.op === 'MOVE' || a.op === 'QUARANTINE')).map((a) => a.id);
          add({ op: 'SYMLINK', risk: 'review', kind: 'skills-root', path: nativeDir, harness: d.harness, mechanism: 'link', target, detail: 'after-adoption', reason: `${d.reason} — applied only after every entry above has been moved/quarantined (the directory must be empty)`, preconditions: [pre(nativeDir)], evidence: d.evidence, degradation: d.degradation, dependsOn: deps });
        } else if (nativeItem.type === 'symlink') {
          add({ op: 'QUARANTINE', risk: 'review', kind: 'skills-root', path: nativeDir, harness: d.harness, reason: `${nativeDir} is a symlink to ${nativeItem.resolvesTo}, not to ${canonSkills}; quarantine the link (recorded, not dereferenced) so the managed link can be created`, preconditions: [pre(nativeDir)] });
        }
        continue;
      }
      add({ op: 'SYMLINK', risk: 'safe', kind: 'skills-root', path: nativeDir, harness: d.harness, mechanism: 'link', target, reason: d.reason, preconditions: [pre(nativeDir)], evidence: d.evidence, degradation: d.degradation });
    } else if (d.mechanism === 'symlink-entries' || d.mechanism === 'copy') {
      // one action per canonical skill (including ones that will be MOVEd there in this plan)
      const names = new Set<string>([...canonicalSkillNames.keys(), ...actions.filter((a) => (a.op === 'MOVE' || a.op === 'ADOPT') && a.kind === 'skill').map((a) => path.posix.basename(a.path))]);
      for (const name of [...names].sort()) {
        const p = `${nativeDir}/${name}`;
        const it = inv.items.find((i) => i.path === p);
        const deps = actions.filter((a) => ((a.source === p || a.path === p) && (a.op === 'MOVE' || a.op === 'QUARANTINE')) || (a.path === `${canonSkills}/${name}` && (a.op === 'MOVE' || a.op === 'ADOPT'))).map((a) => a.id);
        const isPending = deps.length > 0;
        const entryLed = ctx.ledger.managed.find((e) => e.path === p);
        const target = path.posix.relative(nativeDir, `${canonSkills}/${name}`);
        if (d.mechanism === 'symlink-entries') {
          if (it?.type === 'symlink' && it.resolvesTo === `${canonSkills}/${name}`) { if (!entryLed) add({ op: 'ADOPT-MANAGED', risk: 'review', kind: 'skill', path: p, harness: d.harness, mechanism: 'link', target, reason: 'existing correct link, not yet managed', preconditions: [pre(p)] }); continue; }
          if (it && !isPending) { if (it.cls !== 'managed') add({ op: 'PRESERVE', risk: 'safe', kind: 'skill', path: p, reason: `occupied by ${it.type} (${it.cls}); no link created`, preconditions: [] }); continue; }
          add({ op: 'SYMLINK', risk: isPending ? 'review' : 'safe', kind: 'skill', path: p, harness: d.harness, mechanism: 'link', target, detail: isPending ? 'after-adoption' : undefined, reason: `${d.reason}${isPending ? ' (after the prerequisite move/adopt/quarantine above)' : ''}`, preconditions: isPending ? [] : [pre(p)], evidence: d.evidence, degradation: d.degradation, ...(deps.length ? { dependsOn: deps } : {}) });
        } else {
          if (entryLed?.mechanism === 'copy') {
            const cur = it?.sha256, canonHash = canonicalSkillNames.get(name)?.sha256;
            if (cur && canonHash && cur !== canonHash && cur !== entryLed.sha256) add({ op: 'BACKPORT', risk: 'review', kind: 'skill', path: `${canonSkills}/${name}`, source: p, reason: `managed copy ${p} was edited in place; copy the edit back to the canonical skill`, preconditions: [pre(p), pre(`${canonSkills}/${name}`)] });
            else if (cur && canonHash && cur !== canonHash) add({ op: 'COPY', risk: 'safe', kind: 'skill', path: p, source: `${canonSkills}/${name}`, harness: d.harness, mechanism: 'copy', detail: 'refresh', reason: 'canonical skill changed; refresh managed copy', preconditions: [pre(p), pre(`${canonSkills}/${name}`)] });
            continue;
          }
          if (it && !isPending) { add({ op: 'PRESERVE', risk: 'safe', kind: 'skill', path: p, reason: `occupied by ${it.type} (${it.cls}); no copy created`, preconditions: [] }); continue; }
          add({ op: 'COPY', risk: isPending ? 'review' : 'safe', kind: 'skill', path: p, source: `${canonSkills}/${name}`, harness: d.harness, mechanism: 'copy', detail: isPending ? 'after-adoption' : undefined, reason: d.reason, preconditions: isPending ? [] : [pre(p)], evidence: d.evidence, degradation: d.degradation, ...(deps.length ? { dependsOn: deps } : {}) });
        }
      }
    }
  }

  // ── 3. managed block in the canonical instructions ─────────────────────────
  if (m.policy.managedBlocks.agentsMd) {
    const shims = decisions.instructions.filter((d) => d.mechanism === 'shim').map((d) => (d.harness === 'claude' ? 'CLAUDE.md' : 'GEMINI.md'));
    const claudeLinks = decisions.skills.some((d) => d.harness === 'claude' && d.mechanism !== 'native' && d.mechanism !== 'none');
    const block = renderAgentsBlock({ id: m.id, canonicalInstructions: canonInstr, canonicalSkills: canonSkills, shims, claudeSkillsLink: claudeLinks });
    const base = actions.find((a) => a.path === canonInstr && (a.op === 'MODIFY' || a.op === 'ADD'))?.content ?? canonText ?? (actions.some((a) => a.op === 'MOVE' && a.path === canonInstr) ? readTextIfFile(abs(ctx.root, 'CLAUDE.md')) ?? '' : undefined);
    if (base !== undefined) {
      const loc = findBlock(base);
      if (loc === 'damaged') {
        add({ op: 'REPAIR', risk: 'review', kind: 'instructions', path: canonInstr, detail: 'block', content: undefined, reason: `managed block markers in ${canonInstr} are damaged (duplicate or unpaired); fix them by hand, then re-plan`, preconditions: [pre(canonInstr)] });
      } else if (!loc || loc.text !== block) {
        const next = upsertBlock(base, block);
        const existingIdx = actions.findIndex((a) => a.path === canonInstr && (a.op === 'MODIFY' || a.op === 'ADD'));
        if (existingIdx !== -1) { actions[existingIdx]!.content = next; actions[existingIdx]!.reason += '; includes the managed routing block'; }
        else add({ op: 'MODIFY', risk: canonText === undefined ? 'safe' : 'review', kind: 'instructions', path: canonInstr, mechanism: 'block', detail: 'block', content: next, reason: loc ? 'managed routing block is stale; refresh it' : `append the ≤ 12-line managed routing block to ${canonInstr} (tells agents where assets belong)`, preconditions: [pre(canonInstr)], diff: unifiedDiff(base, next, canonInstr) });
      }
    }
  }

  // ── 4. order: adoption → moves → quarantines → links/copies → shims → block ───
  const order: Record<string, number> = { ADD: 1, MOVE: 2, ADOPT: 3, QUARANTINE: 4, 'ADOPT-MANAGED': 5, SYMLINK: 6, COPY: 6, BACKPORT: 6, GENERATE: 7, MODIFY: 8, REPAIR: 8, PRESERVE: 9, DELETE: 10 };
  actions.sort((a, b) => (order[a.op]! - order[b.op]!) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // ADD of the canonical instructions must precede everything (skeleton first)
  actions.sort((a, b) => (a.path === canonInstr && a.op === 'ADD' ? -1 : b.path === canonInstr && b.op === 'ADD' ? 1 : 0));
  // dependencies win over op order: every action runs after all of its dependsOn (stable insertion)
  for (let pass = 0; pass < actions.length; pass++) {
    let moved = false;
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i]!;
      const deps = (a.dependsOn ?? []).map((id) => actions.findIndex((x) => x.id === id)).filter((k) => k !== -1);
      const maxDep = Math.max(-1, ...deps);
      if (maxDep > i) { actions.splice(i, 1); actions.splice(maxDep, 0, a); moved = true; break; }
    }
    if (!moved) break;
  }
  const pending = { review: actions.filter((a) => a.risk === 'review' && !a.preApproved).length, destructive: actions.filter((a) => a.risk === 'destructive' && !a.preApproved).length };
  return { schema: 1, root: ctx.root, actions, findings, pending };
}

function stripImport(text: string): string {
  return text.replace(/\r\n/g, '\n').split('\n').filter((l, i, arr) => !(i === arr.findIndex((x) => x.trim() !== '') && /^@\S+$/.test(l.trim()))).join('\n').trim();
}

function firstSentence(body: string): string {
  const t = body.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).join(' ');
  const m = /^(.{10,200}?[.!?])(\s|$)/.exec(t);
  return (m ? m[1]! : t.slice(0, 160)).trim();
}

function renderSkeleton(root: string): string {
  const name = path.basename(root);
  return [
    `# AGENTS.md — ${name}`,
    '',
    'Canonical instructions for every coding agent working in this repository. Keep it short:',
    'hard rules, orientation, key commands, verification expectations, and pointers.',
    'Procedures belong in `.agents/skills/<name>/SKILL.md`; deep knowledge belongs in docs.',
    '',
    '## Hard rules',
    '- (add the non-negotiables: branching, review, secrets, deploy gates)',
    '',
    '## Orientation',
    '- (what this repo is, the 5–10 directories that matter, where decisions live)',
    '',
    '## Commands',
    '```bash',
    '# build / test / lint — the commands an agent must run before claiming done',
    '```',
    '',
    '## Verification expectations',
    '- (what must pass, and what the PR description must state)',
    '',
  ].join('\n');
}
