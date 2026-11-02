// workspace-fixture: a prepared workspace must be a real git repository with a
// version-2 binding whose backendId this plugin knows. It is soft because a
// fresh machine legitimately has no fixture; when one is present, a mismatch is
// reported (and points at the fixture builder) without failing self-check.
import { join, resolve } from "node:path";
import type { CheckObservation, CustomCheck, SelfCheckContext } from "dsh-featherhunter-plugin-base/real-machine-verification";
import { failed, passed } from "./observe.ts";

const BINDING_RELATIVE = join("docs", "agents", "workspace.yaml");

function fixtureCandidates(context: SelfCheckContext): string[] {
  const configured = context.ports.env.get("DSH_VERIFY_WORKSPACE_DIR");
  const candidates: string[] = [];
  if (configured !== undefined && configured.trim() !== "") candidates.push(resolve(context.cwd, configured.trim()));
  candidates.push(join(context.cwd, ".scratch", "verify-workspace"));
  candidates.push(join(context.cwd, ".scratch", "workspace"));
  candidates.push(join(context.cwd, "fixtures", "workspace"));
  return candidates;
}

export const workspaceFixtureCheck: CustomCheck<SelfCheckContext> = {
  id: "workspace-fixture",
  title: "the prepared workspace is a git repository with a known backend binding",
  hard: false,
  async run(context): Promise<CheckObservation> {
    let workspaceDir: string | null = null;
    for (const candidate of fixtureCandidates(context)) {
      if (await context.ports.fs.exists(join(candidate, BINDING_RELATIVE))) { workspaceDir = candidate; break; }
      if (await context.ports.fs.exists(join(candidate, ".git"))) { workspaceDir = candidate; break; }
    }
    if (workspaceDir === null) {
      return passed("no workspace fixture present; soft check skipped (set DSH_VERIFY_WORKSPACE_DIR to point at one)");
    }
    const problems: string[] = [];
    const gitStat = await context.ports.fs.stat(join(workspaceDir, ".git"));
    if (!gitStat.ok) {
      problems.push("no .git entry at " + join(workspaceDir, ".git"));
    } else if (gitStat.value.kind !== "directory" && gitStat.value.kind !== "file") {
      problems.push(".git is a " + gitStat.value.kind + ", not a directory or worktree file");
    }
    const bindingPath = join(workspaceDir, BINDING_RELATIVE);
    const read = await context.ports.fs.readText(bindingPath);
    let backendId = "";
    if (!read.ok) {
      problems.push("workspace.yaml is missing or unreadable at " + bindingPath);
    } else {
      const match = /^backendId:\s*(\S+)/m.exec(read.value);
      backendId = match === null ? "" : match[1];
      if (backendId === "") problems.push("workspace.yaml has no backendId line");
      else if (!context.profile.workspaceBackends.includes(backendId)) {
        problems.push("backendId " + backendId + " is not one of " + context.profile.workspaceBackends.join(", "));
      }
    }
    if (problems.length > 0) {
      return failed(
        problems.join("; "),
        "a git repository whose docs/agents/workspace.yaml names one of " + context.profile.workspaceBackends.join(", "),
        "workspace " + workspaceDir + " (backendId " + (backendId || "unknown") + ")",
        "rebuild the fixture with the old scripts/real-machine workspace command, or point DSH_VERIFY_WORKSPACE_DIR at a valid one",
      );
    }
    return passed("workspace " + workspaceDir + " is a git repository bound to backendId " + backendId);
  },
};
