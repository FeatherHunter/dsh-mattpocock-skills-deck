// asar-extract.js — 从 asar 归档里只读抽出一个条目（零依赖，约 30 行）
//
// 为什么需要它（#640/2026-10-04）：门禁 tests/verify-640-dock-width-browser.js 要拿**宿主原文产物**
// 当量尺（不用插件自己的公式自证）。那份产物在本机住在
//   D:\DeepseekHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js
// 而 app.asar 是**归档文件**——DSH 会话进程（Electron）能把它当目录透明读，普通 node 不能，
// 所以要在普通 node 里先把它抽出来再用。抽出来的字节与原归档逐字节相同（sha256 一致）。
//
// 用法（命令行）：node scripts/asar-extract.js <app.asar> <归档内路径> <输出文件>
// 用法（模块）：const { extractAsarEntry } = require('./asar-extract.js')
//
// asar 头部布局（照着 @electron/asar 的读法）：
//   头 8 字节 = [uint32 恒为 4][uint32 头部 pickle 的总长]
//   头部 pickle = [uint32 负载长][uint32 JSON 长][JSON]
//   文件数据从 8 + 头部 pickle 长 起算，条目的 offset 相对这个基准。
const fs = require('fs');
const path = require('path');

/** 读出归档头部 JSON（目录树），失败时抛错。 */
function readAsarHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    const headerSize = head.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuf, 0, headerSize, 8);
    const jsonLen = headerBuf.readUInt32LE(4);
    return { header: JSON.parse(headerBuf.slice(8, 8 + jsonLen).toString('utf8')), dataBase: 8 + headerSize };
  } finally {
    fs.closeSync(fd);
  }
}

/** 把归档里 entryPath（斜杠分隔）那一条抽到 outPath，返回字节数。整条路径只读。 */
function extractAsarEntry(asarPath, entryPath, outPath) {
  const { header, dataBase } = readAsarHeader(asarPath);
  let node = header;
  for (const seg of String(entryPath).split('/')) {
    if (!node.files || !node.files[seg]) throw new Error('asar 里没有这条路径：' + entryPath);
    node = node.files[seg];
  }
  if (node.files) throw new Error('这是目录不是文件：' + entryPath);
  const size = node.size;
  const fd = fs.openSync(asarPath, 'r');
  try {
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, dataBase + Number(node.offset));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return size;
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  const [, , asarPath, entryPath, outPath] = process.argv;
  if (!asarPath || !entryPath || !outPath) {
    console.error('用法: node scripts/asar-extract.js <app.asar> <归档内路径> <输出文件>');
    process.exit(2);
  }
  const size = extractAsarEntry(asarPath, entryPath, outPath);
  console.log('抽出 ' + entryPath + ' → ' + outPath + '（' + (size / 1024).toFixed(1) + ' KB）');
}

module.exports = { extractAsarEntry, readAsarHeader };
