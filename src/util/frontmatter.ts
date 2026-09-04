import YAML from 'yaml';

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  raw?: string;          // raw YAML text between the fences
  error?: string;        // parse error, if any
  present: boolean;
}

/** Parse a leading `---` YAML frontmatter block. Tolerant: never throws. */
export function parseFrontmatter(text: string): Frontmatter {
  const t = text.replace(/^﻿/, '');
  if (!t.startsWith('---')) return { data: {}, body: t, present: false };
  const lines = t.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, body: t, present: false };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') { end = i; break; }
  }
  if (end === -1) return { data: {}, body: t, present: true, error: 'unterminated frontmatter' };
  const raw = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  try {
    const data = YAML.parse(raw);
    if (data === null || data === undefined) return { data: {}, body, raw, present: true };
    if (typeof data !== 'object' || Array.isArray(data)) return { data: {}, body, raw, present: true, error: 'frontmatter is not a map' };
    return { data: data as Record<string, unknown>, body, raw, present: true };
  } catch (e) {
    return { data: {}, body, raw, present: true, error: `invalid YAML: ${(e as Error).message.split('\n')[0]}` };
  }
}

export function renderFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`;
}

/** Agent Skills spec constraints (agentskills.io/specification, checked 2026-09-04). */
export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SKILL_SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

export interface SkillLint {
  blocking: string[];
  degraded: string[];
  info: string[];
}

export function lintSkillFrontmatter(dirName: string, fm: Frontmatter, bodyLines: number, extraFieldsKnownClaude: readonly string[] = []): SkillLint {
  const out: SkillLint = { blocking: [], degraded: [], info: [] };
  if (!fm.present) { out.blocking.push('missing frontmatter'); return out; }
  if (fm.error) { out.blocking.push(fm.error); return out; }
  const name = fm.data['name'];
  const desc = fm.data['description'];
  if (typeof name !== 'string' || name.length === 0) out.blocking.push('name is required');
  else {
    if (name !== dirName) out.blocking.push(`name '${name}' must equal directory name '${dirName}'`);
    if (!SKILL_NAME_RE.test(name)) out.blocking.push(`name must match ${SKILL_NAME_RE.source}`);
    if (name.length > 64) out.blocking.push('name longer than 64 chars');
  }
  if (typeof desc !== 'string' || desc.trim().length === 0) out.blocking.push('description is required');
  else if (desc.length > 1024) out.blocking.push('description longer than 1024 chars');
  else if (!/\b(use|when|for|trigger|invoke|run)\b/i.test(desc)) out.info.push('description has no trigger vocabulary ("use when …")');
  for (const k of Object.keys(fm.data)) {
    if (SKILL_SPEC_FIELDS.has(k)) continue;
    if (extraFieldsKnownClaude.includes(k)) out.degraded.push(`field '${k}' is Claude Code-specific (ignored by other harnesses)`);
    else out.degraded.push(`field '${k}' is not in the Agent Skills spec (ignored by other harnesses)`);
  }
  if (bodyLines > 500) out.degraded.push(`SKILL.md is ${bodyLines} lines (> 500 recommended); move detail into references/`);
  return out;
}

/** Slugify a legacy command name into a spec-valid skill name. */
export function slugifySkillName(raw: string): string {
  const s = raw
    .replace(/\.md$/i, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[_\s]+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 64).replace(/-$/, '') || 'skill';
}
