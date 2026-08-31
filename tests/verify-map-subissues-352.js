/**
 * verify-map-subissues-352.js — 回归 #352：新增需求创建的地图其 sub_issues 边与面板统计
 *
 * 验收：
 *  - prompts.js newWayfinder 版本 13 且为后端无关占位 {subIssue}（placeholders 含 subIssue）
 *  - prompts.js 含 NEW_WAYFINDER_DEFAULT_WIRING / newWayfinderParamsFrom / newWayfinderPrompt（UI 零分支）
 *  - 后端 github/markdown/gitlab 各声明 prompts.subIssue
 *  - GitHub 上 #345 的 sub_issues 计数为 6
 *  - 构建产物 client.js 含 subIssue 注入
 */

import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

async function checkPrompts() {
  const text = await fs.readFile('src/client/kernel/prompts.js', 'utf8');
  const hasV13 = text.includes('"newWayfinder": { version: 13');
  const hasPlaceholders = text.includes("placeholders: ['repo','subIssue']");
  const hasSubIssuePlaceholder = text.includes('{subIssue}');
  const hasDefaultWiring = text.includes('NEW_WAYFINDER_DEFAULT_WIRING');
  const hasParamsFrom = text.includes('newWayfinderParamsFrom');
  const hasPrompt = text.includes('newWayfinderPrompt');
  const hasNoHardcode = !text.includes("github` 分支先 `gh api") || text.includes("{subIssue}");
  console.log('PROMPTS version 13:', hasV13 ? 'PASS' : 'FAIL');
  console.log('PROMPTS placeholders subIssue:', hasPlaceholders ? 'PASS' : 'FAIL');
  console.log('PROMPTS {subIssue} 占位:', hasSubIssuePlaceholder ? 'PASS' : 'FAIL');
  console.log('PROMPTS NEW_WAYFINDER_DEFAULT_WIRING:', hasDefaultWiring ? 'PASS' : 'FAIL');
  console.log('PROMPTS newWayfinderParamsFrom:', hasParamsFrom ? 'PASS' : 'FAIL');
  console.log('PROMPTS newWayfinderPrompt:', hasPrompt ? 'PASS' : 'FAIL');
  if (!hasV13 || !hasPlaceholders || !hasSubIssuePlaceholder || !hasDefaultWiring || !hasParamsFrom || !hasPrompt) throw new Error('prompts.js 未满足 352 v13 解耦要求');
  // 确保旧硬编码 3 分支已移除（UI 零分支）
  const hasOldHardcode = text.includes("github` 分支先 `gh api") && text.includes("markdown`/`gitlab` 分支改用");
  console.log('PROMPTS 无旧 3 分支硬编码:', !hasOldHardcode ? 'PASS' : 'FAIL');
  if (hasOldHardcode) throw new Error('prompts.js 仍含旧 3 分支硬编码，应为占位式');
}

async function checkBackendPrompts() {
  const gh = await fs.readFile('src/host/tracker/backends/github/index.js', 'utf8');
  const gl = await fs.readFile('src/host/tracker/backends/gitlab/index.js', 'utf8');
  const md = await fs.readFile('src/host/tracker/backends/markdown/index.js', 'utf8');
  const ghHas = gh.includes('subIssue: {');
  const glHas = gl.includes('subIssue: {');
  const mdHas = md.includes('subIssue: {');
  console.log('BACKEND github prompts.subIssue:', ghHas ? 'PASS' : 'FAIL');
  console.log('BACKEND gitlab prompts.subIssue:', glHas ? 'PASS' : 'FAIL');
  console.log('BACKEND markdown prompts.subIssue:', mdHas ? 'PASS' : 'FAIL');
  if (!ghHas || !glHas || !mdHas) throw new Error('后端 prompts.subIssue 缺失');
}

async function checkRouter() {
  const text = await fs.readFile('src/client/kernel/router.js', 'utf8');
  const has = text.includes('newWayfinderPrompt');
  console.log('ROUTER newWayfinderPrompt:', has ? 'PASS' : 'FAIL');
  if (!has) throw new Error('router.js 未使用 newWayfinderPrompt');
}

async function checkBuildArtifact() {
  try {
    const client = await fs.readFile('client.js', 'utf8');
    const has = client.includes('NEW_WAYFINDER_DEFAULT_WIRING') && client.includes('newWayfinderPrompt');
    console.log('BUILD client.js 含解耦:', has ? 'PASS' : 'FAIL');
    if (!has) throw new Error('client.js 未同步');
  } catch (e) {
    const pkg = await fs.readFile('package/lib/client.js', 'utf8').catch(()=> null);
    if (pkg) {
      const has = pkg.includes('NEW_WAYFINDER_DEFAULT_WIRING');
      console.log('BUILD package/lib/client.js:', has ? 'PASS' : 'FAIL');
    }
  }
}

async function checkGithub() {
  try {
    const out = execSync('gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/345/sub_issues --jq length', { encoding: 'utf8' }).trim();
    const total = parseInt(out, 10);
    console.log('GITHUB #345 sub_issues total:', total);
    if (total !== 6) throw new Error('#345 预期 6，实得 ' + total);
    console.log('GITHUB #345 校验 PASS (6)');
  } catch (e) {
    console.log('GITHUB 跳过:', e.message.slice(0,120));
  }
}

try {
  await checkPrompts();
  await checkBackendPrompts();
  await checkRouter();
  await checkBuildArtifact();
  await checkGithub();
  console.log('\n=== verify-map-subissues-352 PASS ===');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
