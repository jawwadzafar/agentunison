import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { walkFiles, pathType } from './fs.ts';

/** Normalize CRLF → LF so hashes are stable across autocrlf checkouts. */
export function normalizeLF(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(normalizeLF(text), 'utf8').digest('hex');
}

export function sha256File(absPath: string): string {
  return sha256Text(fs.readFileSync(absPath, 'utf8'));
}

/**
 * Tree hash: content-only (no modes, no mtimes), codepoint-sorted relative paths,
 * excluding OS junk files. Symlinks inside the tree hash their raw target string.
 */
export function sha256Tree(absDir: string): string {
  const h = createHash('sha256');
  for (const relFile of walkFiles(absDir)) {
    const p = path.join(absDir, ...relFile.split('/'));
    h.update(`${relFile}\0`);
    if (pathType(p) === 'symlink') h.update(`link:${fs.readlinkSync(p)}\0`);
    else h.update(sha256File(p)).update('\0');
  }
  return h.digest('hex');
}

/** Hash for any path type: file → content, dir → tree, symlink → raw target. */
export function sha256Path(absPath: string): string | undefined {
  switch (pathType(absPath)) {
    case 'file': return sha256File(absPath);
    case 'dir': return sha256Tree(absPath);
    case 'symlink': return sha256Text(`link:${fs.readlinkSync(absPath)}`);
    default: return undefined;
  }
}

export function short(hash: string, n = 8): string {
  return hash.slice(0, n);
}
