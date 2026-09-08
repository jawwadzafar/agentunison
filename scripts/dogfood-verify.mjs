#!/usr/bin/env node
// CI dogfood gate: the product repo must verify clean.
//
// `agentunison verify` exits 4 for every issue class (design: 004 §exit codes), including
// `environment` — findings that describe the CHECKOUT, not the repo (e.g. a committed symlink
// materialized as a text file on a core.symlinks=false checkout, as on GitHub's Windows
// runners without Developer Mode). This gate fails on anything that is not environment-only:
// drift, block-damaged, invariant, spec, or a failed live probe are real defects.
import { spawnSync } from 'node:child_process';

const res = spawnSync(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', 'bin/agentunison.js', 'verify', '--json'],
  { encoding: 'utf8' },
);
if (res.error) { console.error('dogfood: failed to run verify:', res.error.message); process.exit(1); }

let report;
try { report = JSON.parse(res.stdout); } catch {
  console.error('dogfood: verify did not emit JSON\n', res.stdout, res.stderr);
  process.exit(res.status ?? 1);
}

if (report.ok) { console.log('dogfood: verify clean'); process.exit(0); }

const codes = [...new Set((report.issues ?? []).map((i) => i.code))];
const environmentOnly = res.status === 4 && codes.length > 0 && codes.every((c) => c === 'environment');
if (environmentOnly) {
  console.log('dogfood: verify reports checkout limitations only (environment) — tolerated on symlink-hostile checkouts:');
  for (const i of report.issues) console.log(`  [environment] ${i.path ?? ''} ${i.message}`);
  process.exit(0);
}

console.error(`dogfood: verify failed (exit ${res.status}, codes: ${codes.join(', ') || 'none'})`);
for (const i of report.issues ?? []) console.error(`  [${i.code}] ${i.path ?? ''} ${i.message}`);
process.exit(res.status ?? 1);
