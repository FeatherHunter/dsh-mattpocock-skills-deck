// 提交表单读取电话的装配壳（#1743）：把父文件里已经造好的宿主闭包接给 ./versionControlCommitForm.ts。
//
// 为什么单独成一层：父文件 src/host/versionControl.ts 贴着文件粒度门禁的 350 有效行上限，
// 「懒加载、加载失败兜底、loggedPhone 日志包装」这三件事与业务无关，放进父文件只会再挤占额度。
// 做法与 #1742 的 versionControlChangesMount.ts 同一约定：
//   1) 只在第一次拨电话时才动态载入提交表单那一族，宿主启动不加载；
//   2) 载入失败必须回明确失败信封，而不是让电话永远挂起；
//   3) 电话与其它 git 电话同一个日志口径：host.call / host.call.fail，不新增事件；
//   4) 本层不新增任何业务判定，解析与软降级全在 ./versionControlCommitForm.ts 里。

/** 把宿主依赖（git 进程出口、文件服务、日志包装等）接成提交表单的一条只读电话。 */
export function createCommitFormMount(host: any): any {
  let assembling: any = null
  function formPhone(): Promise<any> {
    if (!assembling) {
      assembling = import('./versionControlCommitForm.js').then(function (m: any): any {
        return m.createCommitFormPhone(host)
      }).catch(function (e: any): any {
        const message: string = '提交表单读取那一族加载失败：' + String((e && e.message) || e)
        const failed: any = function (): any { return host.failPhone('env', message) }
        return { handleGitCommitForm: failed }
      })
    }
    return assembling
  }

  return {
    handleGitCommitForm: host.loggedPhone('wf.gitCommitForm', 'git-commit-form', function (args: any): Promise<any> {
      return formPhone().then(function (c: any): any { return c.handleGitCommitForm(args) })
    }),
  }
}
