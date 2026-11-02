// sandbox-project: when a batch names a GitLab sandbox project, its description
// must still carry the batch marker. Self-check has no batch object, so without
// an explicit project id this soft check has nothing to observe and says so.
import type { CheckObservation, CustomCheck, SelfCheckContext } from "dsh-featherhunter-plugin-base/real-machine-verification";
import { failed, passed } from "./observe.ts";

const PROJECT_ENV_NAMES = ["DSH_VERIFY_SANDBOX_PROJECT", "GITLAB_SANDBOX_PROJECT", "DSH_SANDBOX_PROJECT"];

function sandboxProject(context: SelfCheckContext): string | null {
  for (const name of PROJECT_ENV_NAMES) {
    const value = context.ports.env.get(name);
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return null;
}

export const sandboxProjectCheck: CustomCheck<SelfCheckContext> = {
  id: "sandbox-project",
  title: "the named GitLab sandbox project still carries the batch marker",
  hard: false,
  async run(context): Promise<CheckObservation> {
    const project = sandboxProject(context);
    if (project === null) {
      return passed("no sandbox project named; soft check skipped (set DSH_VERIFY_SANDBOX_PROJECT to a group/project path)");
    }
    const configured = context.ports.env.get("GLAB_BIN");
    const bin = configured !== undefined && configured.trim() !== "" ? configured.trim() : "glab";
    const result = await context.ports.command.run({
      argv: [bin, "api", "projects/" + encodeURIComponent(project)],
      cwd: context.cwd,
      timeoutMs: 20000,
    });
    if (!result.ok) {
      return failed(
        "could not start " + bin + " to read the sandbox project: " + result.error.message,
        "glab api projects/<project> returns the project description",
        result.error.message,
        "install glab and authenticate it, or unset DSH_VERIFY_SANDBOX_PROJECT for a batch without GitLab",
      );
    }
    if (result.value.exitCode !== 0) {
      return failed(
        bin + " api projects/" + project + " exited " + String(result.value.exitCode),
        "the sandbox project is readable and marked with [dsh-sandbox",
        (result.value.stderr || result.value.stdout).trim().slice(0, 400) || "(no output)",
        "check glab authentication and the project path",
      );
    }
    let description = "";
    try {
      const parsed = JSON.parse(result.value.stdout) as Record<string, unknown>;
      description = typeof parsed.description === "string" ? parsed.description : "";
    } catch {
      return failed(
        "glab api returned a non-JSON project payload",
        "a JSON project object",
        result.value.stdout.trim().slice(0, 200) || "(empty)",
        "check the glab version and the project path",
      );
    }
    if (!description.includes("[dsh-sandbox")) {
      return failed(
        "project " + project + " has no [dsh-sandbox marker in its description",
        "a description containing [dsh-sandbox batch=...]",
        description.slice(0, 300) || "(empty description)",
        "recreate the sandbox project with the old scripts/real-machine prepare command",
      );
    }
    return passed("project " + project + " carries a [dsh-sandbox marker");
  },
};
