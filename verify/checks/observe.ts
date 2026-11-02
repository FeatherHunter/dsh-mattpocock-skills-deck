// Small constructors shared by the plugin checks. The base contract only has
// ok/detail plus optional expected/actual/hint; status is decided by the runner.
import type { CheckObservation } from "dsh-featherhunter-plugin-base/real-machine-verification";

export function passed(detail: string): CheckObservation {
  return { ok: true, detail };
}

export function failed(detail: string, expected: string, actual: string, hint: string): CheckObservation {
  return { ok: false, detail, expected, actual, hint };
}
