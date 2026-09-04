import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import type { HarnessId, Ledger, LocalState, Manifest, PlatformInfo } from './types.ts';
import { HARNESS_IDS } from './types.ts';
import { pathType, readText, writeFileSafe } from '../util/fs.ts';
import { readYaml, writeYamlStable, stringifyStable } from '../util/yamlio.ts';

export const MANIFEST_FILE = 'agentunison.yaml';
export const LEDGER_FILE = '.agentunison/ledger.yaml';
export const LOCAL_DIR = '.agentunison/local';
export const LOCAL_STATE_FILE = `${LOCAL_DIR}/state.yaml`;

export function newId(): string {
  return randomBytes(4).toString('hex');
}

export function defaultManifest(targets: HarnessId[], id = newId()): Manifest {
  return {
    version: 1,
    id,
    targets,
    canonical: { instructions: 'AGENTS.md', skills: '.agents/skills' },
    policy: { symlinks: 'auto', onConflict: 'quarantine', managedBlocks: { agentsMd: true } },
    decisions: {},
  };
}

const MANIFEST_KEYS = new Set(['version', 'id', 'targets', 'canonical', 'policy', 'projections', 'adapters', 'decisions']);

export function validateManifest(m: unknown): Manifest {
  if (!m || typeof m !== 'object') throw new Error('agentunison.yaml: not a map');
  const o = m as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!MANIFEST_KEYS.has(k)) throw new Error(`agentunison.yaml: unknown key '${k}'`);
  if (o['version'] !== 1) throw new Error('agentunison.yaml: version must be 1');
  const idStr = String(o['id'] ?? '');
  if (!/^[a-f0-9]{8}$/.test(idStr)) throw new Error('agentunison.yaml: id must be 8 hex chars');
  const targets = o['targets'];
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('agentunison.yaml: targets must be a non-empty list');
  for (const t of targets) if (!HARNESS_IDS.includes(t as HarnessId)) throw new Error(`agentunison.yaml: unknown target '${String(t)}'`);
  const canonical = (o['canonical'] ?? {}) as Record<string, unknown>;
  const instructions = typeof canonical['instructions'] === 'string' ? canonical['instructions'] : 'AGENTS.md';
  const skills = typeof canonical['skills'] === 'string' ? canonical['skills'] : '.agents/skills';
  for (const p of [instructions, skills]) if (p.startsWith('/') || p.includes('..')) throw new Error(`agentunison.yaml: canonical path '${p}' must be repo-relative`);
  const policy = (o['policy'] ?? {}) as Record<string, unknown>;
  const symlinks = (policy['symlinks'] ?? 'auto') as Manifest['policy']['symlinks'];
  if (!['auto', 'never', 'always'].includes(symlinks)) throw new Error('agentunison.yaml: policy.symlinks must be auto|never|always');
  const onConflict = (policy['onConflict'] ?? 'quarantine') as Manifest['policy']['onConflict'];
  if (!['quarantine', 'ask'].includes(onConflict)) throw new Error('agentunison.yaml: policy.onConflict must be quarantine|ask');
  const mb = (policy['managedBlocks'] ?? {}) as Record<string, unknown>;
  const decisions = (o['decisions'] ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(decisions)) if (typeof v !== 'string') throw new Error(`agentunison.yaml: decisions.${k} must be a string`);
  const adaptersRaw = o['adapters'] as Manifest['adapters'] | undefined;
  const out: Manifest = {
    version: 1,
    id: idStr,
    targets: targets as HarnessId[],
    canonical: { instructions, skills },
    policy: { symlinks, onConflict, managedBlocks: { agentsMd: mb['agentsMd'] !== false } },
    decisions: decisions as Record<string, string>,
  };
  if (o['projections']) out.projections = o['projections'] as Manifest['projections'];
  if (adaptersRaw) out.adapters = adaptersRaw;
  return out;
}

export function loadManifest(root: string): Manifest | undefined {
  const raw = readYaml(path.join(root, MANIFEST_FILE));
  return raw === undefined ? undefined : validateManifest(raw);
}

/** Render the manifest with comments (only used when the file does not exist yet). */
export function renderManifest(m: Manifest): string {
  const lines = [
    '# agentunison.yaml — intent. Edit freely, then run `agentunison plan` to see the effect.',
    '# Machine state lives in .agentunison/ledger.yaml (committed) and .agentunison/local/ (ignored).',
    `version: ${m.version}`,
    `id: "${m.id}"                    # stable nonce used in managed blocks; never change`,
    `targets: [${m.targets.join(', ')}]   # harnesses this repository is used with`,
    'canonical:',
    `  instructions: ${m.canonical.instructions}     # the only always-loaded instruction file`,
    `  skills: ${m.canonical.skills}          # Agent Skills spec directories`,
    'policy:',
    `  symlinks: ${m.policy.symlinks}                 # auto | never | always (auto = matrix × platform probe)`,
    `  onConflict: ${m.policy.onConflict}          # quarantine | ask (delete is never a default)`,
    '  managedBlocks:',
    `    agentsMd: ${m.policy.managedBlocks.agentsMd}                # routing block appended to the canonical instructions`,
    '# projections:                     # optional pins per harness, e.g. claude: { skills: copy }',
    '# adapters:',
    '#   agents: []                     # opt-in generated agents: { source: .claude/agents/x.md, to: [opencode] }',
    'decisions: {}                      # approvals recorded by `apply --approve`; ids are <op>:<path>',
    '',
  ];
  return lines.join('\n');
}

export function saveManifestDecisions(root: string, decisions: Record<string, string>): void {
  const p = path.join(root, MANIFEST_FILE);
  const text = readText(p);
  const doc = YAML.parseDocument(text);
  const node = doc.createNode(sortObj(decisions));
  if (YAML.isMap(node)) node.flow = Object.keys(decisions).length === 0;
  doc.set('decisions', node);
  writeFileSafe(p, doc.toString({ lineWidth: 0 }));
}

function sortObj(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = o[k]!;
  return out;
}

export function loadLedger(root: string): Ledger {
  const raw = readYaml<Ledger>(path.join(root, LEDGER_FILE));
  if (!raw) return { version: 1, managed: [] };
  if (raw.version !== 1 || !Array.isArray(raw.managed)) throw new Error(`${LEDGER_FILE}: invalid ledger`);
  return raw;
}

export function saveLedger(root: string, ledger: Ledger): void {
  const sorted: Ledger = { version: 1, managed: [...ledger.managed].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
  writeYamlStable(path.join(root, LEDGER_FILE), sorted);
}

export function ledgerText(ledger: Ledger): string {
  return stringifyStable({ version: 1, managed: [...ledger.managed].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) });
}

export function loadLocalState(root: string): LocalState | undefined {
  return readYaml<LocalState>(path.join(root, LOCAL_STATE_FILE));
}

export function saveLocalState(root: string, platform: PlatformInfo, mechanisms: LocalState['mechanisms']): void {
  ensureLocalDir(root);
  writeYamlStable(path.join(root, LOCAL_STATE_FILE), { version: 1, platform, mechanisms } satisfies LocalState);
}

/** `.agentunison/local/` is self-ignoring: it carries a `.gitignore` containing `*`. */
export function ensureLocalDir(root: string): void {
  const dir = path.join(root, LOCAL_DIR);
  if (pathType(dir) === 'missing') {
    writeFileSafe(path.join(dir, '.gitignore'), '*\n');
  } else if (pathType(path.join(dir, '.gitignore')) === 'missing') {
    writeFileSafe(path.join(dir, '.gitignore'), '*\n');
  }
}
