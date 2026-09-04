import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpRepo, silentIO } from '../helpers/repo.ts';
import { buildCtx, cmdInit } from '../../src/commands/index.ts';
import { verifyLive, whichBinary } from '../../src/verify/live.ts';

const LIVE = process.env['AGENTUNISON_LIVE'] === '1';

test('live: installed harnesses see the canonical instructions and skills', { skip: LIVE ? false : 'set AGENTUNISON_LIVE=1 to run against installed harness binaries' }, () => {
  const r = tmpRepo('ac-live-');
  fs.mkdirSync(path.join(r, '.agents/skills/probe-skill'), { recursive: true });
  fs.writeFileSync(path.join(r, '.agents/skills/probe-skill/SKILL.md'), '---\nname: probe-skill\ndescription: Use when probing agentunison live verification.\n---\nProbe.\n');
  cmdInit(buildCtx(r), silentIO, { targets: ['claude', 'codex', 'opencode'], approve: [], yes: true, allowDelete: false });
  const results = verifyLive(buildCtx(r), { allowApiCalls: process.env['AGENTUNISON_LIVE_API'] === '1' });
  for (const res of results) {
    const installed = !!whichBinary(res.harness === 'claude' ? 'claude' : res.harness);
    if (!installed) { assert.equal(res.status, 'not-installed'); continue; }
    if (res.harness === 'claude' && process.env['AGENTUNISON_LIVE_API'] !== '1') { assert.equal(res.status, 'structural-only'); continue; }
    assert.equal(res.status, 'verified', `${res.harness}: ${res.detail}`);
  }
});
