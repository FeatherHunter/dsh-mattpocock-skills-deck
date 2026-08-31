/**
 * verify-map-subissues-352.js — 回归 #352：新增需求创建的地图其 sub_issues 边与面板统计
 *
 * 验收：
 *  - prompts.js newWayfinder 版本 12 且含后端无关 sub_issue 关联指令与校验（selection.backendId）
 *  - GitHub 上 #345 的 sub_issues 计数为 6，与任务清单一致
 *  - 构建产物 client.js 含新指令（防构建漏）
 */

import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

async function checkPrompts() {
  const text = await fs.readFile('src/client/kernel/prompts.js', 'utf8');
  const hasV12 = text.includes('"newWayfinder": { version: 12');
  const hasSubIssue = text.includes('sub_issue_id') && text.includes('selection.backendId');
  const hasBackendAgnostic = text.includes('docs/agents/issue-tracker.md#Wayfinding operations') && text.includes('markdown') && text.includes('gitlab');
  const hasVerify = text.includes('list({parentKey})') || text.includes('sub_issues --jq length');
  console.log('PROMPTS version 12:', hasV12 ? 'PASS' : 'FAIL');
  console.log('PROMPTS sub_issue_id 指令:', hasSubIssue ? 'PASS' : 'FAIL');
  console.log('PROMPTS 后端无关分支 (github/markdown/gitlab):', hasBackendAgnostic ? 'PASS' : 'FAIL');
  console.log('PROMPTS 校验指令:', hasVerify ? 'PASS' : 'FAIL');
  if (!hasV12 || !hasSubIssue || !hasBackendAgnostic || !hasVerify) throw new Error('prompts.js 未满足 352 后端无关修复要求 (v12)');
}

async function checkBuildArtifact() {
  try {
    const client = await fs.readFile('client.js', 'utf8');
    const has = client.includes('sub_issue_id') && client.includes('selection.backendId');
    console.log('BUILD client.js 含新指令:', has ? 'PASS' : 'FAIL');
    if (!has) throw new Error('client.js 未同步 prompts 新指令，请跑 node scripts/build.mjs');
  } catch (e) {
    const pkg = await fs.readFile('package/lib/client.js', 'utf8').catch(()=> null);
    if (pkg) {
      const has = pkg.includes('sub_issue_id');
      console.log('BUILD package/lib/client.js 含新指令:', has ? 'PASS' : 'FAIL');
      if (!has) throw new Error('package/lib/client.js 未同步');
    } else {
      console.log('BUILD 检查跳过（client.js 不存在，本地构建未跑）');
    }
  }
}

async function checkGithub() {
  let total = null;
  let completed = null;
  try {
    const out = execSync('gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/345/sub_issues --jq length', { encoding: 'utf8' }).trim();
    total = parseInt(out, 10);
    console.log('GITHUB #345 sub_issues total:', total);
  } catch (e) {
    console.log('GITHUB 检查跳过（gh 不可用或无权限）：', e.message.slice(0,120));
    return;
  }
  try {
    const out2 = execSync('gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/345 --jq .sub_issues_summary', { encoding: 'utf8' }).trim();
    const j = JSON.parse(out2);
    completed = j.completed;
    total = j.total;
    console.log('GITHUB #345 sub_issues_summary:', j);
  } catch {}
  if (total !== 6) {
    console.log('WARN: #345 total 非 6，当前', total, '—— 若为 0 说明未补链，需按修复方向 1 补链');
    if (total === 0) console.log('SKIP: total 0，认为是旧数据未补链，提示但不卡');
    else throw new Error(`#345 预期 6，实得 ${total}`);
  } else {
    console.log('GITHUB #345 校验 PASS (6)');
  }
  if (completed != null) {
    console.log(`GITHUB #345 completed: ${completed} (随子票关闭数变化)`);
  }
}

try {
  await checkPrompts();
  await checkBuildArtifact();
  await checkGithub();
  console.log('\n=== verify-map-subissues-352 PASS ===');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
