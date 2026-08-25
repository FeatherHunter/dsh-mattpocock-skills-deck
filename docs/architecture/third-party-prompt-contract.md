# 第三方后端人机协作提示词规范（新增模块必读）

> UI 已写死：`wf.status` 返回的 `checks[].hint` 若不以 `prompt:` 开头，则 `ChecksTab` 主按钮“注入指引”不渲染，环境检测走不完（天然卡点）。本规范帮助你一次性写对。

## 模块必实现

```js
register({
  id: 'my-backend',
  checkRequirements: async (ctx)=>[
    {id:'tool', level:'bad', name:'My CLI', detail:'PATH 无 mycli', hint:'prompt:installMyCli'},
    {id:'auth', level:'bad', name:'My Auth', detail:'未登录', hint:'prompt:myAuthLogin'}
  ],
  ensureRepo: async (ctx,{name})=>{ /* 多态建仓 */ },
  getSetupPrompt: (ctx)=> 'prompt:mySetup' // 注入到对话框的模板 key
})
```

## hint 规则

- 必须 `prompt:<key>`（对应 `src/client/kernel/prompts.js` 的 `PROMPTS[<key>]`）或 `https://`，否则 `verify-requirements-prompt` 门禁 fail
- `prompt:` 键需在 `prompts.js` 有双语 `zh/en` 文案，`npm run verify` 会校验

## 验证

- `npm run verify` 已含 `verify-requirements-prompt`（新增）：扫描 `src/host/tracker/backends/*/index.js` 的 `checkRequirements` 是否全 `prompt:`，`getSetupPrompt` 是否存在
- 示例：`src/host/tracker/backends/demo-mini/index.js` 为最小可抄模板

不按此实现，PR 的 `verify` 即红，环境检测卡无主按钮，用户无法完成引导。