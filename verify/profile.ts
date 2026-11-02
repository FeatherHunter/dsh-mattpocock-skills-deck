// The base real-machine verification profile for this plugin.
//
// This file is imported by the base CLI (Node 22.6+ strips the types). Keep it
// declarative: every value here is read by more than one command, and a wrong
// field name fails parseVerificationProfile before any instance starts.
import { defineVerificationProfile } from "dsh-featherhunter-plugin-base/real-machine-verification";
import { pluginChecks } from "./checks/index.ts";

export default defineVerificationProfile({
  id: "matt-skills-deck",
  packageName: "dsh-mattpocock-skills-deck",
  defaultProfile: "web",
  clientEntry: "lib/client.js",
  pluginCacheDir: ".dsh-mattskillsdeck-cache",
  pluginSettingsDir: "mattskillsdeck",
  bundledSkills: { dir: "package/bundled-skills", expected: 27 },
  // Phase A verifies the plugin without touching model configuration. The old
  // model command and its settings still exist; they are simply out of scope.
  model: false,
  browser: { module: "verify/browser.mjs" },
  // 发布门禁读票面的适配器：gh CLI + git，规则在 base 的 runReleaseGate。
  ticketFace: { module: "verify/ticket-face.mts" },
  workspaceBackends: ["gitlab", "github", "markdown", "cold", "ab"],
  build: { command: "node ../verify/build.mjs --pkg-only", timeoutMs: 900000 },
  instanceEnvAllowlist: ["GLAB_CONFIG_DIR", "GITLAB_TOKEN", "GLAB_BIN"],
  checks: pluginChecks,
});
