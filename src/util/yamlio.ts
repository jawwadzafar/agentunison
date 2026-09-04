import YAML from 'yaml';
import * as fs from 'node:fs';
import { pathType, writeFileSafe } from './fs.ts';

/** Deterministic YAML for machine-owned files: sorted keys, block style, no folding. */
export function stringifyStable(value: unknown): string {
  return YAML.stringify(sortKeysDeep(value), { lineWidth: 0, sortMapEntries: true, defaultKeyType: 'PLAIN', defaultStringType: 'PLAIN' });
}

export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const val = o[k];
      if (val === undefined) continue;
      out[k] = sortKeysDeep(val);
    }
    return out;
  }
  return v;
}

export function readYaml<T = unknown>(absPath: string): T | undefined {
  if (pathType(absPath) !== 'file') return undefined;
  const text = fs.readFileSync(absPath, 'utf8');
  return YAML.parse(text) as T;
}

export function writeYamlStable(absPath: string, value: unknown): void {
  writeFileSafe(absPath, stringifyStable(value));
}

/**
 * Edit a human-owned YAML file in place, preserving comments and key order.
 * `mutate` receives the Document; maps are forced to block style on write.
 */
export function editYamlDocument(absPath: string, mutate: (doc: YAML.Document.Parsed) => void): string {
  const text = fs.readFileSync(absPath, 'utf8');
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  mutate(doc);
  YAML.visit(doc, { Map(_, node) { node.flow = false; }, Seq(_, node) { if (node.items.length > 3) node.flow = false; } });
  const out = doc.toString({ lineWidth: 0 });
  writeFileSafe(absPath, out);
  return out;
}
