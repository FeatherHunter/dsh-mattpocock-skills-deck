// tests/fixtures/real-machine/launch/fake-instance.mts —— #1707 门禁专用的「假实例」。
//
// start-instance 用 --exe <node> --cli <本文件> 启动时，真正跑起来的是这个脚本，不是 DSH 程序本体。
// 它只做三件事，别的一概不做：
//   1. 按 start-instance 约定的方式，往 stdout 打一行带 token 的访问地址（端口取 --port，传 0 时用固定端口）；
//   2. 把这一趟的 argv、工作目录与完整环境变量写进启动目录下的 fake-instance-observed.json，
//      门禁据此断言环境文件里的变量真的进了子进程。这是唯一允许出现变量值的地方；
//   3. 顺手建出当天的插件日志文件，免得 start-instance 为了等日志多睡最多 3 秒。
//
// 这个文件只给门禁用，不接真实 DSH 的任何逻辑；改它之前先想想门禁为什么会红。

import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)

/** 取 --名字 后面那一段，缺省用 fallback。 */
function flag(name: string, fallback: string): string {
  const index = argv.indexOf(name)
  if (index >= 0 && argv[index + 1] !== undefined) return argv[index + 1]
  return fallback
}

/** 当天日期，与插件日志文件名同口径（本地时区）：2026-10-29。 */
function today(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

const profile = flag('--profile', 'web')
// start-instance 默认传 --port 0（交给系统分配）；假实例不真的监听端口，给一个固定端口让地址看起来完整。
const port = Number(flag('--port', '0')) || 34567
const dir = process.cwd()

const logDir = path.join(dir, '.dsh-mattskillsdeck-cache', 'logs')
fs.mkdirSync(logDir, { recursive: true })
fs.writeFileSync(path.join(logDir, today() + '.log'), '[fake-instance] 启动，profile=' + profile + '\n', 'utf8')

fs.writeFileSync(
  path.join(dir, 'fake-instance-observed.json'),
  JSON.stringify({ pid: process.pid, cwd: dir, argv, profile, env: process.env }, null, 2) + '\n',
  'utf8',
)

process.stdout.write('http://127.0.0.1:' + port + '/?token=fake-instance-token\n')
