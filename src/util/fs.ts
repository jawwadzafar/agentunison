import { promises as fsp, type Dirent } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PathType } from '../model/types.ts';

/** Repo-relative path with forward slashes. */
export function rel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

export function abs(root: string, relPath: string): string {
  return path.resolve(root, ...relPath.split('/'));
}

/** lstat-based type. Never follows symlinks. */
export function pathType(absPath: string): PathType {
  try {
    const st = fs.lstatSync(absPath);
    if (st.isSymbolicLink()) return 'symlink';
    if (st.isDirectory()) return 'dir';
    return 'file';
  } catch {
    return 'missing';
  }
}

/** Exact-name existence check that is safe on case-insensitive filesystems. */
export function existsExact(absPath: string): boolean {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  try {
    return fs.readdirSync(dir).includes(base);
  } catch {
    return false;
  }
}

export function readlink(absPath: string): string | undefined {
  try {
    return fs.readlinkSync(absPath);
  } catch {
    return undefined;
  }
}

/** Resolve a symlink chain (depth-capped). Returns absolute realpath or a failure kind. */
export function resolveLink(absPath: string, maxDepth = 8): { kind: 'ok'; realpath: string } | { kind: 'broken' } | { kind: 'cycle' } {
  let cur = absPath;
  const seen = new Set<string>();
  for (let i = 0; i < maxDepth; i++) {
    if (seen.has(cur)) return { kind: 'cycle' };
    seen.add(cur);
    const t = pathType(cur);
    if (t === 'missing') return { kind: 'broken' };
    if (t !== 'symlink') return { kind: 'ok', realpath: cur };
    const target = fs.readlinkSync(cur);
    cur = path.resolve(path.dirname(cur), target);
  }
  return { kind: 'cycle' };
}

export function isInside(root: string, absPath: string): boolean {
  const r = path.resolve(root) + path.sep;
  const p = path.resolve(absPath);
  return p === path.resolve(root) || p.startsWith(r);
}

export function readText(absPath: string): string {
  return fs.readFileSync(absPath, 'utf8');
}

export function readTextIfFile(absPath: string): string | undefined {
  return pathType(absPath) === 'file' ? readText(absPath) : undefined;
}

/** Atomic write that refuses to write through a symlink (lstat first). */
export function writeFileSafe(absPath: string, content: string): void {
  const t = pathType(absPath);
  if (t === 'symlink') throw new Error(`refusing to write through symlink: ${absPath}`);
  if (t === 'dir') throw new Error(`refusing to write over directory: ${absPath}`);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.agentunison-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, absPath);
}

export function listDir(absPath: string): Dirent[] {
  try {
    return fs.readdirSync(absPath, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/** Recursive file listing (repo-relative to `base`), codepoint-sorted, following no symlinks. */
export function walkFiles(base: string, opts: { exclude?: (name: string) => boolean } = {}): string[] {
  const out: string[] = [];
  const skip = opts.exclude ?? ((n: string) => n === '.DS_Store' || n === 'Thumbs.db');
  const visit = (dir: string, prefix: string) => {
    for (const d of listDir(dir)) {
      if (skip(d.name)) continue;
      const p = path.join(dir, d.name);
      const r = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isSymbolicLink()) out.push(r);
      else if (d.isDirectory()) visit(p, r);
      else out.push(r);
    }
  };
  visit(base, '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function copyTree(srcAbs: string, dstAbs: string): void {
  fs.cpSync(srcAbs, dstAbs, { recursive: true, dereference: false, errorOnExist: true, force: false, preserveTimestamps: false });
}

export function removePath(absPath: string): void {
  const t = pathType(absPath);
  if (t === 'missing') return;
  if (t === 'symlink' || t === 'file') fs.unlinkSync(absPath);
  else fs.rmSync(absPath, { recursive: true, force: false });
}

/** Relative link target from `fromAbs` (the link path) to `toAbs`. */
export function relativeLinkTarget(fromAbs: string, toAbs: string): string {
  return path.relative(path.dirname(fromAbs), toAbs).split(path.sep).join('/');
}

export function makeSymlink(linkAbs: string, relTarget: string, kind: 'file' | 'dir'): 'symlink' | 'junction' {
  if (process.platform === 'win32' && kind === 'dir') {
    try {
      fs.symlinkSync(relTarget.split('/').join(path.sep), linkAbs, 'dir');
      return 'symlink';
    } catch {
      // junction targets are absolute by Node's normalisation; caller records mechanism 'junction'
      fs.symlinkSync(path.resolve(path.dirname(linkAbs), relTarget), linkAbs, 'junction');
      return 'junction';
    }
  }
  fs.symlinkSync(relTarget.split('/').join(path.sep), linkAbs, kind === 'dir' ? 'dir' : 'file');
  return 'symlink';
}

export async function fsyncFile(absPath: string): Promise<void> {
  const fh = await fsp.open(absPath, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export function isGitRepoRoot(dir: string): boolean {
  return pathType(path.join(dir, '.git')) !== 'missing';
}

/** Walk up from `start` to find a `.git` (repo root); falls back to `start`. */
export function findRepoRoot(start: string): string {
  let cur = path.resolve(start);
  for (;;) {
    if (isGitRepoRoot(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(start);
    cur = parent;
  }
}
