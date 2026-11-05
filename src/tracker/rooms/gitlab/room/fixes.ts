/**
 * src/tracker/rooms/gitlab/room/fixes.ts —— 这一房交给检查页的修复指引。
 *
 * 为什么独立成文件：修复指引是「检查失败时界面上出现什么按钮、按钮注入哪条提示词」的数据，
 * 改按钮或改文案时不该打开入口。对象仍用 Object.freeze 冻住：房外有按引用读取它的人，
 * 冻住是为了让运行时改动当场失败，而不是悄悄改掉界面上的动作。
 *
 * 这里出现的 prompt 值是字符串键名（glabInstallFix / glabLoginFix），不是导入的文本；
 * 文本住在入口 index.ts 的 prompts 对象里（房外门禁按入口原文扫描那一块）。改键名要同时改那边。
 */
export const fixes = Object.freeze({
  'glab:installed': {
    hint: {
      zh: 'glab CLI 未安装。点「安装指引」按官方文档安装，完成后重查。',
      en: 'glab CLI is not installed. Use the install guide (official docs), then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'glabInstallFix', label: { zh: '安装指引', en: 'Install guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'glab:authed': {
    hint: {
      zh: 'glab 尚未登录。点「登录指引」注入 glab auth login 操作步骤，完成后重查。',
      en: 'glab is not logged in. Use the login guide, then re-check.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'glabLoginFix', label: { zh: '登录指引', en: 'Login guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'glab:repoAccess': {
    hint: {
      zh: '此目录未关联 GitLab 仓库。先点「创建并发布」完成建仓推送，再执行初始化；想用本地 Markdown，可在顶端切换后端后再查。',
      en: 'This directory is not linked to a GitLab repo. First click "Create & publish" to finish creating and pushing the repo, then run initialization. To use local Markdown, switch the backend at the top and re-check.',
    },
    // 修复动作（#1191：与 GitHub 房同形的两步向导；提交走 contract-op 按当前后端分发，不再直调 wf.initPublish）。
    actions: [
      {
        type: 'wizard',
        label: { zh: '创建并发布', en: 'Create & publish' },
        steps: [
          {
            title: { zh: '仓库信息', en: 'Repository info' },
            schema: [
              { name: 'name', type: 'text', required: true, label: { zh: '仓库名', en: 'Repo name' }, pattern: '^[A-Za-z0-9._-]{1,100}$', defaultFrom: 'cwd-basename', preview: { zh: '将创建 https://gitlab.com/{owner}/{name}', en: 'Will create https://gitlab.com/{owner}/{name}' } },
            ],
          },
          {
            title: { zh: '可见性', en: 'Visibility' },
            schema: [
              { name: 'visibility', type: 'single', label: { zh: '可见性', en: 'Visibility' }, options: ['private', 'public'], optionSubs: { private: { zh: '仅自己', en: 'Only you' }, public: { zh: '所有人', en: 'Everyone' } }, defaultValue: 'private' },
            ],
          },
        ],
        submitAction: { type: 'contract-op', op: 'initProject', params: {} },
      },
      { type: 'refresh', target: 'chain' },
    ],
  },
})
