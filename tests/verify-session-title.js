// tests/verify-session-title.js — #210/#205 会话标题契约 12 例（真源：src/shared/naming-guardian.js，#265 迁移）
// 用法: node tests/verify-session-title.js
const fs = require('fs');
const path = require('path');

let failed = false;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) failed = true; };
const eq = (a, b, msg) => {
  const cond = a === b;
  if (!cond) console.log('    expected: ' + JSON.stringify(b) + '\n    actual  : ' + JSON.stringify(a));
  ok(cond, msg);
};

// ---- 1) 文件级契约：共享核心含所需导出与正则（#265 起命名真源 = src/shared/naming-guardian.js）----
const corePath = path.join(__dirname, '..', 'src/shared/naming-guardian.js');
const src = fs.readFileSync(corePath, 'utf8');
ok(src.includes('SESSION_TITLE_MAX_BYTES'), 'naming-guardian.js 含 SESSION_TITLE_MAX_BYTES');
ok(src.includes('SESSION_TITLE_RE'), 'naming-guardian.js 含 SESSION_TITLE_RE');
ok(src.includes('cleanTitleText'), 'naming-guardian.js 含 cleanTitleText');
ok(src.includes('truncateTitleUtf8'), 'naming-guardian.js 含 truncateTitleUtf8');
ok(src.includes('newSessionTitle'), 'naming-guardian.js 含 newSessionTitle');
ok(!src.includes("SESSION_TITLE_PREFIX = '[MattSkills]'"), '无 [MattSkills] 旧前缀');
ok(src.includes('SESSION_TITLE_MAX_BYTES = 120'), 'MAX_BYTES=120');
ok(src.includes('/^\\[#\\d+\\] .+/'), '#n 正则存在');
ok(src.includes('…'), '截断用 … 省略号');

// router.js 侧确认已迁空（无第二处真源）
const routerSrc = fs.readFileSync(path.join(__dirname, '..', 'src/client/kernel/router.js'), 'utf8');
ok(!/export\s+(const|function)\s+(SESSION_TITLE_MAX_BYTES|cleanTitleText|newSessionTitle)\b/.test(routerSrc), 'router.js 已不再声明标题真源（#265 迁移）');

