#!/usr/bin/env node
// Published entry: runs the compiled CLI. During development use `npm run dev` (runs src/cli.ts directly).
import { main } from '../dist/cli.js';
main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
