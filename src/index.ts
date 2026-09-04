// Library surface (stable within schema 1).
export * from './model/types.ts';
export { buildCtx, pipeline, cmdInit, cmdInspect, cmdAudit, cmdPlan, cmdApply, cmdVerify, cmdDoctor, cmdUninstall } from './commands/index.ts';
export { loadMatrix, evidenceTag, verifiedFor } from './matrix/loader.ts';
export { probePlatform } from './matrix/probe.ts';
export { scanInventory } from './inventory/scan.ts';
export { runAudit } from './audit/rules.ts';
export { decideProjections } from './policy/decide.ts';
export { buildPlan } from './plan/build.ts';
export { applyPlan } from './apply/engine.ts';
export { verifyStructural } from './verify/structural.ts';
export { verifyLive } from './verify/live.ts';
