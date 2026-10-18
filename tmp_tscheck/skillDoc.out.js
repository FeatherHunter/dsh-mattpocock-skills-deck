function createSkillDoc(deps) {
  const MAX_BYTES = 2e5;
  function validName(n) {
    return typeof n === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n);
  }
  function stripFrontmatter(raw) {
    const s = String(raw || "").replace(/^\uFEFF/, "");
    const m = s.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!m) return s;
    return s.slice(m[0].length);
  }
  async function findCardPath(name) {
    const pathMod = await import("node:path");
    const fsSync = await import("node:fs");
    const osMod = await import("node:os");
    const candidates = [];
    try {
      const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? String(process.cwd() || "") : "";
      if (cwd) {
        candidates.push(pathMod.resolve(cwd, "package/bundled-skills"));
        candidates.push(pathMod.resolve(cwd, "../package/bundled-skills"));
        candidates.push(pathMod.resolve(cwd, "../../package/bundled-skills"));
        let cur = cwd;
        for (let i = 0; i < 4; i++) {
          candidates.push(pathMod.join(cur, "package/bundled-skills"));
          candidates.push(pathMod.join(cur, "node_modules/dsh-mattpocock-skills-deck/bundled-skills"));
          cur = pathMod.dirname(cur);
        }
      }
    } catch {
    }
    try {
      const home = osMod.homedir();
      if (home) {
        candidates.push(pathMod.join(home, ".dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/bundled-skills"));
        candidates.push(pathMod.join(home, ".dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/bundled-skills"));
      }
    } catch {
    }
    const seen = /* @__PURE__ */ new Set();
    for (const c of candidates) {
      const n = pathMod.normalize(c);
      if (seen.has(n)) continue;
      seen.add(n);
      const file = pathMod.join(n, name, "SKILL.md");
      try {
        const st = fsSync.statSync(file);
        if (st && st.isFile()) return file;
      } catch {
      }
    }
    return null;
  }
  async function readDoc(args) {
    const name = args && args.name;
    if (!validName(name)) return { ok: false, missing: true };
    try {
      const file = await findCardPath(name);
      if (!file) return { ok: false, missing: true };
      const fsp = await import("node:fs/promises");
      const raw = await (fsp.default || fsp).readFile(file, "utf8");
      if (raw == null || raw.length > MAX_BYTES) return { ok: false, missing: true };
      const md = stripFrontmatter(raw);
      if (!md || !md.trim()) return { ok: false, missing: true };
      let mdZh = null;
      let pathZh = null;
      try {
        const zhFile = file.replace(/SKILL\.md$/, "SKILL.zh.md");
        const rawZh = await (fsp.default || fsp).readFile(zhFile, "utf8");
        const z = stripFrontmatter(rawZh);
        if (z && z.trim() && z.length <= MAX_BYTES) {
          mdZh = z;
          pathZh = zhFile;
        }
      } catch {
      }
      return { ok: true, md, path: file, mdZh, pathZh };
    } catch {
      return { ok: false, missing: true };
    }
  }
  return { readDoc };
}
export {
  createSkillDoc
};
