// The plugin checks appended to the base self-check plan. Order is the order a
// reader sees in the report: environment tools first, then batch data, then the
// workspace fixture, then the plugin log directory.
import { glabCheck } from "./glab-available.ts";
import { sandboxProjectCheck } from "./sandbox-project.ts";
import { ticketPoolCheck } from "./ticket-pool.ts";
import { workspaceFixtureCheck } from "./workspace-fixture.ts";
import { logDirCheck } from "./log-dir.ts";

export const pluginChecks = [
  glabCheck,
  sandboxProjectCheck,
  ticketPoolCheck,
  workspaceFixtureCheck,
  logDirCheck,
];
