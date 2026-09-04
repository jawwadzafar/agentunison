/** Paragraph-level text utilities used by the exact-match merge and report-only similarity. */

export function normalizeWs(s: string): string {
  return s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{2,}/g, '\n').trim();
}

/** Split Markdown into paragraphs: blank-line separated blocks; fenced code kept whole. */
export function paragraphs(md: string): string[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => { if (buf.length) { out.push(buf.join('\n')); buf = []; } };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; buf.push(line); if (!inFence) flush(); continue; }
    if (inFence) { buf.push(line); continue; }
    if (line.trim() === '') { flush(); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

export function paragraphKey(p: string): string {
  return normalizeWs(p);
}

/** Jaccard similarity over word 3-shingles (report-only; never used to decide an action). */
export function similarity(a: string, b: string): number {
  const sh = (s: string) => {
    const w = normalizeWs(s).toLowerCase().split(/[^a-z0-9`./_-]+/).filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 3 <= w.length; i++) set.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    if (w.length < 3) set.add(w.join(' '));
    return set;
  };
  const A = sh(a), B = sh(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function countLines(s: string): number {
  if (s.length === 0) return 0;
  return s.replace(/\r\n/g, '\n').split('\n').length;
}

/** Minimal unified diff (line-based LCS) for plan display. */
export function unifiedDiff(oldText: string, newText: string, name: string): string {
  const a = oldText.replace(/\r\n/g, '\n').split('\n');
  const b = newText.replace(/\r\n/g, '\n').split('\n');
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [`--- a/${name}`, `+++ b/${name}`];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; }
    else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) { out.push(`+${b[j]}`); j++; }
    else { out.push(`-${a[i]}`); i++; }
  }
  return out.join('\n');
}

/** Claude-only command/skill syntax that does not travel to other harnesses. */
export function claudeOnlySyntax(body: string, fm: Record<string, unknown>): string[] {
  const hits: string[] = [];
  if (/\$ARGUMENTS\b|\$\d\b/.test(body)) hits.push('$ARGUMENTS / positional args');
  if (/!`[^`]+`/.test(body)) hits.push('!`cmd` shell preprocessing');
  if (/(^|\s)@[\w./-]+\.(md|txt|json|ya?ml)\b/.test(body)) hits.push('@file references');
  if (fm['context'] === 'fork') hits.push('context: fork');
  if (typeof fm['agent'] === 'string') hits.push('agent:');
  if (fm['hooks'] !== undefined) hits.push('hooks:');
  return hits;
}
