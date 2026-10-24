// Run with Node >= 22.13: node tests/verify-chain-session.mjs
// Evaluate the real client fragment with a mocked host; do not require a browser or workspace writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(new URL('../src/refresh/rooms/client/probe-chain-subscription.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source.replace(/^export /gm, ''), { mode: 'strip' });
for (const sessionId of ['writable-session', 'readonly-session', '']) {
  let request;
  const sandbox = {
    promptLang: () => 'en', wsKeyOf: cwd => cwd,
    getChainCacheKey: (...parts) => parts.join('|'),
    isEnabled: () => false, log: () => {}, dswsLogHash: String, dswsLogTrunc: String,
    userHintOf: selection => selection.backendId, nowStr: () => '', emit: () => {},
    host: { call: async (method, args) => {
      assert.equal(method, 'wf.chain'); request = args;
      return { ok: true, fullSnapshot: { steps: [] } };
    } },
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.runChain = loadChain;', sandbox);
  await sandbox.runChain({ cwd: '/workspace', sessionId, selection: { backendId: 'markdown' } }, true, 'user-recheck');
  assert.equal(request.sessionId, sessionId || undefined);
  assert.equal(request.cwd, '/workspace');
  assert.equal(request.backendId, 'markdown');
  assert.equal(request.force, true);
  assert.equal(request.lang, 'en');
  assert.equal(request.trigger, 'user-recheck');
  console.log('PASS session forwarding:', sessionId || '(missing)');
}
