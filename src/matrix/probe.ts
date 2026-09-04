import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PlatformInfo } from '../model/types.ts';

/**
 * Probe the platform *inside the repository* (bind mounts, WSL drvfs and network shares behave
 * differently from os.tmpdir()). Creates and removes `.agentconcord/local/.probe-<pid>`.
 */
export function probePlatform(root: string): PlatformInfo {
  const os = process.platform;
  const family: 'posix' | 'win32' = os === 'win32' ? 'win32' : 'posix';
  const dir = path.join(root, '.agentconcord', 'local', `.probe-${process.pid}`);
  let symlinks = false;
  let junctions = false;
  let caseSensitive = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'd'));
    try {
      fs.symlinkSync('f.txt', path.join(dir, 'lf'), 'file');
      fs.symlinkSync('d', path.join(dir, 'ld'), 'dir');
      symlinks = fs.lstatSync(path.join(dir, 'lf')).isSymbolicLink() && fs.lstatSync(path.join(dir, 'ld')).isSymbolicLink();
    } catch {
      symlinks = false;
    }
    if (os === 'win32') {
      try {
        fs.symlinkSync(path.join(dir, 'd'), path.join(dir, 'jd'), 'junction');
        junctions = true;
      } catch {
        junctions = false;
      }
    }
    try {
      caseSensitive = !fs.readdirSync(dir).includes('F.TXT') && !fs.existsSync(path.join(dir, 'F.TXT'));
    } catch {
      caseSensitive = true;
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    // remove empty scaffolding if we created it
    for (const p of [path.join(root, '.agentconcord', 'local'), path.join(root, '.agentconcord')]) {
      try { if (fs.readdirSync(p).length === 0) fs.rmdirSync(p); } catch { /* ignore */ }
    }
  }
  return { os, family, symlinks, junctions, caseSensitive };
}
