// 一次性真机验证声明：与 verify/profile.ts 相同，只把浏览器适配器换成有头的那一份。
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
  model: false,
  browser: { module: "verify/probe-browser-headed.mjs" },
  ticketFace: { module: "verify/ticket-face.mts" },
  workspaceBackends: ["gitlab", "github", "markdown", "cold", "ab"],
  build: { command: "node ../verify/build.mjs --pkg-only", timeoutMs: 900000 },
  instanceEnvAllowlist: ["GLAB_CONFIG_DIR", "GITLAB_TOKEN", "GLAB_BIN"],
  checks: pluginChecks,
});
