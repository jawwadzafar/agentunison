import { sha256Text } from '../util/hash.ts';

/**
 * Shims and managed blocks. A shim is a harness-native instruction file whose managed part
 * is pinned byte-for-byte in the ledger; an optional harness-specific section below the
 * markers is user-owned and excluded from the hash.
 */

export const BEGIN = (id: string) => `<!-- agentunison:begin id=${id} -->`;
export const END = '<!-- agentunison:end -->';
export const HS_BEGIN = '<!-- agentunison:harness-specific:begin -->';
export const HS_END = '<!-- agentunison:harness-specific:end -->';

export interface ShimSpec {
  harness: string;          // display name for the note
  importLine: string;       // e.g. "@AGENTS.md" or "@./AGENTS.md"
  canonical: string;        // e.g. "AGENTS.md"
  id: string;
}

export function renderShim(spec: ShimSpec, harnessSpecific?: string): string {
  const managed = [
    spec.importLine,
    '',
    BEGIN(spec.id),
    `If you are reading this line, the repository instructions are in ${spec.canonical} (imported above).`,
    `This file is a compatibility shim for ${spec.harness}, managed by AgentUnison — do not add instructions here; edit ${spec.canonical} or run \`agentunison plan\`.`,
    END,
    '',
  ].join('\n');
  if (harnessSpecific && harnessSpecific.trim().length > 0) {
    return `${managed}\n${HS_BEGIN}\n${harnessSpecific.trim()}\n${HS_END}\n`;
  }
  return managed;
}

export interface ParsedShim {
  isShim: boolean;
  importLine?: string;
  id?: string;
  managedPart: string;      // text with the harness-specific section removed
  harnessSpecific?: string;
  extraneous: boolean;      // non-shim text outside the harness-specific section
}

export function parseShim(text: string): ParsedShim {
  const lf = text.replace(/\r\n/g, '\n');
  const lines = lf.split('\n');
  const first = lines.find((l) => l.trim() !== '');
  const isImport = !!first && /^@\S+$/.test(first.trim());
  const beginIdx = lines.findIndex((l) => /^<!-- agentunison:begin id=[a-f0-9]{8} -->$/.test(l.trim()));
  const endIdx = lines.findIndex((l) => l.trim() === END);
  const hsB = lines.findIndex((l) => l.trim() === HS_BEGIN);
  const hsE = lines.findIndex((l) => l.trim() === HS_END);
  let harnessSpecific: string | undefined;
  let managedLines = lines;
  if (hsB !== -1 && hsE > hsB) {
    harnessSpecific = lines.slice(hsB + 1, hsE).join('\n');
    managedLines = [...lines.slice(0, hsB), ...lines.slice(hsE + 1)];
  }
  const managedPart = managedLines.join('\n').replace(/\n+$/, '\n');
  const id = beginIdx !== -1 ? /id=([a-f0-9]{8})/.exec(lines[beginIdx]!)?.[1] : undefined;
  // extraneous: any non-blank line in managedPart that is not the import, not inside the block
  let extraneous = false;
  if (isImport && beginIdx !== -1 && endIdx > beginIdx) {
    managedLines.forEach((l, i) => {
      if (l.trim() === '') return;
      if (l.trim() === first!.trim() && i === managedLines.indexOf(first!)) return;
      const inBlock = i >= managedLines.indexOf(lines[beginIdx]!) && i <= managedLines.indexOf(END);
      if (!inBlock) extraneous = true;
    });
  }
  const out: ParsedShim = { isShim: isImport, managedPart, extraneous };
  if (isImport) out.importLine = first!.trim();
  if (id) out.id = id;
  if (harnessSpecific !== undefined) out.harnessSpecific = harnessSpecific;
  return out;
}

export function shimHash(text: string): string {
  return sha256Text(parseShim(text).managedPart);
}

/** Managed routing block appended to the canonical instructions file. ≤ 12 lines. */
export function renderAgentsBlock(opts: { id: string; canonicalInstructions: string; canonicalSkills: string; shims: string[]; claudeSkillsLink: boolean }): string {
  const shimNote = opts.shims.length ? `${opts.shims.join(' and ')} ${opts.shims.length > 1 ? 'are' : 'is a'} managed shim${opts.shims.length > 1 ? 's' : ''} that import${opts.shims.length > 1 ? '' : 's'} this file — never add instructions there.` : 'No other root instruction file should exist.';
  const claude = opts.claudeSkillsLink ? ` Claude Code reads them through \`.claude/skills\` links — do not create skills there.` : '';
  return [
    BEGIN(opts.id),
    '## Agent assets (managed by AgentUnison)',
    `- Repository instructions: this file (\`${opts.canonicalInstructions}\`) is the only always-loaded instruction file. ${shimNote}`,
    `- Skills: \`${opts.canonicalSkills}/<name>/SKILL.md\` (Agent Skills spec: \`name\` = directory, precise \`description\`).${claude}`,
    '- Harness-native config (subagents, settings, hooks, rules) stays in each tool\'s own directory; it is inventoried, never converged.',
    '- Check the layout with `agentunison verify`; change it by editing `agentunison.yaml` and running `agentunison plan`.',
    `agentunison: ${opts.id}`,
    END,
  ].join('\n');
}

export interface BlockLocation { start: number; end: number; text: string }

/** Find the managed block in a file; returns undefined when absent, `damaged` when markers are inconsistent. */
export function findBlock(text: string): BlockLocation | 'damaged' | undefined {
  const lf = text.replace(/\r\n/g, '\n');
  const begins = [...lf.matchAll(/<!-- agentunison:begin id=[a-f0-9]{8} -->/g)];
  const ends = [...lf.matchAll(new RegExp(END.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g'))];
  if (begins.length === 0 && ends.length === 0) return undefined;
  if (begins.length !== 1 || ends.length !== 1) return 'damaged';
  const start = begins[0]!.index!;
  const end = ends[0]!.index! + END.length;
  if (end < start) return 'damaged';
  return { start, end, text: lf.slice(start, end) };
}

export function upsertBlock(text: string, block: string): string {
  // preserve the file's line-ending convention: work on LF, convert back when the file used CRLF
  const crlf = text.includes('\r\n');
  const lf = text.replace(/\r\n/g, '\n');
  const loc = findBlock(lf);
  if (loc === 'damaged') throw new Error('managed block damaged');
  let out: string;
  if (!loc) {
    const sep = lf.length === 0 ? '' : lf.endsWith('\n\n') ? '' : lf.endsWith('\n') ? '\n' : '\n\n';
    out = `${lf}${sep}${block}\n`;
  } else {
    out = `${lf.slice(0, loc.start)}${block}${lf.slice(loc.end)}`;
  }
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

export function removeBlock(text: string): string {
  const lf = text.replace(/\r\n/g, '\n');
  const loc = findBlock(lf);
  if (!loc || loc === 'damaged') return lf;
  return `${lf.slice(0, loc.start)}${lf.slice(loc.end)}`.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}
