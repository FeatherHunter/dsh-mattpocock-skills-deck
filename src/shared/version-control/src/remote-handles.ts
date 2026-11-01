// 远端与同步页六条宿主电话的「日志包装 + 按需取件」小件（#1754 T18，域 8 的 8.1–8.4）。
//
// 为什么放在共享层、而不是宿主父文件 src/host/versionControl.ts：
//   1. 父文件贴着 350 有效行上限，六条字段逐个写不下；
//   2. 宿主同层文件之间只允许动态 import（见 tests/verify-dependency-rules.ts 的
//      same-layer-import-host），父文件不能静态 import 同层的 ./versionControlRemote.js。
//   把与进程、联网都无关的包装逻辑放在这里，父文件只递一个「取电话体」的函数，两边各守各的规矩。
//
// 约定（改之前先读）：
//   - loggedPhone 是父文件那条统一的进出日志包装，六条电话都走它，不另开事件名；
//   - phoneLoader 必须是「缓存过的同一条 Promise」的取件函数：createRemotePhones 里有一张
//     in-flight 表，同一远端同一时刻只许一个联网请求在飞（ADR 20261031 第 6 节的限频要求），
//     每次都新建一份电话体就会把这张表打散。
export function remoteHandles(loggedPhone: any, phoneLoader: () => any): any {
  const wrap = function (method: string, kind: string, name: string): any {
    return loggedPhone(method, kind, async function (a: any): Promise<any> {
      const p: any = await phoneLoader()
      return p[name](a)
    })
  }
  return {
    handleGitRemoteList: wrap('wf.gitRemoteList', 'git-remote-list', 'handleGitRemoteList'),
    handleGitRemoteAdd: wrap('wf.gitRemoteAdd', 'git-remote-add', 'handleGitRemoteAdd'),
    handleGitRemoteRename: wrap('wf.gitRemoteRename', 'git-remote-rename', 'handleGitRemoteRename'),
    handleGitRemoteRemove: wrap('wf.gitRemoteRemove', 'git-remote-remove', 'handleGitRemoteRemove'),
    handleGitRemoteSetUrl: wrap('wf.gitRemoteSetUrl', 'git-remote-set-url', 'handleGitRemoteSetUrl'),
    handleGitRemoteOnline: wrap('wf.gitRemoteOnline', 'git-remote-online', 'handleGitRemoteOnline'),
  }
}
