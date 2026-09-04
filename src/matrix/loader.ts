import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { HarnessId } from '../model/types.ts';
import { HARNESS_IDS } from '../model/types.ts';

export type Evidence = 'doc' | 'bin' | 'test' | 'none';

export interface Fact<T> {
  value: T;
  evidence: Evidence;
  checkedOn: string;
  platforms?: Array<'posix' | 'win32'>;
  note?: string;
  example?: string;
  maxDepth?: number;
}

export interface Surfaces {
  instructions?: { root: string[]; nestedName?: string; fallbackRoot?: string[]; alsoReadsLiteral?: string[]; legacyRoot?: string[] };
  skills?: { dirs: string[]; legacyDirs?: string[] };
  commands?: { dirs: string[]; legacyDirs?: string[]; legacy?: boolean };
  agents?: { dirs: string[]; legacyDirs?: string[]; format: string };
  rules?: { dirs: string[] };
  settings?: { files: string[] };
  hooks?: { files?: string[]; dirs?: string[] };
  mcp?: { files: string[] };
}

export interface HarnessMatrix {
  harness: HarnessId;
  displayName: string;
  versionsVerified: string[];
  optIn?: boolean;
  detect: { binaries: string[]; versionArgs?: string[]; projectDirs: string[]; files: string[] };
  surfaces: Surfaces;
  instructions: {
    readsAgentsMd: Fact<boolean>;
    importSyntax: Fact<string | null>;
    followsSymlink: Fact<boolean | null>;
    lineBudget?: number;
    byteBudget?: number;
    shimSafeWhenLiteral?: boolean;
    note?: string;
    copilotInstructionsAlsoReadBy?: string;
  };
  skills: {
    readsCanonical: Fact<boolean>;
    readsClaudeSkills?: Fact<boolean>;
    followsDirSymlink: Fact<boolean | null>;
    followsEntrySymlink: Fact<boolean | null>;
    dedup: 'none' | 'first-wins' | 'unknown';
    extraFrontmatter?: string[];
    extraFrontmatterSidecar?: string;
  };
  verify: { live: { kind: string; command?: string[]; timeoutMs?: number; cost?: string; note?: string } };
}

export type Matrix = Record<HarnessId, HarnessMatrix>;

function matrixDir(): string {
  // src/matrix/loader.ts → ../../matrix ; dist/matrix/loader.js → ../../matrix
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'matrix');
}

export function loadMatrix(dir: string = matrixDir()): Matrix {
  const out: Partial<Matrix> = {};
  for (const id of HARNESS_IDS) {
    const p = path.join(dir, `${id}.yaml`);
    const raw = YAML.parse(fs.readFileSync(p, 'utf8')) as HarnessMatrix;
    validateHarness(raw, p);
    out[id] = raw;
  }
  return out as Matrix;
}

function req(cond: unknown, msg: string, file: string): void {
  if (!cond) throw new Error(`matrix schema error in ${file}: ${msg}`);
}

function isFact(v: unknown): v is Fact<unknown> {
  return !!v && typeof v === 'object' && 'value' in (v as object) && 'evidence' in (v as object) && 'checkedOn' in (v as object);
}

export function validateHarness(m: HarnessMatrix, file: string): void {
  req(HARNESS_IDS.includes(m.harness), `unknown harness id ${m.harness}`, file);
  req(typeof m.displayName === 'string', 'displayName', file);
  req(Array.isArray(m.versionsVerified), 'versionsVerified[]', file);
  req(m.detect && Array.isArray(m.detect.binaries) && Array.isArray(m.detect.projectDirs) && Array.isArray(m.detect.files), 'detect', file);
  req(m.surfaces && m.surfaces.instructions && Array.isArray(m.surfaces.instructions.root), 'surfaces.instructions.root', file);
  for (const k of ['readsAgentsMd', 'importSyntax', 'followsSymlink'] as const) req(isFact(m.instructions?.[k]), `instructions.${k} must be a fact {value,evidence,checkedOn}`, file);
  for (const k of ['readsCanonical', 'followsDirSymlink', 'followsEntrySymlink'] as const) req(isFact(m.skills?.[k]), `skills.${k} must be a fact`, file);
  req(['none', 'first-wins', 'unknown'].includes(m.skills.dedup), 'skills.dedup', file);
  req(m.verify && m.verify.live && typeof m.verify.live.kind === 'string', 'verify.live.kind', file);
  const facts: Fact<unknown>[] = [m.instructions.readsAgentsMd, m.instructions.importSyntax, m.instructions.followsSymlink, m.skills.readsCanonical, m.skills.followsDirSymlink, m.skills.followsEntrySymlink];
  for (const f of facts) {
    req(['doc', 'bin', 'test', 'none'].includes(f.evidence), `evidence must be doc|bin|test|none`, file);
    req(/^\d{4}-\d{2}-\d{2}$/.test(String(f.checkedOn)), `checkedOn must be YYYY-MM-DD`, file);
  }
}

/** Human-readable evidence tag for plan/verify output: `claude.skills.followsDirSymlink[test 2026-09-04]`. */
export function evidenceTag(h: HarnessId, key: string, f: Fact<unknown>): string {
  return `${h}.${key}[${f.evidence} ${f.checkedOn}${f.platforms ? ' ' + f.platforms.join('/') : ''}]`;
}

/** A fact is "verified for this platform" only when true with real evidence covering the platform family. */
export function verifiedFor(f: Fact<boolean | null>, family: 'posix' | 'win32'): boolean {
  if (f.value !== true) return false;
  if (f.evidence === 'none') return false;
  if (!f.platforms || f.platforms.length === 0) return f.evidence === 'doc';
  return f.platforms.includes(family);
}
