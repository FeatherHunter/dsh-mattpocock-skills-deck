function createMapBody() {
  function normalizeBody(raw) {
    let s = String(raw || "").replace(/^\uFEFF/, "");
    const realNL = (s.match(/\n/g) || []).length;
    const literalNL = (s.match(/\\n/g) || []).length;
    if (realNL < 2 && literalNL > 0) {
      s = s.replace(/\\n/g, "\n");
    }
    return s;
  }
  function parseMapBody(body) {
    var MAP_SECTION_TITLES = ["Destination", "Notes", "Decisions so far", "Not yet specified", "Out of scope"];
    function splitGluedHeadings(text) {
      var splitLines = String(text || "").split(/\r?\n/);
      var splitOut = [];
      var fence = null;
      var titles = MAP_SECTION_TITLES.map(function(t) {
        return t.replace(/ /g, "\\s+");
      }).join("|");
      var gluedRe = new RegExp("^(.*\\S)\\s*##\\s*(" + titles + ")\\s*$");
      for (var i = 0; i < splitLines.length; i++) {
        var line = splitLines[i];
        var fm = line.match(/^\s*(`{3,}|~{3,})/);
        if (fm) {
          var marker = fm[1][0];
          if (fence === null) fence = marker;
          else if (marker === fence) fence = null;
          splitOut.push(line);
          continue;
        }
        if (fence !== null) {
          splitOut.push(line);
          continue;
        }
        var m = line.match(gluedRe);
        if (m) {
          splitOut.push(m[1]);
          splitOut.push("## " + m[2].replace(/\s+/g, " ").trim());
          continue;
        }
        splitOut.push(line);
      }
      return splitOut.join("\n");
    }
    function truncateGist(gist) {
      var LIMIT = 240;
      var s = String(gist || "");
      if (s.length <= LIMIT) return s;
      var head = s.slice(0, LIMIT);
      var lastBlank = head.search(/\s+\S*$/);
      var kept = (lastBlank > 0 ? head.slice(0, lastBlank) : head).replace(/\s+$/, "");
      return (kept === "" ? head : kept) + "\u2026";
    }
    function parseDecisionLine(l) {
      if (l.indexOf("- [") === 0) {
        var t = l.match(/\[(.+?)\]\((.+?)\)/);
        var g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-–—]?\s*/, "");
        return { title: t ? t[1] : l, url: t ? t[2] : "", gist: truncateGist(g) };
      }
      var b = l.match(/^-\s*\*\*(.+?)\*\*\s*[:：-]?\s*(.*)$/);
      if (b) {
        var inner = b[1];
        var bt = inner.match(/\[(.+?)\]\((.+?)\)/);
        var title = bt ? inner.replace("[" + bt[1] + "](" + bt[2] + ")", bt[1]) : inner;
        return { title, url: bt ? bt[2] : "", gist: truncateGist(b[2]) };
      }
      return null;
    }
    const out = { destination: "", notes: "", decisions: [], fog: [], outOfScope: [] };
    if (!body) return out;
    const sec = {};
    const lines = splitGluedHeadings(normalizeBody(body)).split(/\r?\n/);
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^##\s*(.+?)\s*$/);
      if (m) {
        cur = m[1];
        sec[cur] = sec[cur] || [];
        continue;
      }
      if (cur) sec[cur].push(lines[i]);
    }
    const clean = function(arr) {
      return (arr || []).map(function(s) {
        return s.trim();
      }).filter(Boolean);
    };
    out.destination = clean(sec["Destination"]).join(" ");
    out.notes = clean(sec["Notes"]).join(" ");
    out.decisions = clean(sec["Decisions so far"]).map(parseDecisionLine).filter(function(d) {
      return d !== null;
    });
    out.fog = clean(sec["Not yet specified"]).filter(function(l) {
      return l.indexOf("<!--") !== 0;
    });
    out.outOfScope = clean(sec["Out of scope"]).filter(function(l) {
      return l.indexOf("<!--") !== 0;
    });
    return out;
  }
  function parseProgress(body) {
    if (!body) return null;
    const s = String(body);
    const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im) || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im) || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (isNaN(n)) return null;
    return Math.max(0, Math.min(100, n));
  }
  function mapTicket(raw) {
    const labels = (raw.labels && raw.labels.nodes || []).map(function(x) {
      return x.name;
    });
    let type = "other";
    for (let i = 0; i < labels.length; i++) {
      if (labels[i].indexOf("wayfinder:") === 0) {
        type = labels[i].slice("wayfinder:".length) || "other";
        break;
      }
    }
    const as = raw.assignees && raw.assignees.nodes || [];
    return {
      number: raw.number,
      title: raw.title,
      type,
      state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
      claimedBy: as.length ? as[0].login : "",
      blockedBy: (raw.blockedBy && raw.blockedBy.nodes || []).map(function(b) {
        return b.number;
      }),
      blocks: (raw.blocking && raw.blocking.nodes || []).map(function(b) {
        return b.number;
      }),
      labels,
      url: raw.url,
      progress: parseProgress(raw.body),
      // v1.5 T12：issue 正文进度块（## 进度：N%），null = 未表达
      author: raw.author && raw.author.login ? { login: raw.author.login, name: raw.author.name || "", avatarUrl: raw.author.avatarUrl || raw.author.avatar_url || "" } : raw.user && raw.user.login ? { login: raw.user.login, avatarUrl: raw.user.avatar_url || "" } : void 0
    };
  }
  return { normalizeBody, parseMapBody, parseProgress, mapTicket };
}
export {
  createMapBody
};
