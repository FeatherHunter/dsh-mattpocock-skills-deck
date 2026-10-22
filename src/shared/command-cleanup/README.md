# src/shared/command-cleanup —— 插件运行实例销毁时，一条外部命令的收尾工具

这个域只解决一件事（#1392）：宿主把插件的运行实例（fiber）销毁之后，这一趟已经起好的
gh/git 子进程还在飞，它落定时要建一个等待上限计时器；计时器是挂在已销毁实例上的 effect，
建不出来会同步抛 `INACTIVE_EFFECT`。以前没有调用点接住它，它就变成未处理 Promise 拒绝，
宿主按「大声失败」直接退出——用户看到的是「在市场里点一次更新，整个桌面端三秒后自己关闭」。

域里那几件工具要同时守住三件事，缺一件宿主仍会退出或者名额泄漏：

1. 失败要变成调用方看得见的结果，不能以拒绝的形式跑出去；
2. 这一趟占的 gh 准入名额与子进程恰好还一次；
3. 不再等的那条子进程，它的 `done` 即便以拒绝落定也要有人接住。

## 文件怎么摆、怎么用

- 手写真源：`src/shared/command-cleanup/src/command-cleanup.ts`。
- 构建产物：由 `scripts/build.mts` 按「目录里有 `tsconfig.json`」自动认域后生成，**不进版本库、不要手改**。
- 调用方：`src/host/git-process.ts` 的 `runGh` 与 `execProc` 两处进程出口。
  拿名额之后写 `const releaseSlot = onceRelease(拿到的那支归还函数)`；
  建等待计时器时用 `startWaitTimeout(timer, 毫秒, 收尾回调)`，返回空就说明实例已销毁，
  按失败结果返回给调用方即可。

## 为什么单独成域

`src/host` 内部禁止同层互引（条目见 `.dependency-cruiser.ts` 的 `same-layer-import-host`）：
要复用的东西要往上提到 `src/shared` 的公开接口，或者由调用方传进来。这个域不 import 任何模块，
只依赖 Promise 与错误码，所以放在共享层既能被宿主引用，将来客户端侧需要也可以用。

改这里之前先读 `src/shared/command-cleanup/src/command-cleanup.ts` 的文件头注释与门禁
`tests/verify-1392-disposed-timer.ts`；跑门禁用
`node --import ./scripts/ts-hook.mts tests/verify-1392-disposed-timer.ts`。
