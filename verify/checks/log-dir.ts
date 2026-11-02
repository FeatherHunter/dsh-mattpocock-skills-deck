// log-dir: the plugin writes logs under <profile>/.dsh-mattskillsdeck-cache/logs,
// and the verification is only useful if that directory can be written and the
// file for today can be named. The probe is tiny and removes itself. When
// DSH_HOME is the real home, the probe is skipped: that tree is read-only for
// this capability, and the batch-home sequence is what proves writability.
import { join, resolve } from "node:path";
import type { CheckObservation, CustomCheck, SelfCheckContext } from "dsh-featherhunter-plugin-base/real-machine-verification";
import { failed, passed } from "./observe.ts";

function normalize(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export const logDirCheck: CustomCheck<SelfCheckContext> = {
  id: "log-dir",
  title: "the plugin log directory is writable and today log file can be located",
  hard: true,
  async run(context): Promise<CheckObservation> {
    const dir = join(context.profileDir, ".dsh-mattskillsdeck-cache", "logs");
    const realHome = normalize(join(context.ports.env.homeDir(), ".dsh"));
    if (normalize(context.dshHome) === realHome) {
      return passed("DSH_HOME is the real home, so the write probe was skipped by policy; log directory would be " + dir);
    }
    const made = await context.ports.fs.makeDir(dir);
    if (!made.ok) {
      return failed(
        "could not create the log directory: " + made.error.message,
        "the log directory exists or can be created",
        dir,
        "check that the batch home is writable and DSH_HOME points at it",
      );
    }
    const probe = join(dir, ".verify-write-probe-" + String(process.pid) + ".tmp");
    const written = await context.ports.fs.writeText(probe, "probe " + context.ports.clock.iso() + "\n");
    if (!written.ok) {
      return failed(
        "the log directory is not writable: " + written.error.message,
        "a probe file can be written and removed under " + dir,
        written.error.message,
        "check filesystem permissions on the batch home",
      );
    }
    await context.ports.fs.remove(probe);
    const today = context.ports.clock.iso().slice(0, 10);
    const todayFile = join(dir, today + ".log");
    const present = await context.ports.fs.exists(todayFile);
    return passed(
      "log directory is writable: " + dir + "; today file " + today + ".log " + (present ? "exists" : "has not been created yet (no instance has run)"),
    );
  },
};
