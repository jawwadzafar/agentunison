import * as fs from 'node:fs';
import * as path from 'node:path';
import { LOCAL_DIR } from '../model/manifest.ts';
import { readYaml } from '../util/yamlio.ts';
import { pathType } from '../util/fs.ts';

export interface JournalEntry { [key: string]: unknown; status?: string }

export function journalDir(root: string): string { return path.join(root, LOCAL_DIR, 'journal'); }

/** Returns the newest journal file path (last in lexical order), or undefined when none exist. */
export function newestJournalFile(root: string): string | undefined {
  const d = journalDir(root);
  if (!fs.existsSync(d)) return undefined;
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.yaml')).sort();
  if (!files.length) return undefined;
  const f = files[files.length - 1]!;
  return path.join(d, f);
}

export function readJournalFile(p: string): { version?: number; entries?: JournalEntry[] } | undefined {
  if (!fs.existsSync(p)) return undefined;
  return (readYaml(p) ?? { version: 1 }) as { version?: number; entries?: JournalEntry[] };
}

function isIncomplete(entries: JournalEntry[]): boolean {
  const hasTerminal = entries.some((e) => ['rolled-back', 'resumed', 'committed'].includes(String(e.status)));
  if (hasTerminal) return false;             // previously finished/rolled back/resumed
  const hasIntent = entries.some((e) => e.status === 'intent');
  if (hasIntent) return true;                 // in-flight record present — unfinished op
  const allDone = entries.length > 0 && entries.every((e) => e.status === 'done');
  if (allDone) return true;                  // all ops completed but ledger never persisted
  return false;
}

export function findIncompleteJournal(root: string): { file: string; entries: JournalEntry[] } | undefined {
  const d = journalDir(root);
  if (!fs.existsSync(d)) return undefined;
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.yaml')).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const f = files[i]; if (!f) continue;
    const p = path.join(d, f);
    const doc = readJournalFile(p);
    if (doc && doc.entries && doc.entries.length > 0 && isIncomplete(doc.entries)) return { file: p, entries: doc.entries };
  }
  return undefined;
}