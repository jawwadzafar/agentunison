import type { Ledger, Manifest, PlatformInfo } from './types.ts';
import type { Matrix } from '../matrix/loader.ts';

/** Everything the pure pipeline stages need; built once per command. */
export interface Ctx {
  root: string;
  matrix: Matrix;
  manifest: Manifest | undefined;   // undefined on a repo that has never been initialized
  ledger: Ledger;
  platform: PlatformInfo;
  localMechanisms: Record<string, string>;
}
