// tests/fixtures/real-machine/probe-env.mts —— 隔离探针：把子进程看到的环境打成一段 JSON。
//
// 门禁用它验证夹具的隔离层真的生效：工具台命令起子进程时，USERPROFILE/HOME、DSH_REAL_HOME、
// TMP/TEMP/TMPDIR、DSH_VERIFY_WORK_ROOT、PATH 第一段与 GLAB_BIN 都应当落在临时工作根里，
// 而不是宿主真实用户目录。它只读环境，不写任何文件。

import os from 'node:os'
import path from 'node:path'

const pathEntries = String(process.env.PATH || '')
  .split(path.delimiter)
  .filter(Boolean)

const payload = {
  cwd: process.cwd(),
  homedir: os.homedir(),
  tempDir: os.tmpdir(),
  userProfile: process.env.USERPROFILE || null,
  home: process.env.HOME || null,
  dshVerifyWorkRoot: process.env.DSH_VERIFY_WORK_ROOT || null,
  dshRealHome: process.env.DSH_REAL_HOME || null,
  glabBin: process.env.GLAB_BIN || null,
  pathEntries: pathEntries.slice(0, 5),
}

process.stdout.write(JSON.stringify(payload) + '\n')
