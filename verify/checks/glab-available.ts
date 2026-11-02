// glab-available: the GitLab CLI must exist before any GitLab batch can seed or
// read back a project. This is deliberately a hard check: a missing tool makes
// every later GitLab finding meaningless, so self-check exits non-zero with an
// install hint instead of quietly reporting a soft failure.
import type { CheckObservation, CustomCheck, SelfCheckContext } from "dsh-featherhunter-plugin-base/real-machine-verification";
import { failed, passed } from "./observe.ts";

const INSTALL_HINT = "Install the GitLab CLI and put glab on PATH, or set GLAB_BIN to its absolute path. See https://gitlab.com/gitlab-org/cli#installation";

export const glabCheck: CustomCheck<SelfCheckContext> = {
  id: "glab-available",
  title: "the GitLab CLI (glab) is available",
  hard: true,
  async run(context): Promise<CheckObservation> {
    const configured = context.ports.env.get("GLAB_BIN");
    const bin = configured !== undefined && configured.trim() !== "" ? configured.trim() : "glab";
    const result = await context.ports.command.run({
      argv: [bin, "--version"],
      cwd: context.cwd,
      timeoutMs: 10000,
    });
    if (!result.ok) {
      return failed(
        "could not start " + bin + ": " + result.error.message,
        "glab --version exits 0",
        result.error.message,
        INSTALL_HINT,
      );
    }
    const outcome = result.value;
    const text = (outcome.stdout.trim() !== "" ? outcome.stdout : outcome.stderr).trim();
    if (outcome.exitCode !== 0) {
      return failed(
        bin + " --version exited " + String(outcome.exitCode === null ? "on a signal" : outcome.exitCode),
        "glab --version exits 0",
        text.slice(0, 400) || "(no output)",
        INSTALL_HINT,
      );
    }
    const firstLine = text.split(/\r?\n/)[0] || "(no version text)";
    return passed(bin + " --version -> " + firstLine);
  },
};
