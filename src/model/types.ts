// Core data model. Every stage of the pipeline (inventory → audit → plan → apply → verify)
// exchanges these plain objects; they are also the `--json` output contract (schema 1).

export type HarnessId = 'claude' | 'codex' | 'opencode' | 'copilot' | 'cursor' | 'gemini';
export const HARNESS_IDS: readonly HarnessId[] = ['claude', 'codex', 'opencode', 'copilot', 'cursor', 'gemini'];

export type AssetKind =
  | 'instructions' // root or nested instruction file
  | 'skill'        // one Agent Skills directory
  | 'skills-root'  // a directory that holds skills
  | 'command'      // legacy prompt-command file
  | 'agent'        // subagent definition
  | 'rule'         // path-scoped rule file
  | 'settings'     // harness settings / permissions / launch
  | 'hooks'
  | 'mcp'
  | 'manifest'     // agentconcord.yaml / ledger
  | 'other';

export type ContentClass =
  | 'canonical'             // the single source for its kind
  | 'native'                // harness-specific, no canonical equivalent; preserved
  | 'managed'               // created by AgentConcord and present in the ledger
  | 'unmanaged-compatible'  // unledgered, but identical to what policy would create
  | 'legacy'                // superseded location/format
  | 'vendored'              // third-party managed tree (lock file / plugin cache); read-only
  | 'foreign';              // anything else inside a harness surface; never touched

export type PathType = 'file' | 'dir' | 'symlink' | 'missing';

export interface InventoryItem {
  path: string;              // repo-relative, forward slashes
  type: PathType;
  linkTarget?: string;       // raw readlink value when type === 'symlink'
  resolvesTo?: string;       // repo-relative resolved target, or 'outside' / 'broken'
  harness?: HarnessId | 'shared';
  kind: AssetKind;
  cls: ContentClass;
  name?: string;             // skill/agent/command name
  sha256?: string;           // LF-normalized content hash (files) or tree hash (dirs)
  frontmatter?: Record<string, unknown>;
  lines?: number;
  evidence: string[];        // why it was classified this way
}

export interface Inventory {
  schema: 1;
  root: string;
  items: InventoryItem[];
  harnessesDetected: HarnessId[];
  notes: string[];
}

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;                // rule + path, stable
  rule: string;              // A01…
  severity: Severity;
  message: string;
  paths: string[];
  evidence?: Record<string, unknown>;
  questions?: string[];      // judgment calls surfaced, never answered by the tool
  actionIds?: string[];
}

export type Op =
  | 'ADD' | 'SYMLINK' | 'COPY' | 'GENERATE' | 'PRESERVE'
  | 'MODIFY' | 'MOVE' | 'ADOPT' | 'ADOPT-MANAGED' | 'REPAIR' | 'BACKPORT' | 'QUARANTINE'
  | 'DELETE';

export type Risk = 'safe' | 'review' | 'destructive';

/** Mechanism class recorded in the committed ledger. */
export type MechanismClass = 'shim' | 'link' | 'copy' | 'generated' | 'adopted' | 'block';
/** Mechanism actually used on this machine (recorded in local state). */
export type MechanismUsed = 'symlink' | 'junction' | 'copy' | 'file' | 'block';

export interface Precondition {
  path: string;
  expect: PathType;          // what the path must be at apply time
  sha256?: string;           // required content/tree hash when expect !== 'missing'
  linkTarget?: string;       // required raw link target when expect === 'symlink'
}

export interface Action {
  id: string;                // stable: `<op>:<path>[:<detail>]`
  op: Op;
  risk: Risk;
  kind: AssetKind;
  path: string;              // primary path acted on
  harness?: HarnessId;
  source?: string;           // for MOVE/COPY/ADOPT/GENERATE/BACKPORT
  target?: string;           // for SYMLINK (relative link target)
  content?: string;          // for ADD/MODIFY/REPAIR/GENERATE (full new content)
  mechanism?: MechanismClass;
  reason: string;
  evidence?: string[];       // matrix keys with evidence class + date
  degradation?: string[];    // what this mechanism costs on other harnesses
  preconditions: Precondition[];
  preApproved?: boolean;     // from manifest.decisions
  dependsOn?: string[];      // action ids that must be selected (and run first) for this one to be valid
  diff?: string;             // unified diff for MODIFY/REPAIR when available
}

export interface Plan {
  schema: 1;
  root: string;
  actions: Action[];
  findings: Finding[];
  pending: { review: number; destructive: number };
}

export interface LedgerEntry {
  path: string;
  kind: AssetKind;
  mechanism: MechanismClass;
  harness?: HarnessId;
  target?: string;           // link: relative target
  sha256?: string;           // shim: managed part; copy/generated: content or tree hash
  source?: string;           // generated/adopted: where it came from
  sourceSha256?: string;     // generated: source hash at generation time
  origin?: string;           // adopted: provenance only
  marker?: string;           // block: marker id
}

export interface Ledger {
  version: 1;
  managed: LedgerEntry[];
}

export interface Manifest {
  version: 1;
  id: string;
  targets: HarnessId[];
  canonical: { instructions: string; skills: string };
  policy: {
    symlinks: 'auto' | 'never' | 'always';
    onConflict: 'quarantine' | 'ask';
    managedBlocks: { agentsMd: boolean };
  };
  projections?: Partial<Record<HarnessId, Record<string, string>>>;
  adapters?: { agents: Array<{ source: string; to: HarnessId[] }> };
  decisions: Record<string, string>;
}

export interface PlatformInfo {
  os: NodeJS.Platform;
  family: 'posix' | 'win32';
  symlinks: boolean;         // can create file+dir symlinks inside the repo
  junctions: boolean;        // can create junctions (win32 only)
  caseSensitive: boolean;
}

export interface LocalState {
  version: 1;
  platform: PlatformInfo;
  mechanisms: Record<string, MechanismUsed>; // ledger path → mechanism actually used here
}

export type LiveStatus = 'verified' | 'structural-only' | 'not-installed' | 'failed';

export interface VerifyIssue {
  code: 'drift' | 'block-damaged' | 'environment' | 'invariant' | 'live-failed' | 'spec';
  path?: string;
  message: string;
  fix?: string;
}

export interface VerifyReport {
  schema: 1;
  ok: boolean;
  issues: VerifyIssue[];
  live?: Array<{ harness: HarnessId; status: LiveStatus; detail: string }>;
  summary: { targets: HarnessId[]; managed: number; canonical: { instructions: string; skills: string } };
}
