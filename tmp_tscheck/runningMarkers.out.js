function createRunningMarkers(deps) {
  const existsViaFs = deps.existsViaFs;
  const runProbe = deps.runProbe;
  const paths = Array.isArray(deps.paths) ? deps.paths : [];
  async function read(gitDir, probeCtx) {
    const dir = String(gitDir || "").replace(/[\\/]+$/, "");
    const out = { merging: false, rebasing: false, cherryPicking: false, reverting: false };
    let fsDetail = "";
    for (const rel of paths) {
      let hit = null;
      try {
        hit = await existsViaFs(dir + "/" + rel);
      } catch (e) {
        fsDetail = String(e && e.message || e);
        hit = null;
      }
      if (hit === null) {
        let viaGit = null;
        try {
          viaGit = await runProbe(rel, probeCtx);
        } catch (e) {
          if (fsDetail === "") fsDetail = String(e && e.message || e);
        }
        if (viaGit === true) hit = true;
        else if (viaGit === false) hit = false;
        else return { ok: false, kind: "env-fs", detail: fsDetail || (typeof deps.getFsDetail === "function" ? String(deps.getFsDetail() || "") : "") || "\u6587\u4EF6\u670D\u52A1\u4E0E git \u515C\u5E95\u90FD\u6CA1\u7ED9\u51FA\u7ED3\u8BBA" };
      }
      if (!hit) continue;
      if (rel === "MERGE_HEAD") out.merging = true;
      else if (rel === "CHERRY_PICK_HEAD") out.cherryPicking = true;
      else if (rel === "REVERT_HEAD") out.reverting = true;
      else out.rebasing = true;
    }
    return { ok: true, markers: out };
  }
  return { read };
}
const RUNNING_MARKERS_SOURCE = "src/host/runningMarkers.js";
export {
  RUNNING_MARKERS_SOURCE,
  createRunningMarkers
};