(async () => {
  // ---- 2) 功能级：直接复跑共享核心实现（与产物同源的同一份文本）----
  const m = await import('../src/shared/naming-guardian.js');
  const cleanTitleText = m.cleanTitleText;
  const utf8Bytes = m.utf8Bytes;
  const truncateTitleUtf8 = m.truncateTitleUtf8;
  const SESSION_TITLE_MAX_BYTES = m.SESSION_TITLE_MAX_BYTES;
  const SESSION_TITLE_RE = m.SESSION_TITLE_RE;
  const SESSION_TITLE_RE_ALLOW_BARE = m.SESSION_TITLE_RE_ALLOW_BARE;
  const newSessionTitle = m.newSessionTitle;

  ok(cleanTitleText('a \u200B b') === 'a b', 'cleanTitle 剥隐形字符（核心实现冒烟）');

  // ---- 12 例用例表（#205）----
  const cases = [
    { id: 1, cat: '正常', input: {number:123, title:'修复登录闪退'}, expect: '[#123] 修复登录闪退', check: '正则匹配、单空格、中文保留' },
    { id: 2, cat: '正常', input: {number:7, title:'Add workspace backend'}, expect: '[#7] Add workspace backend', check: '英文原大小写保留' },
    { id: 3, cat: '正常', input: {number:198, title:'全新工作区后端优先'}, expect: '[#198] 全新工作区后端优先', check: 'Map 推进前缀同规则' },
    { id: 4, cat: '边界', input: {number:1, title:''}, expect: '[#1]', check: '空标题回退仅前缀' },
    { id: 5, cat: '边界', input: {number:42, title:'   前后空格   '}, expect: '[#42] 前后空格', check: 'trim 生效' },
    { id: 6, cat: '边界', input: {number:999, title:'a'}, expect: '[#999] a', check: '最短标题' },
    { id: 7, cat: '超长', input: {number:123, title:'A'.repeat(200)}, expect: null, check: '120 bytes 预算，前缀永不截断，title 尾截 + …' },
    { id: 8, cat: '超长', input: {number:12345, title:'中文标题'.repeat(30)}, expect: null, check: '多字节按 UTF-8 字节截断不拆 code point' },
    { id: 9, cat: '超长', input: {number:5, title:'x'.repeat(116)}, expect: null, check: '边界按字节预算截断或不截断(116x+5>120应截断)' },
    { id:10, cat: '特殊', input: {number:10, title:'a\n\tb  \n c'}, expect: '[#10] a b c', check: '换行/Tab/多空格归一' },
    { id:11, cat: '特殊', input: {number:11, title:'标题含 [#99] 与 #hash [bracket]'}, expect: '[#11] 标题含 [#99] 与 #hash [bracket]', check: '标题内 #/[] 保留' },
    { id:12, cat: '特殊', input: {number:12, title:'emoji 🚀\x00控制\u200B隐形\x1B[31m红字'}, expect: '[#12] emoji 🚀 控制 隐形 红字', check: '控制/隐形/ANSI 剥离，emoji 保留' },
  ];

  for (const c of cases) {
    const out = newSessionTitle(c.input);
    if (c.id === 7) {
      const bytes = utf8Bytes(out);
      ok(bytes <= SESSION_TITLE_MAX_BYTES, "#7 超长 ≤120 bytes (got " + bytes + ") — " + c.check);
      ok(out.endsWith('…'), '#7 以 … 结尾');
      ok(out.startsWith('[#123] '), '#7 前缀正确');
      ok(SESSION_TITLE_RE.test(out), '#7 正则匹配');
    } else if (c.id === 8) {
      const bytes = utf8Bytes(out);
      ok(bytes <= SESSION_TITLE_MAX_BYTES, "#8 超长多字节 ≤120 bytes (got " + bytes + ") — " + c.check);
      ok(out.endsWith('…'), '#8 以 … 结尾');
      ok(out.startsWith('[#12345] '), '#8 前缀正确');
      ok(!out.includes('\uFFFD'), '#8 不拆 code point');
      ok(SESSION_TITLE_RE.test(out), '#8 正则匹配');
    } else if (c.id === 9) {
      const bytes = utf8Bytes(out);
      ok(bytes <= SESSION_TITLE_MAX_BYTES, "#9 边界 ≤120 bytes (got " + bytes + ")");
      ok(out.startsWith('[#5] '), '#9 前缀正确');
      ok(SESSION_TITLE_RE.test(out) || SESSION_TITLE_RE_ALLOW_BARE.test(out), '#9 正则匹配');
    } else if (c.id === 12) {
      ok(out.includes('emoji 🚀'), '#12 含 emoji');
      ok(out.includes('控制'), '#12 含 控制');
      ok(out.includes('隐形'), '#12 含 隐形');
      ok(out.includes('红字'), '#12 含 红字');
      ok(!out.includes('\x1B'), '#12 无 ESC');
      ok(!out.includes('\u200B'), '#12 无隐形字符');
      ok(out.startsWith('[#12] '), '#12 前缀');
      ok(SESSION_TITLE_RE.test(out), '#12 正则');
    } else {
      eq(out, c.expect, "#" + c.id + " " + c.cat + " — " + c.check);
      if (c.expect && c.expect !== '[#1]') ok(SESSION_TITLE_RE.test(out), "#" + c.id + " 正则匹配");
      else ok(SESSION_TITLE_RE_ALLOW_BARE.test(out), "#" + c.id + " 空标题 bare 正则");
    }
  }

  // ---- 3) 草稿档合成补测（#265 新契约）----
  eq(m.composeDraftTitle({ hint: '', lang: 'zh' }), '[草稿]', '裸档 zh');
  eq(m.composeDraftTitle({ hint: null, lang: 'en' }), '[Draft]', '裸档 en');
  ok(utf8Bytes(m.composeDraftTitle({ hint: '中'.repeat(200), lang: 'en' })) <= SESSION_TITLE_MAX_BYTES, 'Draft 多字节 ≤120 bytes');
  for (const s of ['[New] 新建需求', '[New] 新建 Bug', '[New] New Requirement', '[New] New Bug']) ok(m.isPlaceholderTitle(s), '占位四式识别: ' + s);
  ok(!m.isPlaceholderTitle('[草稿] x'), '草稿非占位');

  console.log(failed ? '\n存在失败' : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
