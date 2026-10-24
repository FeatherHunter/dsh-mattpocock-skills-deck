// Run with Node >= 22.22.2: node tests/verify-chain-session.ts
// Evaluate the real client fragments with a mocked host; do not require a browser or workspace writes.
//
// 这张检查守的是同一件事的两个入口：宿主按 wf.chain 请求里带的会话号解析沙箱许可，而同一个工作区
// 可以同时有多个会话（比如一个能写、一个只读）。请求里只传 cwd 时，宿主会落到自己的默认会话上，
// 另一个会话的链就按错误的许可求值 —— #1478 的根因。
//   ① src/refresh/rooms/client/probe-chain-subscription.ts 的 loadChain：进工作区、重新检查时取链；
//   ② src/client/kernel/store-switch.ts 的 loadSwitchCri：切换后端弹窗里取 CRI 三项，
//      漏了会话号会按别的会话的许可判断能不能迁移。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const readSource = (rel: string): string => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

// 这两个客户端文件是「拼进浏览器闭包」的片段：没有自己的 import/export，跨文件名字靠 declare。
// 这里把行首 export 去掉、类型剥掉（Node 只删类型、不做语法转换），再把 host 等闭包名字用
// 沙箱桩补上，就能像浏览器里那份拼接结果一样直接求值。不需要浏览器，也不写工作区。
const asSnippet = (source: string): string => stripTypeScriptTypes(source.replace(/^export /gm, ''), { mode: 'strip' });

const sessions: string[] = ['writable-session', 'readonly-session', ''];

for (const sessionId of sessions) {
  let request: any;
  const sandbox = {
    promptLang: (): string => 'en',
    wsKeyOf: (cwd: string): string => cwd,
    getChainCacheKey: (...parts: string[]): string => parts.join('|'),
    isEnabled: (): boolean => false,
    log: (): void => {},
    dswsLogHash: String,
    dswsLogTrunc: String,
    userHintOf: (selection: any): any => selection.backendId,
    nowStr: (): string => '',
    emit: (): void => {},
    host: {
      call: async (method: string, args: any): Promise<any> => {
        assert.equal(method, 'wf.chain');
        request = args;
        return { ok: true, fullSnapshot: { steps: [] } };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(asSnippet(readSource('src/refresh/rooms/client/probe-chain-subscription.ts')) + '\nglobalThis.runChain = loadChain;', sandbox);
  await (sandbox as any).runChain({ cwd: '/workspace', sessionId, selection: { backendId: 'markdown' } }, true, 'user-recheck');
  assert.equal(request.sessionId, sessionId || undefined);
  assert.equal(request.cwd, '/workspace');
  assert.equal(request.backendId, 'markdown');
  assert.equal(request.force, true);
  assert.equal(request.lang, 'en');
  assert.equal(request.trigger, 'user-recheck');
  console.log('PASS probe-chain session forwarding:', sessionId || '(missing)');
}

// store-switch.ts 顶部有一条真 import（时间参数）。构建拼接时那一行会被剥掉、同名常量由闭包提供；
// 这里同样换成桩值，好让整个文件作为纯片段求值。它不在 loadSwitchCri 的调用路径上，只求解析通过。
const storeSwitchSource = readSource('src/client/kernel/store-switch.ts')
  .replace(/^import .*$/gm, 'const STORE_SWITCH_CONFIRM_MS = 1;');
const storeSwitchSnippet = asSnippet(storeSwitchSource);

for (const sessionId of sessions) {
  let request: any;
  const sandbox = {
    host: {
      call: async (method: string, args: any): Promise<any> => {
        assert.equal(method, 'wf.chain');
        request = args;
        return { ok: true, fullSnapshot: { steps: [] } };
      },
    },
    log: (): void => {},
    emit: (): void => {},
    promptLang: (): string => 'en',
    userHintOf: (selection: any): any => selection.backendId,
    dswsLogHash: String,
    dswsLogTrunc: String,
  };
  vm.createContext(sandbox);
  vm.runInContext(storeSwitchSnippet + '\nglobalThis.runSwitch = loadSwitchCri;', sandbox);
  const st: any = { cwd: '/workspace', sessionId, selection: { backendId: 'markdown' }, switchConfirm: { criLoading: true } };
  (sandbox as any).runSwitch(st);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(request.sessionId, sessionId || undefined);
  assert.equal(request.cwd, '/workspace');
  assert.equal(request.backendId, 'markdown');
  assert.equal(request.lang, 'en');
  assert.equal(st.switchConfirm.criLoading, false);
  console.log('PASS store-switch session forwarding:', sessionId || '(missing)');
}
