// ticket-pool: the seed planner still plans the documented shape (101 tickets,
// 5 closed, 2 maps, 5 map children, 8 blocking pairs). Phase A keeps the old
// scripts, so this check reads the planner defaults from the command source;
// that makes a drifted default visible without starting GitLab or the plugin.
import { join } from "node:path";
import type { CheckObservation, CustomCheck, SelfCheckContext } from "dsh-featherhunter-plugin-base/real-machine-verification";
import { failed, passed } from "./observe.ts";

const EXPECTED: Readonly<Record<string, number>> = {
  "ticket-count": 101,
  closed: 5,
  maps: 2,
  children: 5,
  blocking: 8,
};

const SOURCE_RELATIVE = join("scripts", "real-machine", "commands", "seed-gitlab.mts");

function numberOrDefault(source: string, flag: string): number | null {
  const pattern = new RegExp("intFlag\\(args,\\s*[\'\"]" + flag + "[\'\"]\\s*,\\s*(\\d+)");
  const match = pattern.exec(source);
  return match === null ? null : Number(match[1]);
}

export const ticketPoolCheck: CustomCheck<SelfCheckContext> = {
  id: "ticket-pool",
  title: "the GitLab seed planner keeps the documented ticket pool shape",
  hard: true,
  async run(context): Promise<CheckObservation> {
    const candidates = [join(context.cwd, SOURCE_RELATIVE), join(context.cwd, "..", SOURCE_RELATIVE)];
    let source: string | null = null;
    let sourcePath = candidates[0];
    for (const candidate of candidates) {
      const read = await context.ports.fs.readText(candidate);
      if (read.ok) {
        source = read.value;
        sourcePath = candidate;
        break;
      }
    }
    if (source === null) {
      return failed(
        "the seed planner source was not found",
        "scripts/real-machine/commands/seed-gitlab.mts is readable from the repository root",
        "looked in " + candidates.join(" and "),
        "run self-check from the plugin repository root, or update this check if the old scripts moved",
      );
    }
    const actual: Record<string, number | null> = {};
    const problems: string[] = [];
    for (const [flag, expected] of Object.entries(EXPECTED)) {
      const value = numberOrDefault(source, flag);
      actual[flag] = value;
      if (value !== expected) {
        problems.push("--" + flag + " is " + (value === null ? "missing" : String(value)) + ", expected " + String(expected));
      }
    }
    if (problems.length > 0) {
      return failed(
        problems.join("; "),
        "101 tickets / 5 closed / 2 maps / 5 children / 8 blocking pairs",
        JSON.stringify(actual),
        "restore the planner defaults in " + sourcePath + ", or update verify/checks/ticket-pool.ts and the analysis if the pool shape intentionally changed",
      );
    }
    return passed("seed defaults match: 101 tickets / 5 closed / 2 maps / 5 children / 8 blocking pairs (" + sourcePath + ")");
  },
};
