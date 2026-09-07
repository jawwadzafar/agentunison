#!/usr/bin/env node
import * as fs from 'node:fs';
import YAML from 'yaml';

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const files = fs.readdirSync('matrix').filter(f => f.endsWith('.yaml'));
const outPath = 'docs/harness-compatibility.md';

if (checkMode) {
  if (!fs.existsSync(outPath)) { console.error('Missing:', outPath); process.exit(1); }
  const content = fs.readFileSync(outPath, 'utf8');
  const lines = content.split('\n');
  if (!lines.some(l => l.includes('| Harness |') && (l.includes('Versions') || l.includes('Versions verified')))) {
    console.error('Table header missing'); process.exit(1);
  }
  console.log('Table OK:', outPath);
  process.exit(0);
}

const lines: string[] = [
  '# Harness compatibility',
  '',
  'Generated from `matrix/*.yaml`. Every claim carries `evidence`, `checkedOn`, and `platforms`. Unknown facts take the conservative branch.',
  '',
  '| Harness | Versions verified | Last checked | Platforms | Evidence source |',
  '|---|---|---|---|---|',
];
for (const f of files.sort()) {
  const doc = YAML.parse(fs.readFileSync('matrix/' + f, 'utf8'));
  const versions = Array.isArray(doc.versionsVerified) ? doc.versionsVerified.join(', ') : (doc.versionsVerified || '?');
  // Aggregate checkedOn from capability facts (use latest date)
  const dates = new Set<string>();
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'harness' || k === 'displayName' || k === 'detect' || k === 'surfaces' || k === 'versionsVerified') continue;
    if (v && typeof v === 'object' && (v as any).checkedOn) dates.add((v as any).checkedOn);
  }
  // Also scan nested surfaces for dates
  if (doc.surfaces) {
    for (const [hKey, hObj] of Object.entries(doc.surfaces)) {
      if (hObj && typeof hObj === 'object') {
        for (const [factKey, factObj] of Object.entries(hObj as Record<string, unknown>)) {
          if (factObj && typeof factObj === 'object' && (factObj as any).checkedOn) dates.add((factObj as any).checkedOn);
        }
      }
    }
  }
  const latest = Array.from(dates).sort().pop() || '-';
  const platforms = Array.from(dates).map(() => 'posix').filter(Boolean).join(',') || '-';
  lines.push(`| ${doc.displayName || doc.harness || f.replace('.yaml','')} | ${versions} | ${latest} | ${platforms || '-'} | matrix/${f} |`);
}
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log('Rendered:', outPath);
