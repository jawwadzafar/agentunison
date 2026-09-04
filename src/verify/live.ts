import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Ctx } from '../model/context.ts';
import type { HarnessId, LiveStatus } from '../model/types.ts';
import { abs, existsExact, listDir, pathType } from '../util/fs.ts';
import { ensureLocalDir, LOCAL_DIR } from '../model/manifest.ts';

export interface LiveResult { harness: HarnessId; status: LiveStatus; detail: string }

export function whichBinary(name: string): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [name], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return undefined;
  return r.stdout.split(/\r?\n/).find((l) => l.trim())?.trim();
}

export function binaryVersion(name: string, args: string[] = ['--version']): string | undefined {
  const r = spawnSync(name, args, { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32' });
  if (r.status !== 0) return undefined;
  return (r.stdout || r.stderr).split(/\r?\n/).find((l) => /\d+\.\d+/.test(l))?.trim();
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): { ok: boolean; out: string; err: string; timedOut: boolean } {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env, shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024, input: '' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  return { ok: r.status === 0 && !timedOut, out: r.stdout ?? '', err: r.stderr ?? '', timedOut };
}

function canonicalSkillNames(ctx: Ctx): string[] {
  const dir = abs(ctx.root, ctx.manifest?.canonical.skills ?? '.agents/skills');
  if (pathType(dir) !== 'dir') return [];
  return listDir(dir).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).filter((n) => existsExact(path.join(dir, n, 'SKILL.md')));
}

/**
 * Behavioral probes against installed harness binaries. Never gates unless asked; reports
 * `verified | structural-only | not-installed | failed`. Every child process has a timeout.
 */
export function verifyLive(ctx: Ctx, opts: { allowApiCalls: boolean; harnesses?: HarnessId[] }): LiveResult[] {
  const results: LiveResult[] = [];
  const targets = opts.harnesses ?? ctx.manifest?.targets ?? [];
  const nonce = ctx.manifest ? `agentunison: ${ctx.manifest.id}` : undefined;
  const skills = canonicalSkillNames(ctx);
  ensureLocalDir(ctx.root);
  const logDir = path.join(ctx.root, LOCAL_DIR, 'verify');
  fs.mkdirSync(logDir, { recursive: true });
  const log = (h: HarnessId, text: string) => fs.writeFileSync(path.join(logDir, `${h}.log`), text);

  for (const h of targets) {
    const hm = ctx.matrix[h];
    const bin = hm.detect.binaries.map(whichBinary).find(Boolean);
    const live = hm.verify.live;
    if (live.kind === 'none') { results.push({ harness: h, status: 'structural-only', detail: live.note ?? 'no non-interactive probe exists for this harness' }); continue; }
    if (!bin) { results.push({ harness: h, status: 'not-installed', detail: `${hm.detect.binaries.join('/')} not on PATH` }); continue; }
    const timeout = live.timeoutMs ?? 60000;
    try {
      switch (live.kind) {
        case 'codex-prompt-input': {
          const r = run(hm.detect.binaries[0]!, ['debug', 'prompt-input', 'agentunison verify'], ctx.root, timeout);
          log(h, r.out + '\n' + r.err);
          if (r.timedOut) { results.push({ harness: h, status: 'failed', detail: 'timed out' }); break; }
          if (!r.ok) { results.push({ harness: h, status: 'failed', detail: `exit ${r.err.split('\n')[0]?.slice(0, 200)}` }); break; }
          const sawNonce = nonce ? r.out.includes(nonce) : true;
          const missing = skills.filter((s) => !r.out.includes(`.agents/skills/${s}/SKILL.md`) && !r.out.includes(`${ctx.manifest?.canonical.skills}/${s}`));
          if (sawNonce && missing.length === 0) results.push({ harness: h, status: 'verified', detail: `composed prompt contains the ${ctx.manifest?.canonical.instructions} managed block${skills.length ? ` and all ${skills.length} skills` : ''}` });
          else results.push({ harness: h, status: 'failed', detail: `${sawNonce ? '' : 'managed block nonce not in composed prompt; '}${missing.length ? `skills missing: ${missing.join(', ')}` : ''}`.trim() });
          break;
        }
        case 'opencode-debug-skill': {
          const r = run(hm.detect.binaries[0]!, ['debug', 'skill'], ctx.root, timeout);
          log(h, r.out + '\n' + r.err);
          if (r.timedOut) { results.push({ harness: h, status: 'failed', detail: 'timed out (known: opencode debug skill can hang)' }); break; }
          let list: Array<{ name: string; location: string }> = [];
          try { list = JSON.parse(r.out.slice(r.out.indexOf('['))) as Array<{ name: string; location: string }>; } catch { results.push({ harness: h, status: 'failed', detail: 'unparseable output' }); break; }
          const project = list.filter((s) => s.location.startsWith(ctx.root));
          const names = project.map((s) => s.name);
          const missing = skills.filter((s) => !names.includes(s));
          const dupes = names.filter((n, i) => names.indexOf(n) !== i);
          if (missing.length === 0 && dupes.length === 0) results.push({ harness: h, status: 'verified', detail: `${project.length} project skill(s) listed once each` });
          else results.push({ harness: h, status: 'failed', detail: `${missing.length ? `missing: ${missing.join(', ')}` : ''} ${dupes.length ? `duplicated: ${dupes.join(', ')}` : ''}`.trim() });
          break;
        }
        case 'claude-debug': {
          if (!opts.allowApiCalls) { results.push({ harness: h, status: 'structural-only', detail: 'probe requires one model call; pass --allow-api-calls to run it' }); break; }
          const dbg = path.join(logDir, 'claude-debug.log');
          try { fs.unlinkSync(dbg); } catch { /* none */ }
          const env = { ...process.env }; delete env['CLAUDECODE']; delete env['CLAUDE_CODE_ENTRYPOINT'];
          const r = run(hm.detect.binaries[0]!, ['-p', '--model', 'haiku', '--debug-file', dbg, '--output-format', 'text', 'Reply with exactly: ok'], ctx.root, timeout, env);
          const dbgText = pathType(dbg) === 'file' ? fs.readFileSync(dbg, 'utf8') : '';
          log(h, r.out + '\n' + r.err + '\n' + dbgText);
          if (r.timedOut) { results.push({ harness: h, status: 'failed', detail: 'timed out' }); break; }
          const m = /Loaded \d+ unique skills \([^)]*project: (\d+)/.exec(dbgText);
          const dirLine = /Loading skills from:.*project=\[([^\]]*)\]/.exec(dbgText);
          if (!m || !dirLine) { results.push({ harness: h, status: 'failed', detail: 'debug log format not recognized (version drift?) — treat as unparseable, not as drift' }); break; }
          const n = Number(m[1]);
          const expectedDir = abs(ctx.root, hm.surfaces.skills?.dirs[0] ?? '.claude/skills');
          if (n === skills.length && dirLine[1]!.includes(expectedDir)) results.push({ harness: h, status: 'verified', detail: `debug log: ${n} project skill(s) loaded via ${hm.surfaces.skills?.dirs[0]}` });
          else results.push({ harness: h, status: 'failed', detail: `debug log: project skills ${n} (expected ${skills.length}); dirs=${dirLine[1]}` });
          break;
        }
        case 'list-skills': {
          const [c, ...args] = live.command ?? [];
          if (!c) { results.push({ harness: h, status: 'structural-only', detail: 'no probe command' }); break; }
          const r = run(c, args, ctx.root, timeout);
          log(h, r.out + '\n' + r.err);
          if (r.timedOut || !r.ok) { results.push({ harness: h, status: 'failed', detail: r.timedOut ? 'timed out' : `exit non-zero: ${r.err.split('\n')[0]?.slice(0, 200)}` }); break; }
          const missing = skills.filter((s) => !r.out.includes(s));
          results.push(missing.length ? { harness: h, status: 'failed', detail: `skills not listed: ${missing.join(', ')}` } : { harness: h, status: 'verified', detail: `${skills.length} skill(s) listed (instructions: structural only)` });
          break;
        }
        default:
          results.push({ harness: h, status: 'structural-only', detail: `unknown probe kind ${live.kind}` });
      }
    } catch (e) {
      results.push({ harness: h, status: 'failed', detail: (e as Error).message });
    }
  }
  return results;
}
