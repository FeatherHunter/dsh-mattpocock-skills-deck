// tests/fixtures/real-machine/preflight/fake-screen.mts —— 假屏幕信息命令，验证预检的屏幕硬项。
//
// 预检命令按约定把屏幕信息命令的路径当成可注入参数（--screen-cmd / DSH_PREFLIGHT_SCREEN_CMD），
// 默认是本机的 powershell。门禁里用这个夹具顶替 Powershell：它不读真实显示器，只按
// FAKE_SCREEN_MODE 回三种固定输出，让「屏幕分辨率与主屏」这项既能验正例、也能单独触发负例。
//
//   FAKE_SCREEN_MODE=ok（默认）：输出两台显示器的 JSON 数组（主屏 1920x1080）。
//   FAKE_SCREEN_MODE=fail    ：命令失败（退出码 1），stderr 写一句中文。
//   FAKE_SCREEN_MODE=garbage ：stdout 写一段不是 JSON 的文本。
//
// 直接跑：node --import ./scripts/ts-hook.mts tests/fixtures/real-machine/preflight/fake-screen.mts

const mode = process.env.FAKE_SCREEN_MODE || 'ok'

if (mode === 'fail') {
  process.stderr.write('假屏幕命令：按 FAKE_SCREEN_MODE=fail 故意失败，模拟取不到显示器信息。\n')
  process.exitCode = 1
} else if (mode === 'garbage') {
  process.stdout.write('这不是 JSON，只是一段给人看的文字。\n')
} else {
  const devices = [
    { deviceName: '\\\\.\\DISPLAY1', width: 1920, height: 1080, primary: true },
    { deviceName: '\\\\.\\DISPLAY2', width: 1080, height: 1920, primary: false },
  ]
  process.stdout.write(JSON.stringify(devices) + '\n')
}
