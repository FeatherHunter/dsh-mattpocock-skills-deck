/**
 * src/deck/shell/body-digest.ts —— 正文指纹与分块交付（#1562）
 *
 * 为什么单独一份：读侧（deck_issue_get 的 body:'full'）与写侧（deck_issue_patch 的
 * bodyDigest 校验）要用同一份指纹算法，散在两处迟早对不上。分块大小也只有这一处能定：
 * 渲染层单串上限 8000（src/deck/registration/register-options.ts），这里按 7000 切，
 * 留 1000 字符余量给 JSON 转义与字段名开销，逐块都完整过渲染不被截断。
 *
 * 纯计算：不碰盘、不联网、不读钟、不引任何运行环境能力（含浏览器闭包里没有的 node:crypto）；
 * 输入输出都是字符串，行为与后端无关。SHA-256 按 FIPS 180-4 手写，保证 Node 与浏览器两边算出同一份指纹。
 */

/** 分块大小：7000 字符，低于渲染层 8000 单串上限，留余量。 */
export const BODY_CHUNK_SIZE = 7000

/** 正文前 2000 字符摘要长度：与 issue-get 既有 excerpt 口径一致。 */
export const BODY_EXCERPT_LEN = 2000

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function rotr(x: number, n: number): number { return ((x >>> n) | (x << (32 - n))) >>> 0 }

function sha256Hex(text: string): string {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00)
        i++
        bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  bytes.push(
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
  )
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w: number[] = new Array(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0)
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => ('00000000' + x.toString(16)).slice(-8)).join('')
}

/**
 * 算正文指纹：UTF-8 按字节求 SHA-256，十六进制小写。
 * 空正文也有确定指纹（空串的 SHA-256），不抛错。
 */
export function bodyDigest(body: string): string {
  const text = typeof body === 'string' ? body : String(body ?? '')
  return sha256Hex(text)
}

/**
 * 按固定大小切正文：空正文给空数组，非空按顺序切分，拼回去逐字节相同。
 * 块大小缺省 7000，调用方不要自己另写一个数。
 */
export function chunkBody(body: string, size: number = BODY_CHUNK_SIZE): string[] {
  const text = typeof body === 'string' ? body : String(body ?? '')
  if (!text) return []
  const n = typeof size === 'number' && isFinite(size) && size > 0 ? Math.floor(size) : BODY_CHUNK_SIZE
  const out: string[] = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out
}

/**
 * 拼回分块：仅做顺序拼接，不做任何归一化；调用方用它验证逐字节相同。
 */
export function joinChunks(chunks: unknown): string {
  if (!Array.isArray(chunks)) return ''
  return chunks.map((c) => (typeof c === 'string' ? c : String(c ?? ''))).join('')
}
