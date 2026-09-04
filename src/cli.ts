import { parseArgs } from 'node:util';
import type { HarnessId } from './model/types.ts';
import { HARNESS_IDS } from './model/types.ts';
import { buildCtx, cmdApply, cmdAudit, cmdDoctor, cmdInit, cmdInspect, cmdPlan, cmdUninstall, cmdVerify, type CommandIO } from './commands/index.ts';

const HELP = `agentunison — make every coding agent agree on your repository

Usage: agentunison <command> [options]

Commands
  init        Detect harnesses, write agentunison.yaml, converge safely (plans first; approvals for changes to existing files)
  inspect     Inventory of every harness surface, classified with evidence
  audit       Findings: duplicates, conflicts, legacy surfaces, budgets, spec violations (exit 2 when any medium/high)
  plan        The dry run: every action with risk class, reason, evidence; nothing is written (exit 2 when actions are pending)
  apply       Execute the plan. Safe actions always; --approve "<id>,…"|all for review actions; DELETE also needs --allow-delete
  verify      Structural check of ledger + invariants (exit 4 on failure); --live probes installed harnesses
  doctor      Environment: installed harnesses/versions vs the verified matrix, platform symlink probe, manifest state
  uninstall   Leave every harness working, remove what AgentUnison manages (canonical content is never removed)

Options
  --cwd <path>            repository (default: cwd; the git root is used)
  --json                  machine-readable output (schema 1)
  --targets <a,b>         init: harness ids (${HARNESS_IDS.join(', ')})
  --approve <ids|all>     init/apply: approve review actions by id
  --allow-delete          apply: additionally required for DELETE actions
  --plan <file>           apply: execute a saved plan (from \`plan --json\`) exactly, with its preconditions
  --diff                  plan: show diffs for MODIFY/REPAIR
  --live                  verify: run real-harness probes (never gates unless a probe fails)
  --allow-api-calls       verify --live: allow probes that cost a model call (Claude Code)
  --keep-links            uninstall: keep symlinks instead of materializing copies
  --yes                   non-interactive; never implies approvals
  -h, --help              this help

Exit codes: 0 ok · 1 usage/config error · 2 findings/pending actions · 4 verify failed · 7 refused (preconditions changed)
`;

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        cwd: { type: 'string' }, json: { type: 'boolean', default: false }, targets: { type: 'string' }, approve: { type: 'string' },
        'allow-delete': { type: 'boolean', default: false }, plan: { type: 'string' }, diff: { type: 'boolean', default: false },
        live: { type: 'boolean', default: false }, 'allow-api-calls': { type: 'boolean', default: false }, 'keep-links': { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const cmd = positionals[0];
  if (values.help || !cmd) { process.stdout.write(HELP); return cmd ? 0 : 1; }
  const io: CommandIO = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n'), json: values.json ?? false, isTTY: !!process.stdin.isTTY };
  const approve = values.approve ? values.approve.split(',').map((s) => s.trim()).filter(Boolean) : [];
  try {
    const ctx = buildCtx(values.cwd ?? process.cwd());
    switch (cmd) {
      case 'init': {
        let targets: HarnessId[] | undefined;
        if (values.targets) {
          targets = values.targets.split(',').map((s) => s.trim()) as HarnessId[];
          for (const t of targets) if (!HARNESS_IDS.includes(t)) { io.err(`unknown target '${t}' (valid: ${HARNESS_IDS.join(', ')})`); return 1; }
        }
        return cmdInit(ctx, io, { ...(targets ? { targets } : {}), approve, yes: values.yes ?? false, allowDelete: values['allow-delete'] ?? false });
      }
      case 'inspect': return cmdInspect(ctx, io);
      case 'audit': return cmdAudit(ctx, io);
      case 'plan': return cmdPlan(ctx, io, { diff: values.diff ?? false });
      case 'apply': return cmdApply(ctx, io, { approve, allowDelete: values['allow-delete'] ?? false, ...(values.plan ? { planFile: values.plan } : {}) });
      case 'verify': return cmdVerify(ctx, io, { live: values.live ?? false, allowApiCalls: values['allow-api-calls'] ?? false });
      case 'doctor': return cmdDoctor(ctx, io);
      case 'uninstall': return cmdUninstall(ctx, io, { keepLinks: values['keep-links'] ?? false });
      default:
        io.err(`unknown command '${cmd}'\n\n${HELP}`);
        return 1;
    }
  } catch (e) {
    io.err(`error: ${(e as Error).message}`);
    return 1;
  }
}

// Direct execution: `node src/cli.ts …` (dev) or via bin/agentunison.js (dist).
const invokedDirectly = process.argv[1] && /[\\/]cli\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
