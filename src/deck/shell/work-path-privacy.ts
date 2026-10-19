// work-path-privacy.ts —— 新工作路线存档的落盘隐私自检（#1083，口径见 ADR 20261019）。
//
// 旧自检 chainPrivacyViolations 的口径是「含空白就算脏，整份拒绝」。它守住的是「原文不许出去」，
// 但那把尺子对新的存档太长：会话标题、票标题天生带空白（「修 #1083 的落盘」），于是人读得懂的名字
// 全被挡在外面，面板只能显示散列。新存档要的正是这些快照，所以口径换成两步：
//
//   1. **字段白名单**：账上只允许出现固定的一组字段名。字段名是封闭集合，多一个就说明有人往存档里
//      塞了新东西，先把这次写入拦下来，让「加字段」这个动作显式发生（同时改这里与 ADR）。
//   2. **凭证形状检查**：每个字符串值扫一遍令牌、口令、授权头、私钥、带凭据的网址的形状。
//      命中就整份不写 —— 凭证原文永远不进存档，这是硬红线，与仓库日志纪律同口径。
//
// 为什么不是「凭证形状就够」：白名单挡的是结构性的夹带（有人把命令原文整个塞进 title），
// 凭证形状挡的是内容级的泄漏。两道一起才是「允许人读的快照，不允许秘密」。
//
// 注意这不是密码学保证：形状匹配永远有漏网的可能，所以调用方（work-path-store.ts）的字段来源
// 也必须封闭 —— 只从票号、票标题、会话标题、动作、来源这些短字段取值，命令与路径原文不进存档。

/** 账上允许出现的字段名（封闭集合；加字段要同步改这里与 ADR 20261019）。 */
export const PRIVACY_ALLOWED_FIELDS: readonly string[] = [
  'v', 'at', 'backend',
  'workers', 'session', 'label', 'labelAt', 'entries',
  'ticketKey', 'effortId', 'title', 'action', 'actionAt', 'source', 'progress',
];

/** 凭证形状：命中任何一条就当成「这一份里有秘密」，整份不写。 */
const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, '像 GitHub 令牌'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, '像 GitHub 细粒度令牌'],
  [/\bglpat-[A-Za-z0-9_-]{16,}\b/, '像 GitLab 令牌'],
  [/\bsk-[A-Za-z0-9]{16,}\b/, '像 API 密钥'],
  [/\bAKIA[0-9A-Z]{16}\b/, '像云厂商访问密钥'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, '像 Slack 令牌'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '像私钥'],
  [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i, '像授权头里的凭据'],
  [/\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S{6,}/i, '像口令键值'],
  [/[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i, '像带凭据的网址'],
];

/** 这句字符串像不像凭证原文；像就返回一句人能读的说明，不像返回空串。 */
export function credentialKind(text: string): string {
  if (typeof text !== 'string' || text === '') return '';
  for (const [re, why] of CREDENTIAL_PATTERNS) { if (re.test(text)) return why; }
  return '';
}

/**
 * 这一份要落盘的东西有没有问题：返回每一条现场的一句话，空数组 = 干净。
 * 现场路径写到字段级（`$.workers[0].title`），方便日志与定位，但注意这份结果只进本地日志、
 * 不回执给人（回执只写 reason 代号）。
 */
export function privacyViolations(value: unknown): string[] {
  const out: string[] = [];
  const allowed: Record<string, boolean> = {};
  for (const name of PRIVACY_ALLOWED_FIELDS) allowed[name] = true;
  const walk = function (v: unknown, at: string): void {
    if (typeof v === 'string') {
      const why = credentialKind(v);
      if (why) out.push(at + '：' + why);
      return;
    }
    if (Array.isArray(v)) { v.forEach(function (x, i) { walk(x, at + '[' + i + ']'); }); return; }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        if (!allowed[k]) out.push(at + '.' + k + '：不在白名单的字段名');
        walk((v as Record<string, unknown>)[k], at + '.' + k);
      }
    }
  };
  walk(value, '$');
  return out;
}
