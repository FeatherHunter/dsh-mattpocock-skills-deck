/* 构建产物：由 scripts/build.ts 从 src/main.ts 打包，不要手改。 */
"use strict";
(() => {
  // docs/prototype/vc-redesign/src/data/copy.ts
  var COPY = {
    frame: {
      kicker: "Prototype: version-control page",
      title: "\u7248\u672C\u7BA1\u7406\u9875\u91CD\u6784\u539F\u578B",
      lede: "\u628A\u9876\u90E8\u4FE1\u606F\u3001\u6539\u52A8\u3001\u63D0\u4EA4\u5386\u53F2\u3001\u5DE5\u4F5C\u6811\u6536\u8FDB\u540C\u4E00\u5957\u9AA8\u67B6\uFF1A\u5148\u8BF4\u7ED3\u8BBA\uFF0C\u518D\u7ED9\u8BC1\u636E\uFF0C\u52A8\u4F5C\u548C\u7ED3\u679C\u8D34\u7740\u8BC1\u636E\u51FA\u73B0\u3002\u6570\u636E\u91C7\u81EA\u672C\u4ED3\u5E93\u771F\u5B9E\u7684 git \u8BB0\u5F55\uFF0C\u5199\u64CD\u4F5C\u5728\u672C\u5730\u6A21\u62DF\u3002",
      metaData: "\u6570\u636E\u6765\u81EA\u672C\u4ED3\u5E93\u771F\u5B9E git \u8BB0\u5F55",
      metaWidth: "\u9762\u677F\u5BBD\u5EA6 300 \u5230 520",
      metaSkin: "\u4E24\u5957\u76AE\u80A4\u5171\u7528\u4E00\u5957\u7ED3\u6784",
      width: "\u9762\u677F\u5BBD\u5EA6",
      theme: "\u76AE\u80A4",
      themeDark: "\u6DF1\u8272",
      themeLight: "\u6D45\u8272",
      toolsNote: "\u5199\u64CD\u4F5C\u53EA\u6539\u754C\u9762\u72B6\u6001\uFF0C\u4E0D\u4F1A\u6539\u52A8\u4ED3\u5E93",
      hint: "\u70B9\u9875\u7B7E\u5207\u6362\u89C6\u56FE\uFF0C\u70B9\u6587\u4EF6\u884C\u5C55\u5F00\u9010\u884C\u5DEE\u5F02",
      capturedAt: (when) => `\u6570\u636E\u91C7\u96C6\u4E8E ${when}`
    },
    views: {
      changes: "\u6539\u52A8",
      commits: "\u63D0\u4EA4\u5386\u53F2",
      worktrees: "\u5DE5\u4F5C\u6811",
      stash: "\u6536\u8D77\u7684\u6539\u52A8"
    },
    units: {
      change: "\u6587\u4EF6",
      commit: "\u6761",
      worktree: "\u68F5",
      stash: "\u6761"
    },
    rail: {
      reload: "\u91CD\u65B0\u8BFB\u53D6",
      reloadBusy: "\u8BFB\u53D6\u4E2D\u2026",
      readAt: (when) => `\u8BFB\u53D6\u4E8E ${when}`,
      basisAt: (when) => `\u8FDC\u7AEF\u4F9D\u636E ${when}`,
      basisUnknown: "\u8FDC\u7AEF\u4F9D\u636E\u672A\u77E5",
      readHint: "\u672C\u5730\u6700\u8FD1\u4E00\u6B21\u8BFB\u53D6 git \u7684\u65F6\u95F4\uFF0C\u4E0D\u8054\u7F51",
      basisHint: "\u6700\u8FD1\u4E00\u6B21\u4ECE\u8FDC\u7AEF\u53D6\u56DE\u4FE1\u606F\u7684\u65F6\u95F4",
      nextHint: "\u6309\u5F53\u524D\u72B6\u6001\u7ED9\u51FA\u7684\u4E0B\u4E00\u6B65\u5EFA\u8BAE\uFF0C\u4E0D\u662F\u6309\u94AE",
      branchHint: "\u6253\u5F00\u5206\u652F\u5217\u8868\uFF0C\u53EF\u4EE5\u5207\u6362\u3001\u521B\u5EFA\u3001\u5408\u5E76\u3001\u91CD\u547D\u540D\u548C\u5220\u9664\u5206\u652F",
      syncHint: (label, value) => `${label} ${value} \u4E2A\u63D0\u4EA4`,
      copyRepoPath: "\u590D\u5236\u4ED3\u5E93\u8DEF\u5F84",
      copyWorktreePath: "\u590D\u5236\u5DE5\u4F5C\u6811\u8DEF\u5F84",
      pathCopied: "\u8DEF\u5F84\u5DF2\u590D\u5236",
      next: "\u4E0B\u4E00\u6B65",
      syncAhead: "\u8D85\u524D",
      syncBehind: "\u843D\u540E",
      noUpstream: "\u5C1A\u672A\u8BBE\u7F6E\u4E0A\u6E38",
      upstreamGone: "\u63A8\u9001\u76EE\u6807\u5DF2\u4E0D\u5B58\u5728",
      detached: "\u6E38\u79BB\u5934\u6307\u9488",
      syncUnknown: "\u540C\u6B65\u72B6\u6001\u8BFB\u4E0D\u5230",
      confirmTitle: "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u6539\u52A8\uFF0C\u4ECD\u8981\u62C9\u53D6\uFF1F",
      confirmLead: "\u62C9\u53D6\u53EA\u628A\u672C\u5730\u66F4\u65B0\u5230\u8FDC\u7AEF\u6700\u65B0\uFF0C\u4E0D\u4F1A\u591A\u51FA\u4E00\u6761\u5408\u5E76\u63D0\u4EA4\u3002",
      /** 两条结果并排摆开：标签直接写结论（不会冲突 / 会冲突），颜色只做辅助，读者不用猜绿和黄代表什么。 */
      confirmPoints: [
        { tone: "ok", label: "\u4E0D\u4F1A\u51B2\u7A81", text: "\u76F4\u63A5\u66F4\u65B0\u5230\u6700\u65B0\uFF0C\u672C\u5730\u6539\u52A8\u7559\u5728\u5DE5\u4F5C\u533A" },
        { tone: "warn", label: "\u4F1A\u51B2\u7A81", text: "\u62C9\u53D6\u4F1A\u88AB\u62E6\u4E0B\uFF0C\u5E76\u70B9\u540D\u51B2\u7A81\u7684\u6587\u4EF6" }
      ],
      confirmFiles: (n) => `\u6D89\u53CA ${n} \u4E2A\u6587\u4EF6`,
      confirmContinue: "\u7EE7\u7EED\u62C9\u53D6",
      confirmCancel: "\u53D6\u6D88"
    },
    actions: {
      pull: "\u62C9\u53D6",
      fetch: "\u66F4\u65B0",
      push: "\u63A8\u9001",
      commit: "\u63D0\u4EA4",
      stage: "\u52A0\u5165",
      unstage: "\u79FB\u51FA",
      stageAll: "\u5168\u90E8\u52A0\u5165",
      unstageAll: "\u5168\u90E8\u79FB\u51FA",
      back: "\u8FD4\u56DE\u63D0\u4EA4\u5386\u53F2",
      loadMore: "\u52A0\u8F7D\u66F4\u65E9\u7684\u63D0\u4EA4"
    },
    busy: {
      pull: "\u62C9\u53D6\u4E2D\u2026",
      fetch: "\u66F4\u65B0\u4E2D\u2026",
      push: "\u63A8\u9001\u4E2D\u2026",
      commit: "\u63D0\u4EA4\u4E2D\u2026",
      reload: "\u8BFB\u53D6\u4E2D\u2026"
    },
    /** 阻断原因：真实实现的标识符在 src/shared/version-control/src/rules.ts。 */
    block: {
      "nothing-staged": "\u8FD8\u6CA1\u6709\u6587\u4EF6\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\uFF0C\u5148\u52A0\u5165\u8981\u63D0\u4EA4\u7684\u6587\u4EF6",
      "nothing-to-stage": "\u6CA1\u6709\u53EF\u4EE5\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u6539\u52A8",
      "conflicts-unresolved": "\u5B58\u5728\u672A\u89E3\u51B3\u7684\u51B2\u7A81\u6587\u4EF6",
      "dirty-tree": "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8",
      "basis-unknown": "\u8FDC\u7AEF\u4F9D\u636E\u65F6\u95F4\u8BFB\u4E0D\u5230",
      "behind-remote": "\u843D\u540E\u8FDC\u7AEF\uFF0C\u5148\u62C9\u53D6\u518D\u63A8\u9001",
      "no-upstream": "\u5C1A\u672A\u8BBE\u7F6E\u4E0A\u6E38",
      "upstream-gone": "\u4E0A\u6E38\u5DF2\u5728\u8FDC\u7AEF\u5220\u9664",
      "detached-head": "\u5F53\u524D\u4E0D\u5728\u4EFB\u4F55\u5206\u652F\u4E0A",
      "mid-merge": "\u6709\u672A\u5B8C\u6210\u7684\u5408\u5E76",
      "mid-rebase": "\u6709\u672A\u5B8C\u6210\u7684\u53D8\u57FA",
      "mid-cherry-revert": "\u6709\u672A\u5B8C\u6210\u7684\u62E3\u9009\u6216\u56DE\u9000",
      "bare-repo": "\u88F8\u4ED3\u5E93\u6CA1\u6709\u5DE5\u4F5C\u533A",
      "unknown-operation": "\u8FD9\u4E00\u6B65\u5F53\u524D\u4E0D\u53EF\u7528",
      "nothing-to-push": "\u6CA1\u6709\u53EF\u63A8\u9001\u7684\u63D0\u4EA4"
    },
    warn: {
      "dirty-tree": "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8",
      "basis-unknown": "\u8FDC\u7AEF\u4F9D\u636E\u65F6\u95F4\u8BFB\u4E0D\u5230",
      "detached-head": "\u5F53\u524D\u4E0D\u5728\u4EFB\u4F55\u5206\u652F\u4E0A",
      "mid-merge": "\u6B63\u5728\u5408\u5E76",
      "mid-rebase": "\u6B63\u5728\u53D8\u57FA",
      "mid-cherry-revert": "\u6B63\u5728\u62E3\u9009\u6216\u56DE\u9000"
    },
    changes: {
      filterConflict: "\u5B58\u5728\u51B2\u7A81",
      filterStaged: "\u5DF2\u52A0\u5165",
      filterUnstaged: "\u672A\u52A0\u5165",
      groupConflict: "\u5B58\u5728\u51B2\u7A81",
      groupStaged: "\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      groupUnstaged: "\u672A\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      groupEmptyConflict: "\u6CA1\u6709\u51B2\u7A81\u6587\u4EF6",
      groupEmptyStaged: "\u8FD8\u6CA1\u6709\u6587\u4EF6\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      groupEmptyUnstaged: "\u6CA1\u6709\u672A\u52A0\u5165\u7684\u6539\u52A8",
      patchTitle: "\u76F8\u5BF9\u4E0A\u4E00\u6B21\u63D0\u4EA4\u7684\u53D8\u66F4\uFF08\u542B\u5DF2\u52A0\u5165\u4E0E\u672A\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u6539\u52A8\uFF09",
      patchNote: "\u539F\u578B\u53EA\u6F14\u793A\u9010\u884C\u5DEE\u5F02\u7684\u6392\u7248\uFF0C\u8FD9\u4E00\u5C0F\u6BB5\u662F\u793A\u4F8B\u8865\u4E01\uFF0C\u4E0D\u6765\u81EA\u4ED3\u5E93\u3002",
      messagePlaceholder: "\u5199\u4E00\u53E5\u63D0\u4EA4\u8BF4\u660E",
      messageHint: "\u53EA\u63D0\u4EA4\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u5185\u5BB9\u3002\u6CA1\u52A0\u5165\u7684\u6587\u4EF6\u7559\u5728\u5DE5\u4F5C\u533A\u3002",
      commitLabel: (n) => `\u63D0\u4EA4 ${n} \u4E2A\u6587\u4EF6`,
      commitNoStaged: "\u8FD8\u6CA1\u6709\u6587\u4EF6\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      commitNoMessage: "\u586B\u5199\u63D0\u4EA4\u8BF4\u660E\u540E\u5373\u53EF\u63D0\u4EA4",
      emptyTitle: "\u6CA1\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8",
      emptyHint: "\u5DE5\u4F5C\u6811\u662F\u5E72\u51C0\u7684\uFF0C\u4E5F\u6CA1\u6709\u8981\u63D0\u4EA4\u7684\u6539\u52A8\u3002",
      untracked: "\u672A\u8DDF\u8E2A",
      typeUnknown: "\u65E0\u6CD5\u5224\u5B9A\u53D8\u66F4\u7C7B\u578B",
      stagedBadge: "\u5DF2\u52A0\u5165",
      menuMore: "\u66F4\u591A\u64CD\u4F5C",
      menuDiscard: "\u4E22\u5F03\u4FEE\u6539",
      menuIgnore: "\u52A0\u5165 .gitignore",
      menuDelete: "\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6",
      menuResolveOurs: "\u7528\u5F53\u524D\u5206\u652F\u7684\u7248\u672C\u89E3\u51B3",
      menuResolveTheirs: "\u7528\u5BF9\u65B9\u7684\u7248\u672C\u89E3\u51B3",
      discardAll: "\u4E22\u5F03\u5168\u90E8",
      confirmCancel: "\u53D6\u6D88",
      confirmDiscard: "\u786E\u8BA4\u4E22\u5F03",
      confirmIgnore: "\u786E\u8BA4\u52A0\u5165",
      confirmDelete: "\u786E\u8BA4\u5220\u9664",
      confirmResolve: "\u786E\u8BA4\u89E3\u51B3",
      confirmDiscardTitle: (name) => `\u4E22\u5F03 ${name} \u7684\u6539\u52A8\uFF1F`,
      confirmDiscardBody: "\u6587\u4EF6\u4F1A\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF0C\u8FD9\u6B21\u672A\u52A0\u5165\u7684\u6539\u52A8\u6CA1\u6CD5\u4ECE\u9762\u677F\u64A4\u56DE\u3002",
      confirmDiscardAllTitle: (n) => `\u4E22\u5F03 ${n} \u4E2A\u6587\u4EF6\u7684\u6539\u52A8\uFF1F`,
      confirmDiscardAllBody: "\u8FD9\u4E9B\u6587\u4EF6\u90FD\u4F1A\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF0C\u672A\u52A0\u5165\u7684\u6539\u52A8\u6CA1\u6CD5\u4ECE\u9762\u677F\u64A4\u56DE\u3002",
      confirmDiscardAllMeta: (n) => `\u6D89\u53CA ${n} \u4E2A\u6587\u4EF6`,
      confirmIgnoreTitle: (name) => `\u628A ${name} \u52A0\u5165 .gitignore\uFF1F`,
      confirmIgnoreBody: "\u6587\u4EF6\u4ECD\u5728\u78C1\u76D8\u4E0A\uFF0Cgit \u4ECE\u4E0B\u4E00\u6B21\u8BFB\u53D6\u8D77\u4E0D\u518D\u8DDF\u8E2A\u5B83\u3002\u5DF2\u7ECF\u63D0\u4EA4\u8FDB\u5386\u53F2\u7684\u5185\u5BB9\u4E0D\u53D7\u5F71\u54CD\u3002",
      confirmDeleteTitle: (name) => `\u5220\u9664\u672A\u8DDF\u8E2A\u6587\u4EF6 ${name}\uFF1F`,
      confirmDeleteBody: "\u8FD9\u4E2A\u6587\u4EF6\u4ECE\u6765\u6CA1\u6709\u8FDB\u8FC7 git \u5386\u53F2\uFF0C\u5220\u9664\u4EE5\u540E\u6CA1\u6709\u4EFB\u4F55\u5730\u65B9\u80FD\u627E\u56DE\u3002",
      confirmResolveOursTitle: (name) => `\u7528\u5F53\u524D\u5206\u652F\u7684\u7248\u672C\u89E3\u51B3 ${name}\uFF1F`,
      confirmResolveOursBody: "\u5BF9\u65B9\u5206\u652F\u91CC\u7684\u6539\u52A8\u4F1A\u88AB\u4E22\u6389\uFF0C\u6587\u4EF6\u4F1A\u76F4\u63A5\u53D8\u4E3A\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u3002",
      confirmResolveTheirsTitle: (name) => `\u7528\u5BF9\u65B9\u7684\u7248\u672C\u89E3\u51B3 ${name}\uFF1F`,
      confirmResolveTheirsBody: "\u5F53\u524D\u5206\u652F\u91CC\u7684\u6539\u52A8\u4F1A\u88AB\u4E22\u6389\uFF0C\u6587\u4EF6\u4F1A\u76F4\u63A5\u53D8\u4E3A\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u3002",
      ignoredNote: (n) => `\u5DF2\u5FFD\u7565 ${n} \u4E2A\u6587\u4EF6\uFF0Cgit \u4ECE\u4E0B\u4E00\u6B21\u8BFB\u53D6\u8D77\u4E0D\u518D\u8DDF\u8E2A\u5B83\u4EEC`,
      stashAction: "\u6536\u8D77\u6539\u52A8",
      stashHint: "\u628A\u6539\u52A8\u6253\u5305\u6536\u8D77\u6765\uFF0C\u5DE5\u4F5C\u533A\u56DE\u5230\u4E0A\u6B21\u63D0\u4EA4\u65F6\u7684\u6837\u5B50\u3002\u8981\u63D0\u4EA4\u7684\u5185\u5BB9\u4E5F\u4E00\u8D77\u6536\u8D70\uFF0C\u4E4B\u540E\u80FD\u653E\u56DE\u5DE5\u4F5C\u533A\u3002",
      stashBlocked: "\u6709\u51B2\u7A81\u6587\u4EF6\u65F6\u4E0D\u80FD\u6536\u8D77\u6539\u52A8\uFF0C\u5148\u89E3\u51B3\u51B2\u7A81\u3002",
      menuClose: "\u6536\u8D77\u83DC\u5355",
      menuOpen: "\u66F4\u591A\u64CD\u4F5C"
    },
    history: {
      searchPlaceholder: (loaded) => `\u5728\u5DF2\u52A0\u8F7D\u7684 ${loaded} \u6761\u63D0\u4EA4\u91CC\u7B5B\u9009`,
      mergeOnly: "\u53EA\u770B\u5408\u5E76",
      loadedCount: (loaded, total) => `\u5DF2\u52A0\u8F7D ${loaded} \u6761\uFF0C\u5171 ${total} \u6761`,
      empty: "\u5DF2\u52A0\u8F7D\u7684\u63D0\u4EA4\u91CC\u6CA1\u6709\u5339\u914D\u9879\u3002",
      groupToday: "\u4ECA\u5929",
      groupYesterday: "\u6628\u5929",
      groupDate: (month, day) => `${month} \u6708 ${day} \u65E5`,
      author: "\u4F5C\u8005",
      time: "\u63D0\u4EA4\u65F6\u95F4",
      hash: "\u63D0\u4EA4",
      parents: "\u7236\u63D0\u4EA4",
      changedFiles: (n) => `\u53D8\u66F4\u4E86 ${n} \u4E2A\u6587\u4EF6`,
      filesEmptyMerge: "\u8FD9\u662F\u4E00\u6B21\u5408\u5E76\u63D0\u4EA4\uFF1A\u5B83\u76F8\u5BF9\u7B2C\u4E00\u4E2A\u7236\u63D0\u4EA4\u6CA1\u6709\u53D8\u66F4\u6587\u4EF6\u3002",
      filesEmpty: "\u8BE5\u63D0\u4EA4\u672A\u4FEE\u6539\u4EFB\u4F55\u6587\u4EF6\u3002",
      fileTypeUnknown: "\u8BE5\u63D0\u4EA4\u53EA\u8FD4\u56DE\u8DEF\u5F84\u4E0E\u589E\u5220\u884C\u6570\uFF0C\u65E0\u6CD5\u5224\u5B9A\u53D8\u66F4\u7C7B\u578B",
      diffSampleNote: "\u539F\u578B\u53EA\u6F14\u793A\u9010\u884C\u5DEE\u5F02\u7684\u6392\u7248\uFF0C\u5C55\u5F00\u540E\u662F\u793A\u4F8B\u8865\u4E01\uFF0C\u4E0D\u6765\u81EA\u8BE5\u63D0\u4EA4\u3002",
      mergeChip: "\u5408\u5E76",
      menuOpen: "\u66F4\u591A\u64CD\u4F5C",
      menuRevert: "\u56DE\u9000\u8FD9\u6B21\u63D0\u4EA4",
      menuCherryPick: "\u62E3\u9009\u5230\u5F53\u524D\u5206\u652F",
      menuUndo: "\u64A4\u9500\u8FD9\u6B21\u63D0\u4EA4\uFF0C\u6539\u52A8\u56DE\u5230\u300C\u5DF2\u52A0\u5165\u300D",
      menuUndoHint: "\u53EA\u80FD\u64A4\u9500\u6700\u65B0\u4E00\u6761\u63D0\u4EA4",
      menuCopy: "\u590D\u5236\u63D0\u4EA4 ID",
      menuClose: "\u6536\u8D77\u83DC\u5355",
      undoTitle: (subject) => `\u64A4\u9500\u63D0\u4EA4\u300C${subject}\u300D\uFF1F`,
      undoBody: "\u5206\u652F\u4F1A\u9000\u4E00\u6B65\uFF0C\u8FD9\u6B21\u63D0\u4EA4\u91CC\u7684\u6587\u4EF6\u56DE\u5230\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\uFF0C\u63D0\u4EA4\u8BF4\u660E\u7559\u5728\u8F93\u5165\u6846\u91CC\u3002\u8FD9\u4E00\u6B65\u6539\u7684\u662F\u672C\u5730\u5386\u53F2\u3002",
      undoConfirm: "\u786E\u8BA4\u64A4\u9500",
      cancel: "\u53D6\u6D88",
      undoNote: "\u5386\u53F2\u91CC\u7684\u8FD9\u6761\u63D0\u4EA4\u6682\u65F6\u9690\u53BB\uFF0C\u6539\u52A8\u5728\u300C\u6539\u52A8\u300D\u9875\u7B7E\u7684\u5DF2\u52A0\u5165\u5206\u7EC4\u91CC\u3002"
    },
    branches: {
      title: "\u5206\u652F",
      newBranch: "\u65B0\u5EFA\u5206\u652F",
      searchPlaceholder: "\u6309\u5206\u652F\u540D\u7B5B\u9009",
      current: "\u5F53\u524D",
      noUpstream: "\u672A\u8BBE\u7F6E\u4E0A\u6E38",
      upstream: (name) => `\u4E0A\u6E38 ${name}`,
      ahead: (n) => `\u9886\u5148 ${n}`,
      behind: (n) => `\u843D\u540E ${n}`,
      merged: "\u5DF2\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F",
      notMerged: "\u5C1A\u672A\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F",
      latestCommit: "\u6700\u65B0\u63D0\u4EA4",
      switch: "\u5207\u6362\u5230\u6B64\u5206\u652F",
      switchCurrent: "\u5DF2\u5728\u5F53\u524D\u5206\u652F",
      merge: "\u5408\u5E76\u5230\u5F53\u524D\u5206\u652F",
      mergeHint: "\u628A\u8FD9\u6761\u5206\u652F\u7684\u63D0\u4EA4\u5E76\u8FDB\u5F53\u524D\u5206\u652F\u3002\u6709\u51B2\u7A81\u65F6\u4F1A\u505C\u4E0B\u7B49\u4F60\u5904\u7406\u3002",
      rename: "\u91CD\u547D\u540D",
      delete: "\u5220\u9664\u5206\u652F",
      deleteTitle: (name) => `\u5220\u9664\u5206\u652F ${name}\uFF1F`,
      deleteBody: "\u53EA\u5220\u672C\u5730\u8BB0\u5F55\uFF0C\u8FDC\u7AEF\u5206\u652F\u4E0D\u53D7\u5F71\u54CD\u3002\u8FD9\u6761\u5206\u652F\u72EC\u6709\u7684\u63D0\u4EA4\u4F1A\u4E00\u8D77\u4E22\u6389\uFF0C\u9762\u677F\u4E0D\u80FD\u6062\u590D\u3002",
      deleteConfirm: "\u786E\u8BA4\u5220\u9664",
      switchDirtyTitle: "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8\uFF0C\u4ECD\u8981\u5207\u6362\uFF1F",
      switchDirtyBody: "\u5207\u6362\u540E\u8FD9\u4E9B\u6539\u52A8\u4F1A\u8DDF\u7740\u5E26\u5230\u76EE\u6807\u5206\u652F\u3002\u4E24\u8FB9\u6539\u5230\u540C\u4E00\u5904\u65F6 git \u4F1A\u62D2\u7EDD\u5207\u6362\u5E76\u8BF4\u660E\u539F\u56E0\u3002",
      switchConfirm: "\u7EE7\u7EED\u5207\u6362",
      cancel: "\u53D6\u6D88",
      back: "\u8FD4\u56DE\u9762\u677F",
      backList: "\u8FD4\u56DE\u5217\u8868",
      listTitle: "\u672C\u5730\u5206\u652F",
      branchLabel: "\u5206\u652F\u540D",
      createTitle: "\u65B0\u5EFA\u5206\u652F",
      createFrom: (name) => `\u4ECE ${name} \u7684\u5F53\u524D\u63D0\u4EA4\u521B\u5EFA`,
      createPlaceholder: "\u5206\u652F\u540D\uFF0C\u4F8B\u5982 feature/version-control",
      nameHint: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002",
      create: "\u521B\u5EFA\u5206\u652F",
      renameTitle: "\u91CD\u547D\u540D\u5206\u652F",
      renamePlaceholder: "\u65B0\u7684\u5206\u652F\u540D",
      renameSubmit: "\u4FDD\u5B58\u65B0\u540D\u5B57",
      empty: "\u6CA1\u6709\u5339\u914D\u7684\u5206\u652F\u3002",
      detailEmpty: "\u8FD9\u6761\u5206\u652F\u5DF2\u7ECF\u4E0D\u5728\u5217\u8868\u91CC\u3002",
      resultCreated: (name) => `\u5DF2\u521B\u5EFA\u5206\u652F ${name}\uFF0C\u8FD8\u6CA1\u6709\u5207\u6362\u8FC7\u53BB\u3002`,
      resultSwitched: (name) => `\u5DF2\u5207\u6362\u5230\u5206\u652F ${name}\u3002`,
      resultMerged: (target, current, n) => `\u5DF2\u628A ${target} \u5408\u5E76\u8FDB ${current}\uFF0C\u63A5\u5165 ${n} \u4E2A\u63D0\u4EA4\u3002`,
      resultMergedClean: (target, current) => `\u5DF2\u628A ${target} \u5408\u5E76\u8FDB ${current}\uFF0C\u6CA1\u6709\u65B0\u63D0\u4EA4\u9700\u8981\u63A5\u5165\u3002`,
      resultRenamed: (from, to) => `\u5206\u652F ${from} \u5DF2\u6539\u540D\u4E3A ${to}\u3002`,
      resultDeleted: (name) => `\u5DF2\u5220\u9664\u5206\u652F ${name}\u3002`,
      invalidName: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002",
      duplicateName: (name) => `\u5206\u652F ${name} \u5DF2\u7ECF\u5B58\u5728\u3002`,
      cannotDeleteCurrent: "\u4E0D\u80FD\u5220\u9664\u5F53\u524D\u5206\u652F\uFF0C\u5148\u5207\u6362\u5230\u522B\u7684\u5206\u652F\u3002",
      cannotMergeCurrent: "\u4E0D\u80FD\u628A\u5F53\u524D\u5206\u652F\u5408\u5E76\u8FDB\u5B83\u81EA\u5DF1\u3002",
      rebase: "\u53D8\u57FA\u5230\u8FD9\u91CC",
      rebaseCurrent: "\u5F53\u524D\u5206\u652F\u5C31\u662F\u5B83\uFF0C\u4E0D\u80FD\u53D8\u57FA\u5230\u81EA\u5DF1\u3002",
      rebaseTitle: (current, target) => `\u628A ${current} \u53D8\u57FA\u5230 ${target} \u4E0A\uFF1F`,
      rebaseBody: "\u672C\u5730\u5386\u53F2\u4F1A\u88AB\u91CD\u5199\uFF1A\u5148\u653E\u5BF9\u65B9\u5206\u652F\u7684\u63D0\u4EA4\uFF0C\u518D\u63A5\u4E0A\u81EA\u5DF1\u7684\u63D0\u4EA4\u3002\u63D0\u4EA4\u53F7\u4F1A\u53D8\u3002\u5982\u679C\u8FD9\u6761\u5206\u652F\u5DF2\u7ECF\u63A8\u9001\u8FC7\uFF0C\u8FDC\u7AEF\u9700\u8981\u5F3A\u63A8\u624D\u80FD\u5BF9\u9F50\u3002",
      rebaseConfirm: "\u786E\u8BA4\u53D8\u57FA"
    },
    worktrees: {
      current: "\u5F53\u524D\u5DE5\u4F5C\u6811",
      others: (n) => `\u5176\u4ED6\u5DE5\u4F5C\u6811 ${n}`,
      empty: "\u4E0D\u5B58\u5728\u5176\u4ED6\u5DE5\u4F5C\u6811",
      emptyHint: "\u6BCF\u68F5\u5DE5\u4F5C\u6811\u90FD\u8981\u5355\u72EC\u68C0\u51FA\u3002\u5C55\u5F00\u4E00\u884C\u53EF\u4EE5\u89E3\u9501\u3001\u6E05\u7406\u8BB0\u5F55\u6216\u79FB\u9664\u3002",
      locked: "\u5DF2\u88AB\u5360\u7528",
      prunable: "\u76EE\u5F55\u4E0D\u5B58\u5728",
      lockUnknown: "\u65E0\u6CD5\u5224\u65AD",
      prunableUnknown: "\u65E0\u6CD5\u5224\u65AD",
      bare: "\u88F8\u4ED3\u5E93",
      noBranch: "\u65E0\u5206\u652F",
      copyPath: "\u590D\u5236\u8DEF\u5F84",
      scope: "\u8FD9\u91CC\u5217\u51FA\u5F53\u524D git \u8BB0\u5F55\u7684\u5176\u4ED6\u5DE5\u4F5C\u6811\u3002\u672A\u68C0\u51FA\u7684\u672C\u5730\u5206\u652F\u4E0D\u5728\u8FD9\u91CC\u3002",
      noticeClose: "\u5173\u95ED\u8FD9\u6761\u8BF4\u660E",
      noticeOpen: "\u663E\u793A\u5DE5\u4F5C\u6811\u8303\u56F4\u8BF4\u660E",
      filterAll: "\u5168\u90E8",
      filterAbnormal: "\u9700\u8981\u5904\u7406",
      filterEmpty: "\u6CA1\u6709\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\u7684\u5DE5\u4F5C\u6811\u3002",
      expand: "\u5C55\u5F00\u8BE6\u60C5",
      collapse: "\u6536\u8D77\u8BE6\u60C5",
      detailPath: "\u5B8C\u6574\u8DEF\u5F84",
      detailBranch: "\u5206\u652F",
      detailHead: "\u5F53\u524D\u63D0\u4EA4",
      detailState: "\u72B6\u6001\u8BF4\u660E",
      unlock: "\u89E3\u9664\u9501\u5B9A",
      pruneRecord: "\u6E05\u7406\u8BB0\u5F55",
      remove: "\u79FB\u9664\u5DE5\u4F5C\u6811",
      unlockTitle: "\u89E3\u9664\u8FD9\u68F5\u5DE5\u4F5C\u6811\u7684\u5360\u7528\uFF1F",
      unlockBody: "\u89E3\u9501\u53EA\u6E05\u6389 git \u7684\u5360\u7528\u6807\u8BB0\uFF0C\u5DE5\u4F5C\u76EE\u5F55\u4E0E\u6539\u52A8\u90FD\u4E0D\u4F1A\u52A8\u3002\u5982\u679C\u6709\u7EC8\u7AEF\u6B63\u5728\u91CC\u9762\u8DD1\u4EFB\u52A1\uFF0C\u4E24\u8FB9\u53EF\u80FD\u4E92\u76F8\u6253\u65AD\u3002",
      unlockConfirm: "\u89E3\u9664\u5360\u7528",
      pruneTitle: "\u6E05\u7406\u8FD9\u6761\u5DF2\u7ECF\u4E0D\u5B58\u5728\u7684\u5DE5\u4F5C\u6811\u8BB0\u5F55\uFF1F",
      pruneBody: "\u53EA\u6E05\u6389 git \u8BB0\u5F55\uFF0C\u4E0D\u4F1A\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\u3002\u76EE\u5F55\u786E\u5B9E\u4E0D\u5B58\u5728\u65F6\u624D\u5E94\u8BE5\u70B9\u3002",
      pruneConfirm: "\u6E05\u7406\u8BB0\u5F55",
      removeTitle: (name) => `\u79FB\u9664\u5DE5\u4F5C\u6811 ${name}\uFF1F`,
      removeBody: "\u5220\u9664 git \u8BB0\u5F55\u4E0E\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u5206\u652F\u548C\u63D0\u4EA4\u90FD\u7559\u5728\u4ED3\u5E93\u91CC\u3002\u76EE\u5F55\u91CC\u6709\u672A\u63D0\u4EA4\u6539\u52A8\u65F6\u8FD9\u4E00\u6B65\u4F1A\u88AB\u62D2\u7EDD\u3002",
      removeConfirm: "\u786E\u8BA4\u79FB\u9664",
      cancel: "\u53D6\u6D88",
      resultUnlocked: (name) => `\u5DF2\u89E3\u9664\u5360\u7528\uFF1A${name}\u3002`,
      resultPruned: (name) => `\u5DF2\u6E05\u7406\u8BB0\u5F55\uFF1A${name}\u3002`,
      resultRemoved: (name) => `\u5DF2\u79FB\u9664\u5DE5\u4F5C\u6811\uFF1A${name}\u3002`,
      ai: "\u8BA9 AI \u5904\u7406\u5F02\u5E38\u5DE5\u4F5C\u6811"
    },
    /**
     * 收起改动页签：git stash 的完整生命周期。文案只说用户能看见的两件事——
     * 这条记录里放着什么、这一下是拿回来还是彻底丢掉。
     */
    stash: {
      title: "\u6536\u8D77\u7684\u6539\u52A8",
      lede: "\u628A\u6682\u65F6\u4E0D\u60F3\u63D0\u4EA4\u7684\u6539\u52A8\u6253\u5305\u6536\u8D77\u6765\uFF0C\u4E4B\u540E\u80FD\u653E\u56DE\u5DE5\u4F5C\u533A\u63A5\u7740\u505A\u3002",
      empty: "\u8FD8\u6CA1\u6709\u6536\u8D77\u8FC7\u6539\u52A8",
      emptyHint: "\u5728\u300C\u6539\u52A8\u300D\u9875\u7B7E\u91CC\u70B9\u300C\u6536\u8D77\u6539\u52A8\u300D\uFF0C\u5C31\u80FD\u628A\u5F53\u65F6\u7684\u6539\u52A8\u6253\u5305\u6536\u597D\u3002",
      entryMeta: (when, n) => `${when} \xB7 ${n} \u4E2A\u6587\u4EF6`,
      pathsNote: "\u8BB0\u5F55\u91CC\u4FDD\u5B58\u7684\u662F\u6539\u52A8\u5F53\u65F6\u7684\u6837\u5B50\u3002\u653E\u56DE\u5DE5\u4F5C\u533A\u4EE5\u540E\uFF0C\u8981\u91CD\u65B0\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u518D\u63D0\u4EA4\u3002",
      apply: "\u653E\u56DE\u5DE5\u4F5C\u533A",
      pop: "\u653E\u56DE\u5E76\u5220\u6389\u8BB0\u5F55",
      drop: "\u4E22\u5F03\u8BB0\u5F55",
      applyHint: "\u628A\u6539\u52A8\u653E\u56DE\u5DE5\u4F5C\u533A\uFF0C\u8FD9\u6761\u8BB0\u5F55\u8FD8\u4FDD\u7559\u7740",
      popHint: "\u628A\u6539\u52A8\u653E\u56DE\u5DE5\u4F5C\u533A\uFF0C\u540C\u65F6\u5220\u6389\u8FD9\u6761\u8BB0\u5F55",
      dropTitle: (id) => `\u4E22\u5F03\u8BB0\u5F55 ${id}\uFF1F`,
      dropBody: "\u8BB0\u5F55\u91CC\u90A3\u4E9B\u6587\u4EF6\u5F53\u65F6\u7684\u6837\u5B50\u4F1A\u5F7B\u5E95\u6D88\u5931\uFF0C\u9762\u677F\u4E0D\u80FD\u6062\u590D\u3002",
      dropConfirm: "\u786E\u8BA4\u4E22\u5F03",
      cancel: "\u53D6\u6D88",
      showPaths: "\u770B\u770B\u8FD9\u4EFD\u8BB0\u5F55\u91CC\u6709\u54EA\u4E9B\u6587\u4EF6",
      hidePaths: "\u6536\u8D77\u6587\u4EF6\u6E05\u5355",
      boundary: "\u6536\u8D77\u8BB0\u5F55\u53EA\u5728\u672C\u5730\uFF0C\u4E0D\u4F1A\u63A8\u9001\u3002\u653E\u56DE\u5DE5\u4F5C\u533A\u65F6\u6309\u8BB0\u5F55\u91CC\u7684\u987A\u5E8F\u6062\u590D\u3002",
      restoreNote: (n) => `\u653E\u56DE\u65F6\u4F1A\u6062\u590D ${n} \u4E2A\u6587\u4EF6\uFF0C\u5DF2\u5B58\u5728\u7684\u540C\u540D\u6539\u52A8\u4F1A\u88AB\u5408\u5E76\u6216\u63D0\u793A\u51B2\u7A81\u3002`
    },
    /**
     * AI 交接的全部文案。入口上的那几句故意写成问句：它们要让人意识到
     * 「这件事可以不用自己硬扛」，而不是描述一个功能按钮。
     */
    ai: {
      kicker: "AI HANDOFF",
      copyLabel: "\u590D\u5236\u8FD9\u6BB5\u8BF4\u660E",
      copied: (n) => `\u5DF2\u590D\u5236 ${n} \u4E2A\u5B57\u7B26\uFF0C\u7C98\u8D34\u5230\u65B0\u5BF9\u8BDD\u91CC\u5C31\u80FD\u63A5\u7740\u8C08\u3002`,
      closeLabel: "\u5173\u95ED",
      closeTitle: "\u5173\u95ED\u8FD9\u4EFD\u8BF4\u660E",
      footNote: "\u8BF4\u660E\u91CC\u5305\u542B\u5B8C\u6574\u8DEF\u5F84\u4E0E\u6587\u4EF6\u6E05\u5355\uFF0C\u7C98\u8D34\u524D\u53EF\u4EE5\u5148\u5220\u6389\u4E0D\u60F3\u5916\u53D1\u7684\u90E8\u5206\u3002\u539F\u578B\u91CC\u4E0D\u4F1A\u771F\u7684\u6253\u5F00\u65B0\u5BF9\u8BDD\u3002\u63A5\u5165\u5BBF\u4E3B\u540E\uFF0C\u70B9\u4E00\u4E0B\u5C31\u76F4\u63A5\u8FDB\u5165\u65B0\u5BF9\u8BDD\u3002",
      railSub: "\u4E0D\u719F\u6089 Git \u4E5F\u6CA1\u5173\u7CFB\uFF1A\u4ED3\u5E93\u3001\u5206\u652F\u3001\u6539\u52A8\u3001\u5DE5\u4F5C\u6811\u4E00\u8D77\u5E26\u8FC7\u53BB",
      entryTitle: "\u4E0D\u60F3\u4EB2\u81EA\u5904\u7406\uFF1F\u4EA4\u7ED9 AI",
      cleanEntry: "\u60F3\u628A\u5DE5\u4F5C\u6811\u4ECE\u5934\u7406\u4E00\u904D\uFF1F\u4EA4\u7ED9 AI",
      entryAria: (label) => `${label}\uFF1A\u628A\u5F53\u524D\u7248\u672C\u7BA1\u7406\u9875\u7684\u5B8C\u6574\u72B6\u6001\u5E26\u8FDB\u65B0\u5BF9\u8BDD`
    },
    result: {
      committed: (n) => `\u63D0\u4EA4\u5B8C\u6210\uFF1A${n} \u4E2A\u6587\u4EF6\u5DF2\u8FDB\u5165\u5386\u53F2\u3002`,
      pushed: (n, upstream) => `\u63A8\u9001\u5B8C\u6210\uFF1A${n} \u7B14\u63D0\u4EA4\u5DF2\u5230\u8FBE ${upstream}\u3002`,
      nothingToPush: "\u8FDC\u7AEF\u5DF2\u662F\u6700\u65B0\uFF0C\u6CA1\u6709\u9700\u8981\u63A8\u9001\u7684\u63D0\u4EA4\u3002",
      pullUpToDate: "\u5DF2\u662F\u6700\u65B0\u72B6\u6001\u3002",
      pullFastForward: "\u5DF2\u76F4\u63A5\u66F4\u65B0\u5230\u8FDC\u7AEF\u6700\u65B0\u3002",
      fetched: "\u66F4\u65B0\u5B8C\u6210\uFF1A\u8FDC\u7AEF\u4F9D\u636E\u5DF2\u5237\u65B0\u3002",
      reloaded: "\u5DF2\u91CD\u65B0\u8BFB\u53D6\u3002",
      aiWorktrees: "\u539F\u578B\u91CC AI \u4EA4\u63A5\u53EA\u505A\u63D0\u793A\u3002\u771F\u5B9E\u9875\u9762\u4F1A\u6253\u5F00\u672C\u673A DSH \u4F1A\u8BDD\uFF0C\u5E76\u5E26\u4E0A\u5F02\u5E38\u5DE5\u4F5C\u6811\u6E05\u5355\u3002",
      simulated: "\u539F\u578B\u6A21\u62DF"
    },
    changeLabel: {
      added: "\u65B0\u589E",
      modified: "\u4FEE\u6539",
      deleted: "\u5220\u9664",
      renamed: "\u91CD\u547D\u540D",
      typechange: "\u7C7B\u578B\u53D8\u66F4",
      untracked: "\u672A\u8DDF\u8E2A"
    }
  };

  // src/shared/version-control/src/state.ts
  function shortestUniqueSuffix(paths) {
    const segs = paths.map((p) => String(p).replace(/\\/g, "/").split("/").filter((s) => s !== ""));
    return segs.map((s, i) => {
      for (let n = 1; n <= s.length; n += 1) {
        const tail = s.slice(-n).join("/").toLowerCase();
        let clash = false;
        for (let j = 0; j < segs.length; j += 1) {
          if (j === i) continue;
          if (segs[j].slice(-n).join("/").toLowerCase() === tail) {
            clash = true;
            break;
          }
        }
        if (!clash) return n;
      }
      return s.length;
    });
  }
  function sameWorktreePath(a, b) {
    const norm = (p) => {
      const s = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
      const drive = /^([a-zA-Z]):/.exec(s);
      return drive ? s.charAt(0).toLowerCase() + s.slice(1) : s;
    };
    return norm(a) === norm(b);
  }
  function displayFor(path, keep) {
    const segs = String(path).replace(/\\/g, "/").split("/").filter((s) => s !== "");
    return segs.slice(-Math.max(1, keep)).join("/");
  }
  function describeTime(nowMs, tMs) {
    const diff = nowMs - tMs;
    if (diff >= 0 && diff < 7 * 24 * 3600 * 1e3) return { style: "relative", minutes: Math.max(0, Math.floor(diff / 6e4)) };
    return { style: "absolute", ms: tMs };
  }
  function toChange(e) {
    if (e.kind === "untracked") return { change: "untracked", conflict: false };
    if (e.kind === "unmerged") return { change: "modified", conflict: true };
    if (e.kind === "renamed") return { change: "renamed", conflict: false };
    if (e.kind === "ignored") return { change: "modified", conflict: false };
    if (e.x === "A" || e.y === "A") return { change: "added", conflict: false };
    if (e.x === "D" || e.y === "D") return { change: "deleted", conflict: false };
    if (e.x === "T" || e.y === "T") return { change: "typechange", conflict: false };
    return { change: "modified", conflict: false };
  }
  function rankFor(f) {
    if (f.staged) return 0;
    if (f.conflict) return 1;
    return 2;
  }
  function assemble(input) {
    if (input.bare) {
      const repo2 = { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: input.commits.length > 0, bare: true, tier: input.tier, autocrlf: input.autocrlf };
      const identity2 = { worktreeDisplay: "", worktreePath: input.repoRoot, branch: null, detached: false, oid: null, sync: "detached", ahead: 0, behind: 0, basisMs: null };
      return { ok: true, screen: { identity: identity2, staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0, otherWorktrees: [], branches: [], commits: [], repo: repo2 } };
    }
    const counts = /* @__PURE__ */ new Map();
    for (const d of input.diffFiles) counts.set(d.path, d);
    const files = [];
    for (const e of input.statusEntries) {
      if (e.kind === "ignored") continue;
      const { change, conflict } = toChange(e);
      const c = counts.get(e.path);
      files.push({
        path: e.path,
        origPath: e.origPath,
        // 冲突（unmerged）既不是已暂存也不是未暂存，是一个待处理状态：两个标记都置 false，
        // 免得同一个文件被同时算进两组（#819 复审 P0-2）；未跟踪就是未暂存的改动，unstaged 置真（P2-7）。
        staged: e.kind === "unmerged" ? false : e.x !== "." && e.x !== "?" && e.x !== "!",
        unstaged: e.kind === "unmerged" ? false : e.y !== "." && e.y !== "?" && e.y !== "!" || e.kind === "untracked",
        change,
        conflict,
        addedLines: c ? c.added : null,
        deletedLines: c ? c.deleted : null
      });
    }
    files.sort((a, b) => rankFor(a) - rankFor(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const staged = files.filter((f) => f.staged);
    const unstaged = files.filter((f) => f.unstaged || f.conflict);
    const allPaths = input.worktrees.map((w) => w.path);
    const keeps = shortestUniqueSuffix(allPaths.length > 0 ? allPaths : [input.repoRoot]);
    let currentPath = input.repoRoot;
    const byPath = input.worktrees.find((w) => sameWorktreePath(w.path, input.repoRoot));
    if (byPath) currentPath = byPath.path;
    else if (!input.statusDetached && input.statusHead) {
      const hit = input.worktrees.find((w) => w.branch === input.statusHead);
      if (hit) currentPath = hit.path;
    } else if (input.statusDetached && input.statusOid) {
      const hit = input.worktrees.find((w) => w.head === input.statusOid);
      if (hit) currentPath = hit.path;
    }
    let sync = "no-upstream";
    if (input.statusDetached) sync = "detached";
    else if (!input.statusUpstream) sync = "no-upstream";
    else {
      const ref = input.refs.find((r) => r.short === input.statusHead);
      if (ref && ref.upstreamGone) sync = "upstream-gone";
      else if (input.basisMs === null) sync = "tracked-unknown";
      else sync = "tracked-known";
    }
    const keepOf = (p) => {
      const i = input.worktrees.findIndex((w) => sameWorktreePath(w.path, p));
      return (i >= 0 ? keeps[i] : 1) || 1;
    };
    const identity = {
      worktreeDisplay: displayFor(currentPath, keepOf(currentPath)),
      worktreePath: currentPath,
      branch: input.statusDetached ? null : input.statusHead,
      detached: input.statusDetached,
      oid: input.statusOid,
      sync,
      ahead: input.statusAhead,
      behind: input.statusBehind,
      basisMs: input.basisMs
    };
    const others = input.worktrees.filter((w) => !sameWorktreePath(w.path, currentPath)).map((w) => ({
      path: w.path,
      display: displayFor(w.path, keepOf(w.path)),
      head: w.head || "",
      branch: w.branch,
      bare: w.bare,
      current: false,
      locked: w.locked,
      lockReason: w.lockReason,
      // 降级档（git 2.11–2.30）答不出「被锁定」与「目录还在不在」这两件事：答不出写成 unknown，
      // 绝不当成 false —— 否则界面会把一个目录已经不存在的工作树画成还能用（#819 复审 P1-5）。
      lockUnknown: input.tier !== "full" && !w.locked,
      prunable: w.prunable,
      prunableUnknown: input.tier !== "full" && !w.prunable
    }));
    const commits = input.commits.map((c) => ({
      oid: c.oid,
      short: c.short,
      author: c.author,
      email: c.email,
      authorDateMs: c.authorDateMs,
      commitDateMs: c.commitDateMs,
      subject: c.subject,
      parents: c.parents
    }));
    const branches = input.refs.map((r) => ({
      short: r.short,
      oid: r.oid,
      upstream: r.upstream,
      upstreamGone: r.upstreamGone,
      ahead: r.ahead,
      behind: r.behind,
      current: r.short === input.statusHead && !input.statusDetached
    }));
    const repo = {
      merging: input.merging,
      rebasing: input.rebasing,
      cherryPicking: input.cherryPicking,
      reverting: input.reverting,
      hasCommits: input.statusOid !== null || commits.length > 0,
      bare: false,
      tier: input.tier,
      autocrlf: input.autocrlf
    };
    return {
      ok: true,
      screen: {
        identity,
        staged,
        unstaged,
        stagedCount: files.filter((f) => f.staged).length,
        unstagedCount: files.filter((f) => f.unstaged).length,
        conflictCount: files.filter((f) => f.conflict).length,
        otherWorktrees: others,
        branches,
        commits,
        repo
      }
    };
  }

  // src/shared/version-control/src/rules.ts
  function midReasons(s) {
    const out = [];
    if (s.repo.merging) out.push("mid-merge");
    if (s.repo.rebasing) out.push("mid-rebase");
    if (s.repo.cherryPicking || s.repo.reverting) out.push("mid-cherry-revert");
    return out;
  }
  function judgeStage(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.unstagedCount === 0) return { verdict: "block", reasons: ["nothing-to-stage"] };
    const mid = midReasons(s);
    if (mid.length > 0) return { verdict: "warn", reasons: mid };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgeCommit(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.conflictCount > 0) return { verdict: "block", reasons: ["conflicts-unresolved"] };
    if (s.stagedCount === 0) return { verdict: "block", reasons: ["nothing-staged"] };
    const mid = midReasons(s);
    if (s.identity.detached) return { verdict: "warn", reasons: ["detached-head"].concat(mid) };
    if (mid.length > 0) return { verdict: "warn", reasons: mid };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgePull(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.identity.detached) return { verdict: "block", reasons: ["detached-head"] };
    if (s.identity.sync === "no-upstream") return { verdict: "block", reasons: ["no-upstream"] };
    if (s.identity.sync === "upstream-gone") return { verdict: "block", reasons: ["upstream-gone"] };
    if (s.conflictCount > 0) return { verdict: "block", reasons: ["conflicts-unresolved"] };
    const mid = midReasons(s);
    if (mid.length > 0) return { verdict: "block", reasons: mid };
    if (s.stagedCount > 0 || s.unstagedCount > 0) return { verdict: "warn", reasons: ["dirty-tree"] };
    if (s.identity.basisMs === null) return { verdict: "warn", reasons: ["basis-unknown"] };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgePush(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.identity.detached) return { verdict: "block", reasons: ["detached-head"] };
    if (s.identity.sync === "no-upstream") return { verdict: "block", reasons: ["no-upstream"] };
    if (s.identity.sync === "upstream-gone") return { verdict: "block", reasons: ["upstream-gone"] };
    if (s.conflictCount > 0) return { verdict: "block", reasons: ["conflicts-unresolved"] };
    const mid = midReasons(s);
    if (mid.length > 0) return { verdict: "block", reasons: mid };
    if (s.identity.behind > 0) return { verdict: "block", reasons: ["behind-remote"] };
    if (s.identity.basisMs === null) return { verdict: "warn", reasons: ["basis-unknown"] };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgeFetch(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judge(screen, op) {
    switch (op) {
      case "stage":
        return judgeStage(screen);
      case "commit":
        return judgeCommit(screen);
      case "pull":
        return judgePull(screen);
      case "push":
        return judgePush(screen);
      case "fetch":
        return judgeFetch(screen);
      default:
        return { verdict: "block", reasons: ["unknown-operation"] };
    }
  }

  // docs/prototype/vc-redesign/src/data/format.ts
  function whenText(nowMs, ms) {
    const described = describeTime(nowMs, ms);
    if (described.style === "absolute") return clockText(described.ms, nowMs);
    const minutes = described.minutes;
    if (minutes < 1) return "\u521A\u521A";
    if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    return `${Math.floor(hours / 24)} \u5929\u524D`;
  }
  function clockText(ms, nowMs) {
    const date = new Date(ms);
    const now = new Date(nowMs);
    const pad = (n) => String(n).padStart(2, "0");
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return date.getFullYear() === now.getFullYear() ? `${month} \u6708 ${day} \u65E5 ${time}` : `${date.getFullYear()} \u5E74 ${month} \u6708 ${day} \u65E5`;
  }
  function splitPath(path) {
    const normalized = path.replace(/\\/g, "/");
    const cut = normalized.lastIndexOf("/");
    if (cut < 0) return { dir: "", name: normalized };
    return { dir: normalized.slice(0, cut + 1), name: normalized.slice(cut + 1) };
  }
  function changeBadge(change) {
    switch (change) {
      case "added":
        return { letter: "A", tone: "add" };
      case "deleted":
        return { letter: "D", tone: "del" };
      case "renamed":
        return { letter: "R", tone: "rename" };
      case "typechange":
        return { letter: "T", tone: "type" };
      case "untracked":
        return { letter: "?", tone: "untracked" };
      default:
        return { letter: "M", tone: "mod" };
    }
  }
  function syncModel(sync, ahead, behind) {
    switch (sync) {
      case "tracked-known":
      case "tracked-unknown":
        return { kind: "counts", ahead, behind };
      case "no-upstream":
        return { kind: "text", text: "\u5C1A\u672A\u8BBE\u7F6E\u4E0A\u6E38", tone: "muted" };
      case "upstream-gone":
        return { kind: "text", text: "\u63A8\u9001\u76EE\u6807\u5DF2\u4E0D\u5B58\u5728", tone: "warn" };
      case "detached":
        return { kind: "text", text: "\u6E38\u79BB\u5934\u6307\u9488", tone: "muted" };
      default:
        return { kind: "text", text: "\u540C\u6B65\u72B6\u6001\u8BFB\u4E0D\u5230", tone: "warn" };
    }
  }
  function lineDelta(added, deleted) {
    return {
      added: added === null || added === 0 ? null : `+${added}`,
      deleted: deleted === null || deleted === 0 ? null : `\u2212${deleted}`
    };
  }
  function shortOid(oid) {
    return oid.slice(0, 7);
  }

  // docs/prototype/vc-redesign/src/data/repo.generated.ts
  var capturedRepoRoot = "D:\\dsh-plugin\\dsh-mattpocock-skills-deck";
  var capturedHead = "e489673f240ed18a2e71bb6de5bfc635b2fed73c";
  var capturedBranch = "main";
  var capturedCommits = [
    {
      "oid": "e489673f240ed18a2e71bb6de5bfc635b2fed73c",
      "short": "e489673f",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793384302e3,
      "subject": "\u5730\u56FE\u6267\u884C\u5165\u53E3\u63D0\u793A\u8BCD\u5347\u5230 v23\uFF1A\u8865\u5F00\u5DE5\u3001\u63A8\u8FDB\u3001\u5173 issue\u3001\u6536\u5C3E\u56DB\u8282\u64CD\u4F5C\u7EA6\u675F",
      "parents": [
        "1901ff9b39746ad1ef143e2595425333363f8735"
      ],
      "files": [
        {
          "path": "config/prompts/map-advancement.yaml",
          "added": 36,
          "deleted": 4
        },
        {
          "path": "tests/verify-prompts.ts",
          "added": 7,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "1901ff9b39746ad1ef143e2595425333363f8735",
      "short": "1901ff9b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793377576e3,
      "subject": "\u56DE\u586B\u89C4\u683C\u7968 #1681 \u5230\u4E24\u4EFD ADR \u4E0E\u8FC1\u79FB\u8BA1\u5212\uFF0C\u4FEE\u6B63\u9884\u7B97\u3001\u63A2\u9488\u4E0E\u901A\u77E5\u53E3\u5F84",
      "parents": [
        "694c955ca1ec363721e8e8ea1fae551c6b519096"
      ],
      "files": [
        {
          "path": "docs/adr/20261030-github-room-channel-layering.md",
          "added": 22,
          "deleted": 16
        },
        {
          "path": "docs/adr/20261030-panel-snapshot-single-source.md",
          "added": 27,
          "deleted": 8
        },
        {
          "path": "docs/design/20261030-panel-snapshot-and-room-layering-plan.md",
          "added": 16,
          "deleted": 12
        }
      ]
    },
    {
      "oid": "694c955ca1ec363721e8e8ea1fae551c6b519096",
      "short": "694c955c",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179337722e4,
      "subject": "\u65B0\u589E #1680 \u63A2\u9488\u7B14\u8BB0\uFF1AGitLab \u5DE5\u4F5C\u533A\u5939\u5177\u4E0E\u771F\u673A\u5DE5\u5177\u53F0\u7F3A\u53E3",
      "parents": [
        "69e8ba637c12f6bc1fb8dbea2b7bb08295d70f62"
      ],
      "files": [
        {
          "path": "research/1680-gitlab-workspace-fixture.md",
          "added": 195,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "69e8ba637c12f6bc1fb8dbea2b7bb08295d70f62",
      "short": "69e8ba63",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793374917e3,
      "subject": "\u5B9A\u7A3F\u9762\u677F\u5FEB\u7167\u5355\u4E00\u6570\u636E\u6E90\u4E0E GitHub \u623F\u95F4\u5206\u5C42\uFF1A\u65B0\u589E\u4E24\u4EFD ADR\u3001\u8FC1\u79FB\u8BA1\u5212\u4E0E\u672F\u8BED\uFF0C\u5E76\u8865\u4E24\u4EFD\u8C03\u7814\u7B14\u8BB0",
      "parents": [
        "efb092abe0a797c821d077aba9e7d27f7b18b66e"
      ],
      "files": [
        {
          "path": "GLOSSARY.md",
          "added": 8,
          "deleted": 2
        },
        {
          "path": "docs/adr/20261030-github-room-channel-layering.md",
          "added": 93,
          "deleted": 0
        },
        {
          "path": "docs/adr/20261030-panel-snapshot-single-source.md",
          "added": 88,
          "deleted": 0
        },
        {
          "path": "docs/design/20261030-panel-snapshot-and-room-layering-plan.md",
          "added": 81,
          "deleted": 0
        },
        {
          "path": "research/graphql-rest-fallback-2026-10-30.md",
          "added": 202,
          "deleted": 0
        },
        {
          "path": "research/rest-graphql-read-parity-2026-10-30.md",
          "added": 221,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "efb092abe0a797c821d077aba9e7d27f7b18b66e",
      "short": "efb092ab",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793374886e3,
      "subject": "\u8865\u8BB0\u7B2C\u4E8C\u8F6E git \u8FB9\u754C\u5B9E\u6D4B\uFF1A\u5F85\u529E\u6E05\u5355\u8986\u76D6\u3001\u5408\u5E76\u8BF4\u660E\u4E0E\u5DE5\u4F5C\u6811\u79FB\u9664",
      "parents": [
        "637957e6b94aa42e391f8e6b9f50026ddbf2b480"
      ],
      "files": [
        {
          "path": "research/1593-git-boundary-facts.md",
          "added": 12,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "637957e6b94aa42e391f8e6b9f50026ddbf2b480",
      "short": "637957e6",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793374192e3,
      "subject": "\u52A0\u5165 GitLab \u4E0E GitHub \u771F\u673A\u5DEE\u5F02\u7814\u7A76\u7B14\u8BB0\uFF08#1679\uFF09",
      "parents": [
        "ad540ebdff821cebab90629bee31ba3d22044dcb"
      ],
      "files": [
        {
          "path": "research/1679-gitlab-vs-github-differences.md",
          "added": 212,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "ad540ebdff821cebab90629bee31ba3d22044dcb",
      "short": "ad540ebd",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793373923e3,
      "subject": "\u52A0\u5165 GitLab \u6A21\u5F0F\u7528\u6237\u53EF\u89C1\u8DEF\u5F84\u7814\u7A76\u7B14\u8BB0\uFF08#1674\uFF09",
      "parents": [
        "3c18b76a76d6fbfba04230f726c1755efa19210a"
      ],
      "files": [
        {
          "path": "research/1674-gitlab-visible-surfaces.md",
          "added": 180,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "3c18b76a76d6fbfba04230f726c1755efa19210a",
      "short": "3c18b76a",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793373488e3,
      "subject": "\u8865 #1593 \u7814\u7A76\u7B14\u8BB0\uFF1A\u4E5D\u7EC4 git \u8FB9\u754C\u884C\u4E3A\u672C\u673A\u5B9E\u6D4B",
      "parents": [
        "3ac57926414397374d86e8018d82b1501a0e6f3d"
      ],
      "files": [
        {
          "path": "research/1593-git-boundary-facts.md",
          "added": 146,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "3ac57926414397374d86e8018d82b1501a0e6f3d",
      "short": "3ac57926",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793369634e3,
      "subject": "\u5408\u5E76\u8FDC\u7AEF\u4E3B\u7EBF\u7684\u6700\u65B0\u63D0\u4EA4\uFF0C\u89E3\u51B3\u4E0E #1665\u3001#1671 \u7B49\u6539\u52A8\u7684\u4EA4\u53C9\uFF08#1667\uFF09",
      "parents": [
        "4bdb7aa3f808c674c32e243b7d726b110f06def7",
        "3a464062fb6af7d007de618c265ba6702866c2fe"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/star-history-dark.svg",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "docs/star-history-light.svg",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "docs/star-history.json",
          "added": 7,
          "deleted": 2
        },
        {
          "path": "docs/thanks-data.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "package/README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "research/1671-triage-2026-10-30.md",
          "added": 149,
          "deleted": 0
        },
        {
          "path": "scripts/gate-map.mts",
          "added": 8,
          "deleted": 2
        },
        {
          "path": "src/client/statusbar/suggestAppearance.ts",
          "added": 10,
          "deleted": 8
        },
        {
          "path": "src/client/statusbar/suggestBubble.ts",
          "added": 51,
          "deleted": 18
        },
        {
          "path": "tests/gate-map.json",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1411-suggest-appearance.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1411-suggest-bubble.ts",
          "added": 111,
          "deleted": 9
        }
      ]
    },
    {
      "oid": "3a464062fb6af7d007de618c265ba6702866c2fe",
      "short": "3a464062",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179335764e4,
      "subject": "\u8865 #1671 \u5206\u8BCA\u7B14\u8BB0\uFF1A\u67E5\u660E\u4E2D\u6587\u6A21\u677F\u9996\u884C\u4E0E\u7B2C\u4E09\u65B9\u540E\u7AEF id \u8BFB\u4E0D\u51FA\uFF0C\u7ED9\u51FA\u4FEE\u6CD5\u4E0E\u95E8\u7981\u65B9\u6848",
      "parents": [
        "b1d23bcdeaf27176ea812eb32fb9d059754e1334"
      ],
      "files": [
        {
          "path": "research/1671-triage-2026-10-30.md",
          "added": 149,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "b1d23bcdeaf27176ea812eb32fb9d059754e1334",
      "short": "b1d23bcd",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793357607e3,
      "subject": "\u91CD\u65B0\u751F\u6210\u53D1\u5E03\u76EE\u5F55\u91CC\u7684 README\uFF1A\u8DDF\u968F\u4E0A\u6E38 Star History \u65E5\u671F\u53C2\u6570",
      "parents": [
        "494b2526f1f798d2240d4f1ce7351de8915a3ea5"
      ],
      "files": [
        {
          "path": "package/README.md",
          "added": 3,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "494b2526f1f798d2240d4f1ce7351de8915a3ea5",
      "short": "494b2526",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793357426e3,
      "subject": "Merge branch 'main' of https://github.com/FeatherHunter/dsh-mattpocock-skills-deck",
      "parents": [
        "7eb99086706a605cf25d00993b2e267ae6a76d89",
        "1a87f6dce6cfb5d2c21cf5d1eaef454b7561b735"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/star-history-dark.svg",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "docs/star-history-light.svg",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "docs/star-history.json",
          "added": 7,
          "deleted": 2
        },
        {
          "path": "docs/thanks-data.json",
          "added": 1,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "7eb99086706a605cf25d00993b2e267ae6a76d89",
      "short": "7eb99086",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793357386e3,
      "subject": "\u4FEE\u590D\u5EFA\u8BAE\u6C14\u6CE1\u5728\u8F93\u5165\u6846\u6491\u9AD8\u65F6\u8131\u94A9\u72B6\u6001\u680F\u3001\u6298\u53E0\u6001\u98DE\u51FA\u5C4F\u5E55\uFF08#1665\uFF09",
      "parents": [
        "04e61320a1015795a8c3305da778a345f67259b5"
      ],
      "files": [
        {
          "path": "scripts/gate-map.mts",
          "added": 8,
          "deleted": 2
        },
        {
          "path": "src/client/statusbar/suggestAppearance.ts",
          "added": 10,
          "deleted": 8
        },
        {
          "path": "src/client/statusbar/suggestBubble.ts",
          "added": 51,
          "deleted": 18
        },
        {
          "path": "tests/gate-map.json",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1411-suggest-appearance.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1411-suggest-bubble.ts",
          "added": 111,
          "deleted": 9
        }
      ]
    },
    {
      "oid": "4bdb7aa3f808c674c32e243b7d726b110f06def7",
      "short": "4bdb7aa3",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793355862e3,
      "subject": "\u8BE6\u60C5\u9875\u9876\u680F\u52A8\u4F5C\u6309\u94AE\u7684\u53EF\u70B9\u6027\u5224\u636E\u8865\u6B63\u6CE8\u91CA\u5E76\u628A\u95E8\u7981\u6A21\u677F\u63A5\u5230\u8BCD\u8868\u771F\u6E90\uFF08#1667\uFF09",
      "parents": [
        "989a6f074580b0b73fa0b6a4b21d74e021e23ea6"
      ],
      "files": [
        {
          "path": "scripts/build.mts",
          "added": 3,
          "deleted": 2
        },
        {
          "path": "src/client/index.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/client/kernel/detail-top-gate.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/client/kernel/styles.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/client/views/IssueDetail.ts",
          "added": 12,
          "deleted": 6
        },
        {
          "path": "tests/gate-map.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1668-detail-top-gate-wire.ts",
          "added": 37,
          "deleted": 23
        },
        {
          "path": "tests/verify-1668-detail-top-gate.ts",
          "added": 1,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "1a87f6dce6cfb5d2c21cf5d1eaef454b7561b735",
      "short": "1a87f6dc",
      "author": "github-actions[bot]",
      "email": "github-actions[bot]@users.noreply.github.com",
      "authorDateMs": 1793350587e3,
      "subject": "\u81F4\u8C22\u8868\u81EA\u52A8\u66F4\u65B0\uFF1A\u628A\u65B0\u7F16\u53F7\u8D21\u732E\u5E76\u8FDB\u6765\uFF0C\u4E2D\u82F1\u4E24\u8868\u6309\u82B1\u6570\u4E0E\u6700\u540E\u6D3B\u8DC3\u91CD\u6392",
      "parents": [
        "a79ed9cd952f72e2c1e3b426cf131622af5952bd"
      ],
      "files": [
        {
          "path": "docs/thanks-data.json",
          "added": 1,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "a79ed9cd952f72e2c1e3b426cf131622af5952bd",
      "short": "a79ed9cd",
      "author": "github-actions[bot]",
      "email": "github-actions[bot]@users.noreply.github.com",
      "authorDateMs": 1793349513e3,
      "subject": "\u6BCF\u65E5\u66F4\u65B0 Star History\uFF1A\u8FFD\u52A0\u62C9\u53D6\u5230\u7684\u661F\u6807\u6570\u636E\u5E76\u91CD\u65B0\u751F\u6210\u624B\u7ED8\u53CC\u4E3B\u9898\u56FE\u8868",
      "parents": [
        "04e61320a1015795a8c3305da778a345f67259b5"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/star-history-dark.svg",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "docs/star-history-light.svg",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "docs/star-history.json",
          "added": 7,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "989a6f074580b0b73fa0b6a4b21d74e021e23ea6",
      "short": "989a6f07",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179334517e4,
      "subject": "\u8BE6\u60C5\u9875\u9876\u680F\u4E24\u9897\u6309\u94AE\u538B\u7070\u65F6\u4E0D\u518D\u6302\u70B9\u51FB\u65E5\u5FD7\u5B9A\u4F4D\u4E32\uFF08#1667\uFF09",
      "parents": [
        "a48c4017f5afbd18fe20ade889ae9d20d4b97e0b"
      ],
      "files": [
        {
          "path": "src/client/views/IssueDetail.ts",
          "added": 5,
          "deleted": 2
        },
        {
          "path": "tests/gate-map.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1668-detail-top-gate-wire.ts",
          "added": 51,
          "deleted": 32
        }
      ]
    },
    {
      "oid": "a48c4017f5afbd18fe20ade889ae9d20d4b97e0b",
      "short": "a48c4017",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 17933433e5,
      "subject": "\u8865\u4E00\u6761\u8BE6\u60C5\u52A0\u8F7D\u4E2D\u53EA\u5269\u6253\u5F00\u5FEB\u7167\u7684\u63A5\u7EBF\u95E8\u7981\u7528\u4F8B\uFF08#1667\uFF09",
      "parents": [
        "0ca0f86b104262af20322e13cab675ca43b652e8"
      ],
      "files": [
        {
          "path": "tests/gate-map.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1668-detail-top-gate-wire.ts",
          "added": 11,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "0ca0f86b104262af20322e13cab675ca43b652e8",
      "short": "0ca0f86b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793343156e3,
      "subject": "\u5408\u5E76\u8FDC\u7AEF\u4E3B\u7EBF\u7684\u6700\u65B0\u63D0\u4EA4\uFF08#1670 \u5EFA\u8BAE\u5DE5\u5177\u7406\u7531\u8BF4\u660E\u6539\u4E3A\u5199\u5177\u4F53\u4F9D\u636E\uFF09\uFF0C\u5E76\u91CD\u751F\u6210\u95E8\u7981\u5F52\u5C5E\u8868",
      "parents": [
        "0de70a4a48e86cc467d11ff4ecd84a78c4ece3c3",
        "04e61320a1015795a8c3305da778a345f67259b5"
      ],
      "files": [
        {
          "path": "src/deck/tools/suggest-next-steps.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-suggest-next-steps.ts",
          "added": 2,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "0de70a4a48e86cc467d11ff4ecd84a78c4ece3c3",
      "short": "0de70a4a",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793342858e3,
      "subject": "\u8BE6\u60C5\u9875\u9876\u680F\u5728\u7968\u88AB\u672A\u5B8C\u6210\u7968\u963B\u585E\u65F6\u4E5F\u7F6E\u7070\u52A8\u4F5C\u6309\u94AE\uFF08#1669\uFF09",
      "parents": [
        "fd0bcc907c12a89af8bae880b7a030897dd50341"
      ],
      "files": [
        {
          "path": "config/copy/flow.yaml",
          "added": 7,
          "deleted": 0
        },
        {
          "path": "src/client/kernel/detail-top-gate.ts",
          "added": 51,
          "deleted": 11
        },
        {
          "path": "src/client/views/IssueDetail.ts",
          "added": 9,
          "deleted": 4
        },
        {
          "path": "tests/gate-map.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1668-detail-top-gate-wire.ts",
          "added": 101,
          "deleted": 6
        },
        {
          "path": "tests/verify-1668-detail-top-gate.ts",
          "added": 66,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "04e61320a1015795a8c3305da778a345f67259b5",
      "short": "04e61320",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793341965e3,
      "subject": "\u628A\u5EFA\u8BAE\u5DE5\u5177\u7684\u7406\u7531\u8BF4\u660E\u4ECE\u4E24\u79CD\u6A21\u677F\u6539\u6210\u5199\u5177\u4F53\u4F9D\u636E\uFF08#1670\uFF09",
      "parents": [
        "2ddf7d24ba1fe366fc974baff9c0510c519734a4"
      ],
      "files": [
        {
          "path": "src/deck/tools/suggest-next-steps.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-suggest-next-steps.ts",
          "added": 2,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "fd0bcc907c12a89af8bae880b7a030897dd50341",
      "short": "fd0bcc90",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793341486e3,
      "subject": "\u5408\u5E76\u8FDC\u7AEF\u4E3B\u7EBF\u5E26\u5165 md \u76EE\u5F55\u7B7E\u4FEE\u590D\uFF08#1664\uFF09\uFF0C\u5E76\u91CD\u751F\u6210\u95E8\u7981\u5F52\u5C5E\u8868",
      "parents": [
        "2d873580502fb3c150a49684780c98ba605186a5",
        "2ddf7d24ba1fe366fc974baff9c0510c519734a4"
      ],
      "files": [
        {
          "path": "config/copy/flow.yaml",
          "added": 4,
          "deleted": 0
        },
        {
          "path": "src/client/kernel/store-derived.ts",
          "added": 28,
          "deleted": 0
        },
        {
          "path": "src/client/views/ListTab.ts",
          "added": 8,
          "deleted": 3
        },
        {
          "path": "src/client/views/mdEffortRow.ts",
          "added": 46,
          "deleted": 3
        },
        {
          "path": "src/refresh/rooms/client/snapshot-cache-store.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 24,
          "deleted": 4
        },
        {
          "path": "tests/verify-1286-list.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-1295-dual-panel.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-1302-panel-list-skeleton.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-1664-md-eff-filter.ts",
          "added": 222,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "2d873580502fb3c150a49684780c98ba605186a5",
      "short": "2d873580",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793341085e3,
      "subject": "\u8BE6\u60C5\u9875\u9876\u680F\u5728\u7968\u5DF2\u5173\u95ED\u6216\u5DF2\u5408\u5E76\u65F6\u7F6E\u7070\u52A8\u4F5C\u6309\u94AE\uFF08#1668\uFF09",
      "parents": [
        "064a4de02746e6ff8fb41a22c570c418f8f0da65"
      ],
      "files": [
        {
          "path": "config/copy/flow.yaml",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "scripts/build.mts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "src/client/index.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "src/client/kernel/detail-top-gate.ts",
          "added": 41,
          "deleted": 0
        },
        {
          "path": "src/client/kernel/styles.ts",
          "added": 6,
          "deleted": 0
        },
        {
          "path": "src/client/views/IssueDetail.ts",
          "added": 8,
          "deleted": 3
        },
        {
          "path": "tests/gate-map.json",
          "added": 44,
          "deleted": 7
        },
        {
          "path": "tests/verify-1145-open-local.ts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "tests/verify-1519-detail-comments.ts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "tests/verify-1668-detail-top-gate-wire.ts",
          "added": 194,
          "deleted": 0
        },
        {
          "path": "tests/verify-1668-detail-top-gate.ts",
          "added": 65,
          "deleted": 0
        },
        {
          "path": "tests/verify-599-merged-pr.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-693-detail-fallback-honesty.ts",
          "added": 2,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "2ddf7d24ba1fe366fc974baff9c0510c519734a4",
      "short": "2ddf7d24",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793340701e3,
      "subject": "\u4FEE\u597D\u4E3B\u5217\u8868\u7B2C\u4E00\u6392 md\u76EE\u5F55\u7B7E\uFF1A\u8D85 10 \u4E2A\u6298\u53E0\uFF0C\u5168\u5173\u7684\u5DE5\u4F5C\u5355\u5143\u4E0D\u518D\u51FA\u73B0\uFF08#1664\uFF09",
      "parents": [
        "064a4de02746e6ff8fb41a22c570c418f8f0da65"
      ],
      "files": [
        {
          "path": "config/copy/flow.yaml",
          "added": 4,
          "deleted": 0
        },
        {
          "path": "src/client/kernel/store-derived.ts",
          "added": 28,
          "deleted": 0
        },
        {
          "path": "src/client/views/ListTab.ts",
          "added": 8,
          "deleted": 3
        },
        {
          "path": "src/client/views/mdEffortRow.ts",
          "added": 46,
          "deleted": 3
        },
        {
          "path": "src/refresh/rooms/client/snapshot-cache-store.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 24,
          "deleted": 4
        },
        {
          "path": "tests/verify-1286-list.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-1295-dual-panel.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-1302-panel-list-skeleton.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "tests/verify-1664-md-eff-filter.ts",
          "added": 222,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "064a4de02746e6ff8fb41a22c570c418f8f0da65",
      "short": "064a4de0",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793339767e3,
      "subject": "\u628A\u63A2\u7D22\u5730\u56FE\u63D0\u793A\u8BCD\u91CC\u7684 subissue \u6539\u6210\u5B98\u65B9\u5199\u6CD5 sub-issue",
      "parents": [
        "a03c05d1c623ac89573c4492b8fe85c73841baa7"
      ],
      "files": [
        {
          "path": "config/prompts/ticket-creation.yaml",
          "added": 9,
          "deleted": 9
        },
        {
          "path": "tests/verify-prompts.ts",
          "added": 4,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "a03c05d1c623ac89573c4492b8fe85c73841baa7",
      "short": "a03c05d1",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793339312e3,
      "subject": "\u7ED9\u65B0\u5EFA\u63A2\u7D22\u5730\u56FE\u63D0\u793A\u8BCD\u8BB2\u6E05\u5E76\u884C\u4E32\u884C\u5206\u5DE5\u4E0E\u6536\u5C3E\u590D\u67E5\u987A\u5E8F",
      "parents": [
        "95a5025556206db3533c8e337eba4ad8c2c4516c"
      ],
      "files": [
        {
          "path": "config/prompts/ticket-creation.yaml",
          "added": 10,
          "deleted": 10
        },
        {
          "path": "tests/verify-prompts.ts",
          "added": 5,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "95a5025556206db3533c8e337eba4ad8c2c4516c",
      "short": "95a50255",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793338451e3,
      "subject": "\u5EFA\u8BAE\u5DE5\u5177\u8BF4\u660E\u8865\u4E0A\u300C\u7B49\u7528\u6237\u8865\u5145\u300D\u7684\u534A\u53E5\u8BDD\u6A21\u677F\u5206\u652F\uFF08#1666\uFF09",
      "parents": [
        "d9d1e9a99e7eba578c2ad56e50907d84997f409e"
      ],
      "files": [
        {
          "path": "src/deck/tools/suggest-next-steps.ts",
          "added": 8,
          "deleted": 3
        },
        {
          "path": "tests/verify-suggest-next-steps.ts",
          "added": 13,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "d9d1e9a99e7eba578c2ad56e50907d84997f409e",
      "short": "d9d1e9a9",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793338395e3,
      "subject": "\u4FEE\u590D suggest \u6C14\u6CE1\u5C42\u7EA7\u4E0E\u951A\u70B9\uFF1A\u6C14\u6CE1\u4E0E\u80F6\u56CA\u540C\u5C42\u3001\u951A\u70B9\u8DDF\u80F6\u56CA\u8D70\uFF08#1665\uFF09",
      "parents": [
        "2684d11d827619984e5ae2ea5162c3a0f66c0195"
      ],
      "files": [
        {
          "path": "scripts/gate-map.mts",
          "added": 5,
          "deleted": 3
        },
        {
          "path": "src/client/statusbar/suggestAppearance.ts",
          "added": 9,
          "deleted": 5
        },
        {
          "path": "src/client/statusbar/suggestBubble.ts",
          "added": 21,
          "deleted": 14
        },
        {
          "path": "tests/gate-map.json",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "tests/verify-1411-suggest-appearance.ts",
          "added": 4,
          "deleted": 3
        },
        {
          "path": "tests/verify-1411-suggest-bubble.ts",
          "added": 25,
          "deleted": 15
        }
      ]
    },
    {
      "oid": "2684d11d827619984e5ae2ea5162c3a0f66c0195",
      "short": "2684d11d",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793336779e3,
      "subject": "\u7ED9\u65B0\u5EFA\u63A2\u7D22\u5730\u56FE\u63D0\u793A\u8BCD\u7684\u5E76\u884C\u4E32\u884C\u8282\u505A\u63AA\u8F9E\u5FAE\u8C03",
      "parents": [
        "d480e6cb66783d8605e0aca8872709ec650c0bfa"
      ],
      "files": [
        {
          "path": "config/prompts/ticket-creation.yaml",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "tests/verify-prompts.ts",
          "added": 5,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "d480e6cb66783d8605e0aca8872709ec650c0bfa",
      "short": "d480e6cb",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793336172e3,
      "subject": "\u7ED9\u65B0\u5EFA\u63A2\u7D22\u5730\u56FE\u63D0\u793A\u8BCD\u52A0\u4E0A\u5E76\u884C\u4E32\u884C\u8BBE\u8BA1\u4E0E\u6536\u5C3E\u590D\u67E5\u8981\u6C42",
      "parents": [
        "b5422c40d1dabd253abde7e5dcb60cfa67adfe23"
      ],
      "files": [
        {
          "path": "config/prompts/ticket-creation.yaml",
          "added": 12,
          "deleted": 2
        },
        {
          "path": "tests/verify-prompts.ts",
          "added": 5,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "b5422c40d1dabd253abde7e5dcb60cfa67adfe23",
      "short": "b5422c40",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793330832e3,
      "subject": "\u628A\u4E2D\u82F1\u6587 README \u7684\u9501\u7248\u53F7\u4ECE beta.22 \u63A8\u8FDB\u5230 beta.32 \u5E76\u91CD\u751F\u6210\u53D1\u5E03\u76EE\u5F55\u8BF4\u660E",
      "parents": [
        "2348e29b8e47ed9beed35a254f7111ffa2e32172"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "package/README.md",
          "added": 3,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "2348e29b8e47ed9beed35a254f7111ffa2e32172",
      "short": "2348e29b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793329402e3,
      "subject": "\u5199\u6E05\u53D1\u5E03\u5931\u8D25\u540E\u4E0D\u91CD\u8DD1\u4E0E\u8BC1\u636E\u4E0D\u53EF\u53D8\u4E24\u6761\u89C4\u5219",
      "parents": [
        "72db476ef9e938f1df6291f715c80b70997739c0"
      ],
      "files": [
        {
          "path": "docs/agents/checklist-issue-template.md",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "docs/agents/real-machine-verification.md",
          "added": 17,
          "deleted": 0
        },
        {
          "path": "docs/releases/RELEASE-RUNBOOK.md",
          "added": 36,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "72db476ef9e938f1df6291f715c80b70997739c0",
      "short": "72db476e",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793328987e3,
      "subject": "\u8865\u9F50\u8BFB\u7968\u5199\u7968\u7684\u4E09\u6761\u7701\u65F6\u89C4\u5219\u5E76\u6807\u8BB0\u8FC7\u671F\u5DE5\u4F5C\u6D41\u6587\u6863\uFF08retro \u843D\u5730 1/2/5\uFF09",
      "parents": [
        "fac909c1aeffec3dd6907f433e4e3756c1f6087c"
      ],
      "files": [
        {
          "path": "docs/README.en.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "docs/agents/verification.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "docs/workflow/DEV-WORKFLOW.md",
          "added": 2,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "fac909c1aeffec3dd6907f433e4e3756c1f6087c",
      "short": "fac909c1",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793296886e3,
      "subject": "\u8865\u9F50 1.9.0-beta.32 \u53D1\u884C\u8BF4\u660E\uFF0C\u5199\u8FDB\u9EC4\u6761\u5355\u884C\u4E0E\u60AC\u505C\u63D0\u793A\u5BBD\u5EA6\u4E24\u5904\u4FEE\u590D",
      "parents": [
        "45f73643279963fb49b11c8abf71321f49f28991"
      ],
      "files": [
        {
          "path": "CHANGELOG.md",
          "added": 19,
          "deleted": 5
        },
        {
          "path": "package/CHANGELOG.md",
          "added": 6,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "45f73643279963fb49b11c8abf71321f49f28991",
      "short": "45f73643",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793291541e3,
      "subject": "\u5408\u5E76 1662 \u95E8\u7981\u53CD\u8BC1\u4FEE\u590D\u5230\u4E3B\u5206\u652F\uFF1AD1 \u53CD\u8BC1\u8DDF\u7740\u9EC4\u6761\u65B0\u5F62\u72B6\u8D70\uFF0C\u95E8\u7981\u5F52\u5C5E\u8868\u91CD\u751F\u6210",
      "parents": [
        "781001116abe55a45ba0e80d290bdf5e79df3f46",
        "84d7bb24a60cef15792817531f49271d0b36f8ae"
      ],
      "files": [
        {
          "path": "tests/gate-map.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-669-collapsed-recoverable.ts",
          "added": 4,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "781001116abe55a45ba0e80d290bdf5e79df3f46",
      "short": "78100111",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793291504e3,
      "subject": "\u5408\u5E76 1660 \u60AC\u505C\u63D0\u793A\u5BBD\u5EA6\u53E3\u5F84\u4FEE\u590D\u5230\u4E3B\u5206\u652F\uFF1A\u9650\u5BBD\u4E0E\u6392\u4F4D\u7EDF\u4E00\u6309\u6E32\u67D3\u5916\u6846\u5BBD\u8BA1\u7B97\uFF0C\u95E8\u7981\u4E0E ADR \u540C\u6B65",
      "parents": [
        "c9f64f0992bc6a1d73604882638b2c31098a2d56",
        "ae8f23b581dbd9927f5579f3838aa6e9c8285d47"
      ],
      "files": [
        {
          "path": "docs/adr/20261029-tip-anchor-above.md",
          "added": 7,
          "deleted": 5
        },
        {
          "path": "src/client/views/primitives/HoverTip.ts",
          "added": 13,
          "deleted": 6
        },
        {
          "path": "src/client/views/primitives/Tip.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/client/views/primitives/tipPlace.ts",
          "added": 22,
          "deleted": 12
        },
        {
          "path": "tests/gate-map.json",
          "added": 34,
          "deleted": 6
        },
        {
          "path": "tests/verify-1612-deck-door.ts",
          "added": 5,
          "deleted": 31
        },
        {
          "path": "tests/verify-hovertip.ts",
          "added": 7,
          "deleted": 4
        },
        {
          "path": "tests/verify-tip-place.ts",
          "added": 63,
          "deleted": 5
        }
      ]
    },
    {
      "oid": "84d7bb24a60cef15792817531f49271d0b36f8ae",
      "short": "84d7bb24",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793291141e3,
      "subject": "\u6309\u9EC4\u6761\u65B0\u5F62\u72B6\u4FEE\u590D 669 \u95E8\u7981\u7684 D1 \u53CD\u8BC1\uFF08#1662\uFF09",
      "parents": [
        "c9f64f0992bc6a1d73604882638b2c31098a2d56"
      ],
      "files": [
        {
          "path": "tests/gate-map.json",
          "added": 30,
          "deleted": 5
        },
        {
          "path": "tests/verify-669-collapsed-recoverable.ts",
          "added": 4,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "ae8f23b581dbd9927f5579f3838aa6e9c8285d47",
      "short": "ae8f23b5",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179328868e4,
      "subject": "\u4FEE\u590D\u60AC\u505C\u63D0\u793A\u7684\u5BBD\u5EA6\u53E3\u5F84\uFF1A\u9650\u5BBD\u4E0E\u6392\u4F4D\u7EDF\u4E00\u6309\u6E32\u67D3\u5916\u6846\u5BBD\u8BA1\u7B97\uFF08#1660\uFF09",
      "parents": [
        "c9f64f0992bc6a1d73604882638b2c31098a2d56"
      ],
      "files": [
        {
          "path": "docs/adr/20261029-tip-anchor-above.md",
          "added": 7,
          "deleted": 5
        },
        {
          "path": "src/client/views/primitives/HoverTip.ts",
          "added": 13,
          "deleted": 6
        },
        {
          "path": "src/client/views/primitives/Tip.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/client/views/primitives/tipPlace.ts",
          "added": 22,
          "deleted": 12
        },
        {
          "path": "tests/gate-map.json",
          "added": 34,
          "deleted": 6
        },
        {
          "path": "tests/verify-1612-deck-door.ts",
          "added": 5,
          "deleted": 31
        },
        {
          "path": "tests/verify-hovertip.ts",
          "added": 7,
          "deleted": 4
        },
        {
          "path": "tests/verify-tip-place.ts",
          "added": 63,
          "deleted": 5
        }
      ]
    },
    {
      "oid": "c9f64f0992bc6a1d73604882638b2c31098a2d56",
      "short": "c9f64f09",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793283868e3,
      "subject": "\u65B0\u589E\u9EC4\u6761\u5355\u884C\u81EA\u9002\u5E94\u7684\u95E8\u7981\uFF1A\u77ED\u53E5\u4E0E\u5355\u884C\u4E0D\u65AD\u8A00\u884C\u4E3A\uFF0C\u53EA\u5B88\u5F62\u72B6",
      "parents": [
        "d6c8adecd09e1fc3449f7a3d77d57086b8bd00a4"
      ],
      "files": [
        {
          "path": "tests/verify-1661-banner-singleline.ts",
          "added": 53,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "d6c8adecd09e1fc3449f7a3d77d57086b8bd00a4",
      "short": "d6c8adec",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793283484e3,
      "subject": "\u9EC4\u6761\u6539\u6210\u77ED\u53E5\u5355\u884C\u81EA\u9002\u5E94\uFF1A\u6587\u6848\u538B\u77ED\u5E76\u4E0D\u6362\u884C\uFF0C\u5BBD\u5EA6\u8DDF\u7740\u5185\u5BB9\u8D70",
      "parents": [
        "77eae7800e0a62ae1bfa70cc6976f3627c22dbec"
      ],
      "files": [
        {
          "path": "config/copy/panel.yaml",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/client/statusbar/StatusBar.ts",
          "added": 5,
          "deleted": 4
        }
      ]
    },
    {
      "oid": "77eae7800e0a62ae1bfa70cc6976f3627c22dbec",
      "short": "77eae780",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793282451e3,
      "subject": "\u771F\u673A\u9A8C\u8BC1\u5DE5\u5177\u9884\u7F6E\u4E09\u6B3E\u7A97\u53E3\u5C3A\u5BF8\uFF0C\u8BBE\u5B8C\u8FD8\u8981\u6838\u5BF9\u63D2\u4EF6\u771F\u7684\u8FDB\u4E86\u90A3\u4E00\u652F\u5E03\u5C40\uFF08#1637\uFF09",
      "parents": [
        "031712d4f54fea227089987a3ccea7ade7b24e63"
      ],
      "files": [
        {
          "path": "docs/agents/real-machine-verification.md",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "scripts/gate-map.mts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "scripts/real-machine/README.md",
          "added": 27,
          "deleted": 0
        },
        {
          "path": "scripts/real-machine/lib/browser.mts",
          "added": 163,
          "deleted": 2
        },
        {
          "path": "scripts/real-machine/lib/presets.mts",
          "added": 108,
          "deleted": 0
        },
        {
          "path": "tests/gate-map.json",
          "added": 22,
          "deleted": 6
        },
        {
          "path": "tests/verify-real-machine-size-presets.ts",
          "added": 127,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "031712d4f54fea227089987a3ccea7ade7b24e63",
      "short": "031712d4",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793275865e3,
      "subject": "\u771F\u673A\u9A8C\u8BC1\u5DE5\u5177\uFF1A\u6709\u5934\u7A97\u53E3\u5FC5\u987B\u771F\u5168\u5C4F\uFF0C\u5207\u4E0D\u6210\u5C31\u5224\u5931\u8D25",
      "parents": [
        "2ce91a13495c657f12b05836070b375245e82404"
      ],
      "files": [
        {
          "path": "docs/agents/real-machine-verification.md",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "scripts/gate-map.mts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "scripts/node-ambient.d.ts",
          "added": 9,
          "deleted": 0
        },
        {
          "path": "scripts/real-machine/README.md",
          "added": 19,
          "deleted": 0
        },
        {
          "path": "scripts/real-machine/commands/freeze-candidate.mts",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "scripts/real-machine/commands/two-instance-smoke.mts",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "scripts/real-machine/lib/browser.mts",
          "added": 197,
          "deleted": 15
        },
        {
          "path": "tests/gate-map.json",
          "added": 24,
          "deleted": 5
        },
        {
          "path": "tests/verify-real-machine-fullscreen.ts",
          "added": 117,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "2ce91a13495c657f12b05836070b375245e82404",
      "short": "2ce91a13",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793268948e3,
      "subject": "\u53D1\u5E03 1.9.0-beta.32 \u7684\u53D1\u884C\u8BF4\u660E\uFF1A\u8865\u4E0A beta.31 \u4E4B\u540E\u7684\u754C\u9762\u4FEE\u590D\u4E0E\u771F\u673A\u9A8C\u8BC1\u5DE5\u5177\u94FE",
      "parents": [
        "2d78912f94b509b3ffe4cb5e4f863d761029e2d0"
      ],
      "files": [
        {
          "path": "CHANGELOG.md",
          "added": 69,
          "deleted": 0
        },
        {
          "path": "package.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "package/CHANGELOG.md",
          "added": 27,
          "deleted": 0
        },
        {
          "path": "package/README.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "package/package.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-config-store-package.ts",
          "added": 1,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "2d78912f94b509b3ffe4cb5e4f863d761029e2d0",
      "short": "2d78912f",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793268948e3,
      "subject": "\u4FEE\u6389 #1649 \u95E8\u7981\u5728 Windows \u4E0A\u901A\u8FC7\u540E\u4ECD\u88AB\u5224\u7EA2\u7684\u9000\u51FA\u7ADE\u6001",
      "parents": [
        "e24a4d3f8f2d0dd265d6b624cedf69bf1bc45fc1"
      ],
      "files": [
        {
          "path": "tests/verify-1649-detail-closed-link.ts",
          "added": 4,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "e24a4d3f8f2d0dd265d6b624cedf69bf1bc45fc1",
      "short": "e24a4d3f",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793266005e3,
      "subject": "\u6BCF\u65E5\u66F4\u65B0 Star History\uFF1AREADME \u91CC\u56FE\u8868\u65E5\u671F\u53C2\u6570\u63A8\u8FDB\u5230 2026-10-29",
      "parents": [
        "1c488a192d1e8bccdcd649e04a86698cb2acad85"
      ],
      "files": [
        {
          "path": "package/README.md",
          "added": 3,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "1c488a192d1e8bccdcd649e04a86698cb2acad85",
      "short": "1c488a19",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793266005e3,
      "subject": "\u8865\u5168\u754C\u9762\u8BCD\u6761\uFF1A\u72B6\u6001\u680F\u3001\u9762\u677F\u9876\u680F\u3001\u5217\u8868\u3001\u73AF\u5883\u68C0\u67E5\u3001\u62C9\u53D6\u8BF7\u6C42\u3001\u6280\u80FD\u3001\u5730\u56FE\u8BE6\u60C5\u3001\u7968\u8BE6\u60C5\u3001\u8BBE\u7F6E\u7B49\u9875\u9762\u5143\u7D20\u90FD\u8865\u4E0A\u4E2D\u6587\u53EB\u6CD5\u4E0E\u907F\u514D\u53EB\u6CD5",
      "parents": [
        "ebc2d86e7d40daacbf887a7938b7044a5bea7953"
      ],
      "files": [
        {
          "path": "GLOSSARY.md",
          "added": 256,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "ebc2d86e7d40daacbf887a7938b7044a5bea7953",
      "short": "ebc2d86e",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793265261e3,
      "subject": "\u8BCD\u5178\u65B0\u589E\u60AC\u505C\u63D0\u793A\u65B9\u4F4D\u4E00\u6761\uFF1A\u65B9\u5411\u56DB\u79CD\u3001\u7EDF\u4E00\u89C4\u5219\u5B9A\u3001\u8C03\u7528\u65B9\u4E0D\u5F97\u6307\u5B9A\uFF08#1651 \u7B2C11\u6761\uFF09",
      "parents": [
        "b86b5c3cb711ded80a78de3ea8712c02a337f44d"
      ],
      "files": [
        {
          "path": "GLOSSARY.md",
          "added": 5,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "b86b5c3cb711ded80a78de3ea8712c02a337f44d",
      "short": "b86b5c3c",
      "author": "github-actions[bot]",
      "email": "github-actions[bot]@users.noreply.github.com",
      "authorDateMs": 1793263955e3,
      "subject": "\u81F4\u8C22\u8868\u81EA\u52A8\u66F4\u65B0\uFF1A\u628A\u65B0\u7F16\u53F7\u8D21\u732E\u5E76\u8FDB\u6765\uFF0C\u4E2D\u82F1\u4E24\u8868\u6309\u82B1\u6570\u4E0E\u6700\u540E\u6D3B\u8DC3\u91CD\u6392",
      "parents": [
        "488f7d98f7f80272df299948c940459090bfe62f"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 4,
          "deleted": 2
        },
        {
          "path": "docs/README.en.md",
          "added": 4,
          "deleted": 2
        },
        {
          "path": "docs/thanks-data.json",
          "added": 35,
          "deleted": 3
        },
        {
          "path": "package/README.md",
          "added": 4,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "488f7d98f7f80272df299948c940459090bfe62f",
      "short": "488f7d98",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793263703e3,
      "subject": "\u5173\u95ED\u4E0E\u5C55\u5F00\u6539\u8D70\u8DDF\u968F\u786E\u8BA4\uFF1A\u7EA2\u8272\u53C9\u4E0E\u5C55\u5F00\u952E\u5148\u5192\u6D6E\u5C42\uFF0C\u786E\u8BA4\u624D\u6539\u4E09\u5904\uFF0C\u8001\u5168\u5C4F\u6846\u4E0B\u7EBF\uFF08#1655\uFF0C\u5B9E\u65BD #1657 #1658\uFF09",
      "parents": [
        "8bb6a4ce04bf3dd1469d053cf52548953d7abc35"
      ],
      "files": [
        {
          "path": "config/copy/panel.yaml",
          "added": 12,
          "deleted": 0
        },
        {
          "path": "src/client/statusbar/StatusBar.ts",
          "added": 6,
          "deleted": 5
        },
        {
          "path": "src/client/statusbar/deckDoor.ts",
          "added": 245,
          "deleted": 46
        },
        {
          "path": "tests/verify-1612-deck-door.ts",
          "added": 242,
          "deleted": 53
        }
      ]
    },
    {
      "oid": "8bb6a4ce04bf3dd1469d053cf52548953d7abc35",
      "short": "8bb6a4ce",
      "author": "github-actions[bot]",
      "email": "github-actions[bot]@users.noreply.github.com",
      "authorDateMs": 179326249e4,
      "subject": "\u6BCF\u65E5\u66F4\u65B0 Star History\uFF1A\u8FFD\u52A0\u62C9\u53D6\u5230\u7684\u661F\u6807\u6570\u636E\u5E76\u91CD\u65B0\u751F\u6210\u624B\u7ED8\u53CC\u4E3B\u9898\u56FE\u8868",
      "parents": [
        "01866dc3cae184dc9aecfbf7c22aa2b678555f9c"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/star-history-dark.svg",
          "added": 15,
          "deleted": 15
        },
        {
          "path": "docs/star-history-light.svg",
          "added": 15,
          "deleted": 15
        },
        {
          "path": "docs/star-history.json",
          "added": 10,
          "deleted": 5
        }
      ]
    }
  ];
  var capturedWorktrees = [
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck",
      "head": "e489673f240ed18a2e71bb6de5bfc635b2fed73c",
      "branch": "main",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/github/workspaces/list",
      "head": "55345eb2e26cc8004f17e28c5ac74301dd983668",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/github/workspaces/map",
      "head": "55345eb2e26cc8004f17e28c5ac74301dd983668",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/github/workspaces/offline",
      "head": "55345eb2e26cc8004f17e28c5ac74301dd983668",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/harness-smoke/workspaces/ws-github",
      "head": "55345eb2e26cc8004f17e28c5ac74301dd983668",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/quota/workspace",
      "head": "55345eb2e26cc8004f17e28c5ac74301dd983668",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1006-quota-cooldown",
      "head": "d8f8e2d223a56bac48fa5a921b4609c25dd3e2db",
      "branch": "ticket/1006-quota-cooldown",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1008-failure-streak",
      "head": "6ccd0bfeda4798e3bee6c054610ea9d83d26f776",
      "branch": "fix/1008-failure-streak",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1114-timer-cleanup",
      "head": "7a21f12d82342bf572efdd301f8dc548bfdbc569",
      "branch": "ticket/1114-timer-cleanup",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1162-live-doc-drift",
      "head": "fc16fb28dee796b93100aa58607b5f1e791dff27",
      "branch": "ticket/1162-live-doc-drift",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1171-anchor-fallback",
      "head": "4f89823692a3d677ab0fc8026faf961adcdfea65",
      "branch": "fix/1171-anchor-lookup-retry",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1218-wayfinder-closeout",
      "head": "2a5d625a06d721b7819e05b0f57be5e871f8df23",
      "branch": "ticket/1218-wayfinder-closeout",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1240-time-config-missed-literals",
      "head": "b4b8adc2f1314bd833c55596e9c3badf2e1a5002",
      "branch": "ticket/1240-time-config-missed-literals",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1243-naming-isolation",
      "head": "9ae5cbfc4ec29bb2acd10bd98e6918481b415a99",
      "branch": "ticket/1243-naming-isolation",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1474-accept-main",
      "head": "c2af8858257144c1b1122e8019a39e7382ace5fc",
      "branch": "ticket/1474-accept-main",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1474-auto-retry",
      "head": "85591337dcec96e0f94715cfe74f003086005995",
      "branch": "ticket/1474-auto-retry",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1474-force-sequel",
      "head": "b2dd90fba64f66eef1b77cd68bc08f88fc90434e",
      "branch": "ticket/1474-force-sequel",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1475-timeout-budget",
      "head": "617df28a49f6d9050b158eaa170a6ca135cb6815",
      "branch": "ticket/1475-predicate-budget",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1498-unc-case",
      "head": "dce516d6b235130a7f92c9575f789687d20768fb",
      "branch": "ticket/1498-unc-case",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1520-quoted-skill-refs",
      "head": "5d1f76864c6dc0a600a4e8a88583ac651e02cf90",
      "branch": "ticket/1520-quoted-skill-refs",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1521-zh-translations",
      "head": "0f849d1b97dfdf6393f26f3ae096e2d560ca52aa",
      "branch": "feat/1521-bundled-skills-zh",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1524-md-table",
      "head": "2aabd1c010d91c243292f15634cc47e70473e76e",
      "branch": "ticket/1524-md-table",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-suggest-replay-restore",
      "head": "51590957f21c130ff17772f31ee62fb3e29402c7",
      "branch": "ticket/1526-suggest-replay-restore",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-triage",
      "head": "459a02de266c66f8a6d4ddd27b8e2514b8d6f40a",
      "branch": "ticket/1526-triage-note-push1",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-walkthrough",
      "head": "88c22f0dbcaf3bba9353ec563d99da655f06121f",
      "branch": "ticket/1526-walkthrough-note",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1527-quota-floor",
      "head": "ae4d5046449d66cd7a6e5c32b2b64def133a4b3f",
      "branch": "ticket/1527-quota-floor",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1528-scratch-list-once",
      "head": "702a0797732d21c86a68dad2d298774abd933817",
      "branch": "ticket/1528-scratch-list-once",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1533-gitlab-remote-claim",
      "head": "634b0fe85e6cb2858f594fa4c15a8f431ee4e8b2",
      "branch": "fix/update-failure-settlement",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1555-session-decision",
      "head": "d153c80949bfddb7900cb59b9d4c3267226ac91b",
      "branch": "ticket/1555-session-decision",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1567-old-map-gate",
      "head": "92a72fde15b5ff7c6789c0a2e691c58ba2da551b",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1603-map-thin",
      "head": "623d3341a20ccf974a8fee190bec313fed2d3ea1",
      "branch": "ticket/1603-map-thin",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1604-pure-map-routing",
      "head": "50e5e02a278cad0a084d6d430ecabe4e3bc63e76",
      "branch": "ticket/1604-pure-map-routing",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1605-multi-backend",
      "head": "3893edc282d5459f7b87888b3b4af26648d135bf",
      "branch": "ticket/1605-multi-backend",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1607-gh-unc-cwd",
      "head": "c879f999c14f7b43039a6e11ca269daf7473fb3e",
      "branch": "ticket/1607-unc-gh-cwd",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1608-appendix-landing",
      "head": "59052395867102e8148078e71b48b6ae5d208df9",
      "branch": "ticket/1608-appendix-landing",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1609-log-field-guard",
      "head": "19b3ca471a2e9286fe227ae6806099122cbe15c3",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1610-parallel-read",
      "head": "af7b2eaa28aab8818cbb723315ec271115406918",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1611-fix-main-three-gates",
      "head": "72c51418e121ce02d1024e57a70ce0e90156f51f",
      "branch": "fix/1611-main-three-gates",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1612-cleanup",
      "head": "828bffc4848641ea42f2c74b6405896d66b66df2",
      "branch": "ticket/1612-cleanup",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1612-deck-switches",
      "head": "7d214665251b919b7d0ba56a95a7dbba48a804d9",
      "branch": "ticket/1612-deck-switches",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1617-log-fields-dynamic",
      "head": "b4bd06351b0a346fbe6d6c7fad61c8c7b6cc3b42",
      "branch": "ticket/1617-log-field-runtime",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1620-host-log-slot",
      "head": "35848d1b116e56526825a954fb0a485dc45daa39",
      "branch": "ticket/1620-host-log-slot",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1627-quota-log",
      "head": "bbe5168d552203863e2216689bdd8ffd0a856eaf",
      "branch": "ticket/1627-quota-log",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1637-beta32-candidate",
      "head": "99fb0860ebf627b59f626444f6f780bc2af122e8",
      "branch": "verify/1637-beta32",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1637-beta32-final",
      "head": "2ce91a13495c657f12b05836070b375245e82404",
      "branch": "verify/1637-beta32-final",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1639-md-eff-split",
      "head": "7217670c046292f4e92be7601033b19111586947",
      "branch": "ticket/1639-md-eff-split",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1643-smoke-into-parallel",
      "head": "5deecd833ec780583439829f299e23da57604f0e",
      "branch": "ticket/1643-smoke-into-parallel",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1646-publish-token",
      "head": "f9eb4ff00bb8f36c75dae808f148a846e2dab738",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1647-preflight-consistency",
      "head": "57b5cbbdd3233bed6fd73e3570418dfd05f0691d",
      "branch": "deliver/1647-preflight-consistency",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1648-release-integrity",
      "head": "d94282994e198bda7a0dddfd97f492ac8fe2b836",
      "branch": "ticket/1648-release-integrity",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1660-tip-width",
      "head": "ae8f23b581dbd9927f5579f3838aa6e9c8285d47",
      "branch": "fix/1660-tip-width",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1662-669-d1",
      "head": "84d7bb24a60cef15792817531f49271d0b36f8ae",
      "branch": "fix/1662-669-d1",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1681-integ",
      "head": "e489673f240ed18a2e71bb6de5bfc635b2fed73c",
      "branch": "integ/1681-panel-snapshot",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/fix-main-granularity",
      "head": "08af050b126cef62b5a979528a70e9fe9660fcb9",
      "branch": "fix/main-granularity",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/integ-final",
      "head": "80eaa35cda6804e21a0aad91423462880e328b1e",
      "branch": "integ/1602-map-thin-list",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/temp/1420-main",
      "head": "fa2a6bb15ccb40e3e43fa05ba1f3f2f4e1e64d94",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/temp/1611-main-verify",
      "head": "c02ea69568e5c742ae16a9e156d959e6ab5b8dfb",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/temp/verify-fresh-1645/batches/smoke-20261029-130911/workspaces/ws-github",
      "head": "1428e305a00e73473ba822550ded59f94fd735f4",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/temp/verify-fresh2-1645/batches/smoke-20261029-131010/workspaces/ws-github",
      "head": "1428e305a00e73473ba822550ded59f94fd735f4",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/temp/verify-fresh3-1645/batches/smoke-20261029-131044/workspaces/ws-github",
      "head": "1428e305a00e73473ba822550ded59f94fd735f4",
      "branch": null,
      "bare": false,
      "detached": true,
      "locked": false,
      "lockReason": null,
      "prunable": false
    }
  ];
  var capturedRemotes = [
    {
      "name": "fork316",
      "fetchUrl": "https://github.com/pioneerAlone/dsh-mattpocock-skills-deck.git",
      "pushUrl": "https://github.com/pioneerAlone/dsh-mattpocock-skills-deck.git"
    },
    {
      "name": "fork321",
      "fetchUrl": "https://github.com/21967201/dsh-mattpocock-skills-deck.git",
      "pushUrl": "https://github.com/21967201/dsh-mattpocock-skills-deck.git"
    },
    {
      "name": "origin",
      "fetchUrl": "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck.git",
      "pushUrl": "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck.git"
    }
  ];
  var capturedTags = [
    {
      "name": "v1.9.0-beta.32",
      "shortOid": "fac909c1",
      "createdAtMs": 1793296886e3
    },
    {
      "name": "v1.9.0-beta.18",
      "shortOid": "584127b1",
      "createdAtMs": 1792915479e3
    },
    {
      "name": "v1.9.0-beta.17",
      "shortOid": "9f56fcb3",
      "createdAtMs": 1792867061e3
    },
    {
      "name": "v1.9.0-beta.16",
      "shortOid": "8f583b88",
      "createdAtMs": 1792852321e3
    },
    {
      "name": "v1.9.0-beta.15",
      "shortOid": "08e692d5",
      "createdAtMs": 1792840179e3
    },
    {
      "name": "v1.9.0-beta.14",
      "shortOid": "40fbe79b",
      "createdAtMs": 1792839199e3
    },
    {
      "name": "v1.9.0-beta.13",
      "shortOid": "13568780",
      "createdAtMs": 1792834845e3
    },
    {
      "name": "v1.9.0-beta.12",
      "shortOid": "4590049a",
      "createdAtMs": 1792829259e3
    },
    {
      "name": "v1.9.0-beta.11",
      "shortOid": "ed0ad92b",
      "createdAtMs": 1792754912e3
    },
    {
      "name": "v1.9.0-beta.10",
      "shortOid": "f8ccc9c4",
      "createdAtMs": 1792734329e3
    },
    {
      "name": "v1.9.0-beta.9",
      "shortOid": "788748d1",
      "createdAtMs": 1792671643e3
    },
    {
      "name": "v1.9.0-beta.8",
      "shortOid": "6b2782e2",
      "createdAtMs": 1792604622e3
    },
    {
      "name": "archive/1279-dual-map-panel",
      "shortOid": "7d5b1a2e",
      "createdAtMs": 1792431686e3
    },
    {
      "name": "archive/1086-work-route-release",
      "shortOid": "681b2fc5",
      "createdAtMs": 1792390466e3
    },
    {
      "name": "v1.9.0-beta.5",
      "shortOid": "ea0dc073",
      "createdAtMs": 1792321399e3
    },
    {
      "name": "v1.9.0-beta.4",
      "shortOid": "fac4dbb8",
      "createdAtMs": 1792256468e3
    },
    {
      "name": "v1.9.0-beta.3",
      "shortOid": "65d9da86",
      "createdAtMs": 1792254014e3
    },
    {
      "name": "v1.9.0-beta.2",
      "shortOid": "af59dfe6",
      "createdAtMs": 1792215442e3
    },
    {
      "name": "v1.7.51",
      "shortOid": "3550b254",
      "createdAtMs": 1791511002e3
    },
    {
      "name": "v1.7.45",
      "shortOid": "080bc9b6",
      "createdAtMs": 1791316881e3
    },
    {
      "name": "v1.7.38",
      "shortOid": "aabb165a",
      "createdAtMs": 1790830425e3
    },
    {
      "name": "v1.7.37",
      "shortOid": "93b6fa47",
      "createdAtMs": 1790828024e3
    },
    {
      "name": "v1.7.36",
      "shortOid": "4a373d29",
      "createdAtMs": 1790826198e3
    },
    {
      "name": "v1.7.35",
      "shortOid": "9d0afd4f",
      "createdAtMs": 1790824388e3
    },
    {
      "name": "v1.7.34",
      "shortOid": "11d35669",
      "createdAtMs": 1790759607e3
    },
    {
      "name": "v1.7.33",
      "shortOid": "c767db82",
      "createdAtMs": 1790664432e3
    },
    {
      "name": "v1.7.32",
      "shortOid": "4be778d1",
      "createdAtMs": 1790579067e3
    },
    {
      "name": "v1.7.30",
      "shortOid": "dac6fb10",
      "createdAtMs": 1790267246e3
    },
    {
      "name": "v1.7.29",
      "shortOid": "b9583cbb",
      "createdAtMs": 1790227481e3
    },
    {
      "name": "v1.7.26",
      "shortOid": "3c5096d8",
      "createdAtMs": 1789986975e3
    },
    {
      "name": "v1.7.25",
      "shortOid": "aeb4b154",
      "createdAtMs": 1789966209e3
    },
    {
      "name": "v1.7.24",
      "shortOid": "ced71f95",
      "createdAtMs": 1789916516e3
    },
    {
      "name": "v1.7.23",
      "shortOid": "e2926353",
      "createdAtMs": 1789901209e3
    },
    {
      "name": "v1.7.22",
      "shortOid": "15321903",
      "createdAtMs": 1789577683e3
    },
    {
      "name": "v1.7.21",
      "shortOid": "6d492b1b",
      "createdAtMs": 1789215943e3
    },
    {
      "name": "v1.7.20",
      "shortOid": "4ff8bea5",
      "createdAtMs": 1789190429e3
    },
    {
      "name": "v1.7.19",
      "shortOid": "f7825d4f",
      "createdAtMs": 178918888e4
    },
    {
      "name": "v1.7.18",
      "shortOid": "651e1759",
      "createdAtMs": 1789027505e3
    },
    {
      "name": "v1.7.17",
      "shortOid": "ae9c3233",
      "createdAtMs": 1789002854e3
    },
    {
      "name": "v1.7.16",
      "shortOid": "b95e88b1",
      "createdAtMs": 1789001596e3
    }
  ];
  var capturedCounts = {
    "loose": 3186,
    "sizeKiB": 72903,
    "inPack": 40361,
    "packs": 2,
    "sizePackKiB": 699150,
    "prunePackable": 60,
    "garbage": 0
  };
  var capturedHooks = [
    {
      "name": "applypatch-msg.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "commit-msg.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "fsmonitor-watchman.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "post-update.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "pre-applypatch.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "pre-commit.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "pre-merge-commit.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "pre-push.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "pre-rebase.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "pre-receive.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "prepare-commit-msg.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "push-to-checkout.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "sendemail-validate.sample",
      "sample": true,
      "sizeBytes": 0
    },
    {
      "name": "update.sample",
      "sample": true,
      "sizeBytes": 0
    }
  ];
  var capturedConfig = [
    {
      "key": "user.name",
      "value": "FeatherHunter",
      "scope": "local"
    },
    {
      "key": "user.email",
      "value": "975559549@qq.com",
      "scope": "local"
    },
    {
      "key": "core.ignorecase",
      "value": "true",
      "scope": "local"
    },
    {
      "key": "core.eol",
      "value": "lf",
      "scope": "local"
    }
  ];
  var capturedSubmodules = "";
  var capturedLocalBranchNames = [
    "integ/1681-panel-snapshot",
    "main",
    "fix/1662-669-d1",
    "fix/1660-tip-width",
    "verify/1637-beta32-final",
    "ticket/1656-suggest-copy-231",
    "integ-1651-hovertip-anchor",
    "impl-1653-tip-above",
    "impl-1652-tip-place",
    "ticket/1648-release-integrity",
    "verify/1637-beta32",
    "deliver/1647-preflight-consistency",
    "ticket/1647-preflight-consistency",
    "ticket/1643-smoke-into-parallel",
    "ticket/1639-md-eff-split",
    "ticket/1612-cleanup",
    "ticket/1612-deck-switches",
    "ticket/1620-host-log-slot",
    "ticket/1627-quota-log",
    "ticket/1617-log-field-runtime",
    "ticket/1474-accept-main",
    "fix/1611-main-three-gates",
    "ticket/1474-force-sequel",
    "ticket/1526-walkthrough-note",
    "ticket/1526-walkthrough",
    "ticket/1474-auto-retry",
    "ticket/1608-appendix-landing",
    "ticket/1607-unc-gh-cwd",
    "ticket/1526-triage-note-push1",
    "ticket/1526-triage-note",
    "ticket/1240-time-config-missed-literals",
    "ticket/1243-naming-isolation",
    "ticket/1227-exclusions-rechain",
    "integ/1602-map-thin-list",
    "ticket/1218-wayfinder-closeout",
    "ticket/1605-multi-backend",
    "ticket/1498-unc-case",
    "ticket/1604-pure-map-routing",
    "ticket/1603-map-thin",
    "integ/1600-unlock-gitlab",
    "ticket/1528-scratch-list-once",
    "ticket/1223-followup-derive-checks",
    "ticket/1223-gh-labels-cleanup",
    "market/screenshots6",
    "ticket/1555-session-decision",
    "feat/1553-column-caps",
    "ticket/1114-timer-cleanup",
    "fix/main-granularity",
    "ticket/1475-predicate-budget",
    "ticket/1006-quota-cooldown",
    "safety/20261026-pre-main-sync",
    "fix/1171-anchor-lookup-retry",
    "fix/1530-build-cache-generated-inputs",
    "fix/update-failure-settlement",
    "tmp-land-1533",
    "bug/1533-remote-claim",
    "ticket/1187-gitlab-chain-predicates",
    "ticket/1162-live-doc-drift",
    "ticket/1527-quota-floor",
    "ticket/1526-suggest-replay-restore",
    "ticket/1524-md-table",
    "feat/1521-bundled-skills-zh",
    "ticket/1520-quoted-skill-refs",
    "fix/1008-failure-streak",
    "integ/1460-bug-filing-dedup",
    "ticket/1461-bug-dedup-prompt",
    "work/1472-write-event-fetch",
    "work/1449-layout-single-source",
    "integ/1439-tracker-pipeline",
    "integ/1434-workspace-legacy-cleanup",
    "integ/1433-snapshot-layout-file",
    "work/1392-inactive-effect",
    "prototype/suggest-next-steps",
    "spec/1382-local-md-ticket-convention",
    "integration/1377-light-theme",
    "spec/1371-light-theme",
    "prototype/1370-pixel-light",
    "research/1369-focus-ring-light",
    "safety/20261021-pre-main-sync",
    "safety/20261021-final-2",
    "safety/20261021-final",
    "safety/20261021-worktree-snapshot-4",
    "safety/20261021-worktree-snapshot-3",
    "safety/20261021-worktree-snapshot-2",
    "safety/20261021-worktree-snapshot",
    "integration/1324-freshness-content",
    "work/1324-1328-verify-docs",
    "work/1324-1327-freshness-regression",
    "work/1324-1326-content-digest",
    "work/1298-t7",
    "work/1281-prompt-copy",
    "work/1277-md-spec-container",
    "work/1286-implementation-map-visual",
    "work/1262-work-route-write-tools",
    "work/1260-work-route",
    "integration/963-outbound-admission",
    "dependabot/npm_and_yarn/typescript-7.0.2",
    "gate/970-regression",
    "feat/963-968-skill-ondemand",
    "feat/963-964-same-key-ride",
    "feat/963-965-admission-scaffold",
    "feat/963-969-tiered-timeout",
    "feat/963-967-measure-spike",
    "integ/824-scan-gate",
    "work/824-b6",
    "work/824-b2",
    "work/824-b3",
    "work/824-b1",
    "work/824-b4",
    "work/824-b5",
    "work/828-bonus",
    "prototype/769-takeover-supplement"
  ];
  var capturedLocalBranches = 112;
  var capturedRefsTotal = 325;
  var capturedGitVersion = "git version 2.49.0.windows.1";
  var capturedDescribe = "v1.9.0-beta.32-33-ge489673f2-dirty";
  var capturedStatusRaw = "# branch.oid e489673f240ed18a2e71bb6de5bfc635b2fed73c\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n1 .M N... 100644 100644 100644 41977778c4aa7156b3aee4182666d59a80d80c0c 41977778c4aa7156b3aee4182666d59a80d80c0c docs/prototype/vc-redesign/src/data/repo.generated.ts\n1 .M N... 100644 100644 100644 639a517d71b4722bcec020f6eb4087a39467bc7f 639a517d71b4722bcec020f6eb4087a39467bc7f docs/prototype/vc-redesign/tools/capture-git.ts\n? assets/video/\u4E2D\u6587-spec-implementspec-2.mp4\n? docs/prototype/vc-redesign/src/data/capabilities.generated.ts\n? docs/prototype/vc-redesign/src/data/pages-copy.ts\n? docs/prototype/vc-redesign/src/domain/pages.ts\n? docs/prototype/vc-redesign/src/ui/views/page-shell.ts\n? docs/prototype/vc-redesign/tools/_probe.mjs\n? docs/prototype/vc-redesign/tools/capture-capabilities.ts\n";

  // docs/prototype/vc-redesign/src/data/screen.ts
  var WORKING_CHANGES = [
    { path: "src/client/views/shared/workRouteTable.ts", kind: "ordinary", x: ".", y: "M", added: 2, deleted: 2 },
    { path: "src/refresh/rooms/host/outbound-admission.ts", kind: "ordinary", x: ".", y: "M", added: 23, deleted: 1 },
    { path: "docs/review/20261025-spec-complete-prompt-review.html", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: "docs/design/md-env-check-chain.png", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: "docs/design/md-env-check-chain.svg", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: "tests/verify-1545-workroute-row-nav.ts", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/issue1518-body.md", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/issue1518-original-body.md", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/probe-spec-capsule.mjs", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/probe2.mjs", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/temp/pr-1475-body.md", kind: "untracked", x: "?", y: "?", added: null, deleted: null }
  ];
  function branchSamples(nowMs, headShort) {
    const minute = 60 * 1e3;
    return [
      {
        name: capturedBranch,
        upstream: `origin/${capturedBranch}`,
        ahead: 2,
        behind: 0,
        oidShort: headShort,
        lastCommitMs: nowMs - 6 * minute,
        subject: "\u7248\u672C\u7BA1\u7406\u9875\u91CD\u6784\u539F\u578B\u6536\u5C3E\uFF0C\u5DE5\u4F5C\u6811\u52A8\u4F5C\u5168\u90E8\u6536\u8FDB\u9762\u677F",
        mergedIntoCurrent: true
      },
      {
        name: "release/2026-10",
        upstream: "origin/release/2026-10",
        ahead: 0,
        behind: 4,
        oidShort: "3b7c1d9",
        lastCommitMs: nowMs - 26 * 60 * minute,
        subject: "\u6574\u7406\u5341\u6708\u53D1\u5E03\u8BF4\u660E\u4E0E\u56DE\u6EDA\u6B65\u9AA4",
        mergedIntoCurrent: false
      },
      {
        name: "feature/version-control-redesign",
        upstream: "origin/feature/version-control-redesign",
        ahead: 3,
        behind: 0,
        oidShort: "9d2e4a1",
        lastCommitMs: nowMs - 3 * 60 * minute,
        subject: "\u5206\u652F\u9875\u4E0E\u52A8\u4F5C\u6A21\u578B\u63A5\u5165\u9762\u677F\u9AA8\u67B6",
        mergedIntoCurrent: false
      },
      {
        name: "fix/rail-tab-overflow",
        upstream: "origin/fix/rail-tab-overflow",
        ahead: 0,
        behind: 1,
        oidShort: "c41a7f2",
        lastCommitMs: nowMs - 2 * 24 * 60 * minute,
        subject: "\u7A84\u6863\u4E0B\u9875\u7B7E\u8BA1\u6570\u6362\u884C\u6324\u538B\u5185\u5BB9",
        mergedIntoCurrent: false
      },
      {
        name: "chore/docs-cleanup",
        upstream: null,
        ahead: 0,
        behind: 0,
        oidShort: "5e8b0c3",
        lastCommitMs: nowMs - 5 * 24 * 60 * minute,
        subject: "\u5220\u6389\u91CD\u590D\u7684\u8BBE\u8BA1\u7A3F\u622A\u56FE\u8BF4\u660E",
        mergedIntoCurrent: true
      },
      {
        name: "experiment/old-layout",
        upstream: null,
        ahead: 0,
        behind: 0,
        oidShort: "a06d3e8",
        lastCommitMs: nowMs - 12 * 24 * 60 * minute,
        subject: "\u65E7\u7248\u4E09\u680F\u5E03\u5C40\u7684\u8BD5\u9A8C\u5206\u652F\uFF0C\u7559\u7740\u5BF9\u7167",
        mergedIntoCurrent: true
      }
    ];
  }
  function worktreeRecords() {
    return capturedWorktrees.map((w) => ({
      path: w.path,
      head: w.head,
      branch: w.branch,
      bare: w.bare,
      detached: w.detached,
      locked: w.locked,
      lockReason: w.lockReason,
      prunable: w.prunable,
      prunableReason: null
    }));
  }
  function refRecords(basisMs) {
    return [
      {
        ref: `refs/heads/${capturedBranch}`,
        short: capturedBranch,
        oid: capturedHead,
        upstream: `origin/${capturedBranch}`,
        upstreamGone: false,
        ahead: 2,
        behind: 0,
        current: true,
        commitDateMs: basisMs
      }
    ];
  }
  function buildPrototypeData() {
    const nowMs = Date.now();
    const basisMs = nowMs - 12 * 60 * 1e3;
    const statusEntries = WORKING_CHANGES.map((c) => ({
      kind: c.kind,
      x: c.x,
      y: c.y,
      path: c.path,
      origPath: null
    }));
    const diffFiles = WORKING_CHANGES.filter((c) => c.added !== null && c.deleted !== null).map((c) => ({ path: c.path, origPath: null, added: c.added, deleted: c.deleted }));
    const input = {
      repoRoot: capturedRepoRoot,
      bare: false,
      statusHead: capturedBranch,
      statusDetached: false,
      statusOid: capturedHead,
      statusUpstream: `origin/${capturedBranch}`,
      statusAhead: 2,
      statusBehind: 0,
      statusEntries,
      worktrees: worktreeRecords(),
      refs: refRecords(basisMs),
      commits: capturedCommits.map((c) => ({
        oid: c.oid,
        short: c.short,
        author: c.author,
        email: c.email,
        authorDateMs: c.authorDateMs,
        commitDateMs: c.authorDateMs,
        subject: c.subject,
        parents: c.parents
      })),
      diffFiles,
      merging: false,
      rebasing: false,
      cherryPicking: false,
      reverting: false,
      tier: "full",
      autocrlf: null,
      nowMs,
      basisMs
    };
    const result = assemble(input);
    if (!result.ok) throw new Error(`\u771F\u5B9E\u7EC4\u88C5\u5668\u62D2\u7EDD\u4E86\u539F\u578B\u6570\u636E\uFF1A${result.detail}`);
    const commitFiles = /* @__PURE__ */ new Map();
    for (const c of capturedCommits) commitFiles.set(c.oid, c.files);
    return {
      screen: result.screen,
      commits: capturedCommits,
      commitFiles,
      branches: branchSamples(nowMs, capturedHead.slice(0, 7)),
      repoRoot: capturedRepoRoot,
      branch: capturedBranch,
      nowMs
    };
  }

  // docs/prototype/vc-redesign/src/domain/session.ts
  function createSessionState(base, nowMs) {
    const conflicts = [];
    const staged = [];
    const unstaged = [];
    const screen = base.screen;
    for (const entry of screen.staged) {
      if (entry.conflict) conflicts.push(entry.path);
      else if (entry.staged) staged.push(entry.path);
    }
    for (const entry of screen.unstaged) {
      if (entry.conflict) {
        if (!conflicts.includes(entry.path)) conflicts.push(entry.path);
      } else if (!unstaged.includes(entry.path)) {
        unstaged.push(entry.path);
      }
    }
    return {
      view: "changes",
      busy: null,
      reloading: false,
      result: null,
      confirmPull: null,
      staged,
      unstaged,
      conflicts,
      ahead: screen.identity.ahead,
      behind: screen.identity.behind,
      basisMs: screen.identity.basisMs,
      // 读取时刻就是页面打开、首屏到手的那一刻；远端依据是首屏数据里更早的基准。
      // 两个时钟必须分开：前者说明「这份界面什么时候读的盘」，后者说明「比较远端时用的是哪一刻的引用」。
      readAtMs: nowMs,
      changesFilter: "all",
      openFile: null,
      message: "",
      historyQuery: "",
      historyMergeOnly: false,
      historyOpenOid: null,
      historyOpenFile: null,
      localCommits: [],
      copiedPath: null,
      demoWorktrees: false,
      branchOpen: false,
      branchSub: "list",
      branchSelected: null,
      branchDraft: "",
      branchQuery: "",
      branchPending: null,
      branches: base.branches.map((row) => ({ ...row })),
      worktreePending: null,
      hiddenWorktrees: [],
      unlockedWorktrees: [],
      prunedWorktrees: [],
      changesPending: null,
      openMenuPath: null,
      ignored: [],
      stashes: [],
      stashPending: null,
      undoneOid: null
    };
  }
  function unique(paths) {
    return paths.filter((path, index) => paths.indexOf(path) === index);
  }
  function withResult(state, result) {
    return { ...state, result };
  }
  function enterBusy(state, op) {
    if (state.busy !== null || state.reloading) return state;
    return { ...state, busy: op, confirmPull: null, result: null };
  }
  function finishBusy(state, op, nowMs) {
    switch (op) {
      case "pull": {
        const fastForward = state.behind > 0;
        const next = {
          ...state,
          busy: null,
          behind: 0,
          basisMs: nowMs,
          readAtMs: nowMs
        };
        return withResult(next, {
          tone: fastForward ? "ok" : "info",
          text: fastForward ? "\u5DF2\u76F4\u63A5\u66F4\u65B0\u5230\u8FDC\u7AEF\u6700\u65B0\u3002" : "\u5DF2\u662F\u6700\u65B0\u72B6\u6001\u3002",
          detail: fastForward ? "\u672C\u5730\u63D0\u4EA4\u6CA1\u6709\u88AB\u6539\u5199\u3002\u8FDC\u7AEF\u65B0\u63D0\u4EA4\u5DF2\u7ECF\u63A5\u5230\u5F53\u524D\u5206\u652F\u540E\u9762\u3002" : "\u8FDC\u7AEF\u6CA1\u6709\u65B0\u7684\u63D0\u4EA4\u9700\u8981\u6574\u5408\u3002",
          source: "sync"
        });
      }
      case "push": {
        const pushed = state.ahead;
        const next = { ...state, busy: null, ahead: 0 };
        if (pushed === 0) {
          return withResult(next, {
            tone: "info",
            text: "\u8FDC\u7AEF\u5DF2\u662F\u6700\u65B0\uFF0C\u6CA1\u6709\u9700\u8981\u63A8\u9001\u7684\u63D0\u4EA4\u3002",
            detail: null,
            source: "sync"
          });
        }
        return withResult(next, {
          tone: "ok",
          text: `\u63A8\u9001\u5B8C\u6210\uFF1A${pushed} \u7B14\u63D0\u4EA4\u5DF2\u5230\u8FBE\u8FDC\u7AEF\u3002`,
          detail: "\u63A8\u9001\u6210\u529F\u540E\u8FDC\u7AEF\u8DDF\u8E2A\u5F15\u7528\u5DF2\u7ECF\u5237\u65B0\uFF0C\u8D85\u524D\u4E0E\u843D\u540E\u90FD\u5F52\u96F6\u3002",
          source: "sync"
        });
      }
      case "fetch": {
        return withResult({ ...state, busy: null, basisMs: nowMs, readAtMs: nowMs }, {
          tone: "ok",
          text: "\u66F4\u65B0\u5B8C\u6210\uFF1A\u8FDC\u7AEF\u4F9D\u636E\u5DF2\u5237\u65B0\u3002",
          detail: unique(["\u8FDC\u7AEF\u8DDF\u8E2A\u5F15\u7528\u5DF2\u66F4\u65B0\u3002\u5DE5\u4F5C\u6811\u4E0E\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u7684\u6E05\u5355\u6CA1\u6709\u53D8\u5316\u3002"]).join(""),
          source: "sync"
        });
      }
      default:
        return { ...state, busy: null };
    }
  }
  function shortOid2() {
    let out = "";
    for (let i = 0; i < 7; i += 1) out += "0123456789abcdef"[Math.floor(Math.random() * 16)];
    return out;
  }
  function reduce(state, action, base) {
    switch (action.type) {
      case "demo-worktrees":
        return { ...state, demoWorktrees: true };
      case "view":
        return { ...state, view: action.view };
      case "tick":
        return { ...state };
      case "stage": {
        if (state.busy !== null || state.reloading) return state;
        if (state.conflicts.includes(action.path)) return state;
        if (!state.unstaged.includes(action.path)) return state;
        return {
          ...state,
          unstaged: state.unstaged.filter((path) => path !== action.path),
          staged: unique([...state.staged, action.path])
        };
      }
      case "unstage": {
        if (state.busy !== null || state.reloading) return state;
        if (!state.staged.includes(action.path)) return state;
        return {
          ...state,
          staged: state.staged.filter((path) => path !== action.path),
          unstaged: unique([...state.unstaged, action.path])
        };
      }
      case "stage-all": {
        if (state.busy !== null || state.reloading) return state;
        if (state.conflicts.length > 0) return state;
        return { ...state, staged: unique([...state.staged, ...state.unstaged]), unstaged: [] };
      }
      case "unstage-all": {
        if (state.busy !== null || state.reloading) return state;
        return { ...state, unstaged: unique([...state.unstaged, ...state.staged]), staged: [] };
      }
      case "filter":
        return { ...state, changesFilter: action.filter };
      case "toggle-file":
        return { ...state, openFile: state.openFile === action.path ? null : action.path };
      case "message":
        return { ...state, message: action.value };
      case "commit-start":
        return enterBusy(state, "commit");
      case "commit-finish": {
        const staged = state.staged;
        const message = state.message.trim();
        if (staged.length === 0 || message === "") {
          return {
            ...state,
            busy: null,
            result: { tone: "error", text: staged.length === 0 ? "\u8FD8\u6CA1\u6709\u6587\u4EF6\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\uFF0C\u5148\u52A0\u5165\u8981\u63D0\u4EA4\u7684\u6587\u4EF6\u3002" : "\u586B\u5199\u63D0\u4EA4\u8BF4\u660E\u540E\u5373\u53EF\u63D0\u4EA4\u3002", detail: null, source: "commit" }
          };
        }
        const files = staged.map((path) => {
          const meta = metadataOf(base, path);
          return { path, added: meta?.addedLines ?? 0, deleted: meta?.deletedLines ?? 0 };
        });
        const commit = {
          oid: shortOid2() + shortOid2() + shortOid2() + shortOid2() + shortOid2() + shortOid2(),
          short: shortOid2(),
          subject: message,
          author: "\u8FB0\u8FB0\u6D0B\u6D0B",
          authorDateMs: Date.now(),
          parents: [state.localCommits[0]?.oid ?? base.screen.commits[0]?.oid ?? ""],
          files
        };
        return {
          ...state,
          busy: null,
          staged: [],
          message: "",
          ahead: state.ahead + 1,
          localCommits: [commit, ...state.localCommits],
          result: {
            tone: "ok",
            text: `\u63D0\u4EA4\u5B8C\u6210\uFF1A${files.length} \u4E2A\u6587\u4EF6\u5DF2\u8FDB\u5165\u5386\u53F2\u3002`,
            detail: "\u8FD9\u6B21\u63D0\u4EA4\u53EA\u5305\u542B\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u6587\u4EF6\u3002\u8FD9\u4EFD\u6E05\u5355\u5DF2\u7ECF\u6E05\u7A7A\uFF0C\u53EF\u4EE5\u63A5\u7740\u52A0\u5165\u4E0B\u4E00\u6279\u3002",
            source: "commit"
          }
        };
      }
      case "op-start":
        return enterBusy(state, action.op);
      case "op-finish":
        if (state.busy !== action.op) return state;
        return finishBusy(state, action.op, action.nowMs);
      case "reload-start":
        if (state.busy !== null || state.reloading) return state;
        return { ...state, reloading: true, result: null };
      case "reload-finish":
        return {
          ...state,
          reloading: false,
          readAtMs: action.readAtMs,
          basisMs: action.basisMs,
          result: { tone: "info", text: "\u5DF2\u91CD\u65B0\u8BFB\u53D6\u3002", detail: "\u9996\u5C4F\u8BFB\u6570\u4E0E\u8FDC\u7AEF\u4F9D\u636E\u90FD\u5DF2\u5237\u65B0\u3002\u8FDC\u7AEF\u5F15\u7528\u6709\u6CA1\u6709\u53D8\u5316\u770B\u300C\u66F4\u65B0\u300D\u3002", source: "reload" }
        };
      case "pull-confirm-open":
        return { ...state, confirmPull: { dirtyCount: action.dirtyCount, files: action.files } };
      case "pull-confirm-close":
        return { ...state, confirmPull: null };
      case "history-query":
        return { ...state, historyQuery: action.value };
      case "history-merge-only":
        return { ...state, historyMergeOnly: !state.historyMergeOnly };
      case "history-open":
        return { ...state, historyOpenOid: action.oid, historyOpenFile: null };
      case "history-open-file":
        return { ...state, historyOpenFile: state.historyOpenFile === action.path ? null : action.path };
      case "history-back":
        return { ...state, historyOpenOid: null, historyOpenFile: null };
      case "result-clear":
        return state.result === null ? state : { ...state, result: null };
      case "copy":
        return withResult({ ...state, copiedPath: action.path }, {
          tone: "ok",
          text: `\u5DF2\u590D\u5236\uFF1A${action.path}`,
          detail: "\u590D\u5236\u8D70\u7684\u662F\u6D4F\u89C8\u5668\u7684\u526A\u8D34\u677F\u3002\u9762\u677F\u4E0D\u4F1A\u56E0\u6B64\u53D1\u8D77\u4EFB\u4F55 git \u64CD\u4F5C\u3002",
          source: "copy"
        });
      case "ai-worktrees":
        return withResult(state, {
          tone: "info",
          text: "\u539F\u578B\u91CC AI \u4EA4\u63A5\u53EA\u505A\u63D0\u793A\u3002",
          detail: "\u771F\u5B9E\u9875\u9762\u4F1A\u6253\u5F00\u672C\u673A DSH \u4F1A\u8BDD\uFF0C\u5E76\u5728\u63D0\u793A\u91CC\u5E26\u4E0A\u5F02\u5E38\u5DE5\u4F5C\u6811\u7684\u8DEF\u5F84\u4E0E\u72B6\u6001\u3002",
          source: "ai"
        });
      case "wt-pending":
        return { ...state, worktreePending: action.pending };
      case "wt-apply": {
        const pending = state.worktreePending;
        if (pending === null) return state;
        const hidden = state.hiddenWorktrees.includes(pending.path) ? state.hiddenWorktrees : [...state.hiddenWorktrees, pending.path];
        if (pending.kind === "unlock") {
          return withResult({
            ...state,
            worktreePending: null,
            unlockedWorktrees: unique([...state.unlockedWorktrees, pending.path])
          }, { tone: "ok", text: `\u5DF2\u89E3\u9664\u5360\u7528\uFF1A${pending.name}\u3002`, detail: "\u5DE5\u4F5C\u76EE\u5F55\u4E0E\u91CC\u9762\u7684\u6539\u52A8\u90FD\u6CA1\u6709\u52A8\uFF0C\u53EA\u662F\u53BB\u6389\u4E86 git \u7684\u5360\u7528\u6807\u8BB0\u3002", source: "worktree" });
        }
        if (pending.kind === "prune") {
          return withResult({
            ...state,
            worktreePending: null,
            hiddenWorktrees: hidden,
            prunedWorktrees: unique([...state.prunedWorktrees, pending.path])
          }, { tone: "ok", text: `\u5DF2\u6E05\u7406\u8BB0\u5F55\uFF1A${pending.name}\u3002`, detail: "\u8FD9\u6761\u8BB0\u5F55\u5BF9\u5E94\u7684\u76EE\u5F55\u672C\u6765\u5C31\u4E0D\u5B58\u5728\uFF0C\u6E05\u7406\u4E0D\u4F1A\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\u3002", source: "worktree" });
        }
        return withResult({
          ...state,
          worktreePending: null,
          hiddenWorktrees: hidden
        }, { tone: "ok", text: `\u5DF2\u79FB\u9664\u5DE5\u4F5C\u6811\uFF1A${pending.name}\u3002`, detail: "\u5206\u652F\u4E0E\u63D0\u4EA4\u90FD\u8FD8\u5728\u4ED3\u5E93\u91CC\u3002\u8FD9\u4E00\u6B65\u53EA\u5220\u6389\u4E86\u68C0\u51FA\u8BB0\u5F55\u4E0E\u5DE5\u4F5C\u76EE\u5F55\u3002", source: "worktree" });
      }
      case "changes-pending":
        return { ...state, changesPending: action.pending, openMenuPath: null };
      case "changes-open-menu":
        return { ...state, openMenuPath: action.path, changesPending: null };
      case "changes-apply": {
        const pending = state.changesPending;
        if (pending === null) return state;
        const cleared = { ...state, changesPending: null };
        const path = pending.path;
        const name = path === null ? "" : nameOfPath(path);
        switch (pending.kind) {
          case "discard": {
            if (path === null || !state.unstaged.includes(path)) return cleared;
            const lines = changeSummary(base, path);
            return withResult({
              ...cleared,
              unstaged: state.unstaged.filter((item) => item !== path)
            }, {
              tone: "warn",
              text: `\u5DF2\u4E22\u5F03 ${name} \u7684\u672A\u52A0\u5165\u6539\u52A8\u3002`,
              detail: lines === "" ? "\u6587\u4EF6\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\u3002\u9762\u677F\u4E0D\u80FD\u64A4\u56DE\u8FD9\u4E00\u6B65\u3002" : `\u6587\u4EF6\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF0C${lines} \u4E00\u8D77\u4E22\u6389\u4E86\u3002\u9762\u677F\u4E0D\u80FD\u64A4\u56DE\u8FD9\u4E00\u6B65\u3002`,
              source: "changes"
            });
          }
          case "discard-all": {
            const count = state.unstaged.length;
            if (count === 0) return cleared;
            return withResult({ ...cleared, unstaged: [] }, {
              tone: "warn",
              text: `\u5DF2\u4E22\u5F03 ${count} \u4E2A\u6587\u4EF6\u7684\u672A\u52A0\u5165\u6539\u52A8\u3002`,
              detail: "\u8FD9\u4E9B\u6587\u4EF6\u90FD\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\u3002\u9762\u677F\u4E0D\u80FD\u64A4\u56DE\u8FD9\u4E00\u6B65\u3002",
              source: "changes"
            });
          }
          case "ignore": {
            if (path === null || !state.unstaged.includes(path)) return cleared;
            return withResult({
              ...cleared,
              unstaged: state.unstaged.filter((item) => item !== path),
              ignored: unique([...state.ignored, path])
            }, {
              tone: "info",
              text: `\u5DF2\u628A ${name} \u52A0\u5165 .gitignore\u3002`,
              detail: "\u6587\u4EF6\u4ECD\u7136\u7559\u5728\u78C1\u76D8\u4E0A\uFF0Cgit \u4ECE\u4E0B\u4E00\u6B21\u8BFB\u53D6\u8D77\u4E0D\u518D\u8DDF\u8E2A\u5B83\u3002\u5DF2\u7ECF\u63D0\u4EA4\u8FDB\u5386\u53F2\u7684\u5185\u5BB9\u4E0D\u53D7\u5F71\u54CD\u3002\u539F\u578B\u4E0D\u4F1A\u771F\u7684\u6539 .gitignore\u3002",
              source: "changes"
            });
          }
          case "delete-untracked": {
            if (path === null || !state.unstaged.includes(path)) return cleared;
            return withResult({
              ...cleared,
              unstaged: state.unstaged.filter((item) => item !== path)
            }, {
              tone: "warn",
              text: `\u5DF2\u5220\u9664\u672A\u8DDF\u8E2A\u6587\u4EF6 ${name}\u3002`,
              detail: "\u5B83\u4ECE\u6765\u6CA1\u6709\u8FDB\u8FC7 git \u5386\u53F2\uFF0C\u5220\u9664\u4EE5\u540E\u6CA1\u6709\u4EFB\u4F55\u5730\u65B9\u80FD\u627E\u56DE\u3002\u539F\u578B\u4E0D\u4F1A\u771F\u7684\u5220\u78C1\u76D8\u4E0A\u7684\u6587\u4EF6\u3002",
              source: "changes"
            });
          }
          case "resolve-ours":
          case "resolve-theirs": {
            if (path === null || !state.conflicts.includes(path)) return cleared;
            const conflicts = state.conflicts.filter((item) => item !== path);
            const side = pending.kind === "resolve-ours" ? "\u5F53\u524D\u5206\u652F" : "\u5BF9\u65B9";
            return withResult({
              ...cleared,
              conflicts,
              staged: unique([...state.staged, path])
            }, {
              tone: "ok",
              text: `\u5DF2\u6309${side}\u7684\u7248\u672C\u89E3\u51B3 ${name}\uFF0C\u6587\u4EF6\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u3002`,
              detail: conflicts.length === 0 ? "\u51B2\u7A81\u5DF2\u7ECF\u5168\u90E8\u89E3\u51B3\uFF0C\u73B0\u5728\u53EF\u4EE5\u63D0\u4EA4\u8FD9\u6B21\u5408\u5E76\u7684\u7ED3\u679C\u3002" : `\u8FD8\u6709 ${conflicts.length} \u4E2A\u51B2\u7A81\u6587\u4EF6\u6CA1\u6709\u89E3\u51B3\u3002`,
              source: "changes"
            });
          }
          default:
            return cleared;
        }
      }
      case "demo-conflicts":
        return { ...state, conflicts: unique([...state.conflicts, "src/client/views/versionControl/vcWriteView.ts", "src/shared/version-control/src/rules.ts"]) };
      case "branch-open":
        return { ...state, branchOpen: true, branchSub: "list", branchSelected: null, branchDraft: "", branchPending: null };
      case "branch-close":
        return { ...state, branchOpen: false, branchPending: null, branchDraft: "" };
      case "branch-select":
        return { ...state, branchSelected: action.name, branchSub: "detail", branchPending: null, branchDraft: "" };
      case "branch-sub":
        return { ...state, branchSub: action.sub, branchDraft: "", branchPending: null };
      case "branch-draft":
        return { ...state, branchDraft: action.value };
      case "branch-query":
        return { ...state, branchQuery: action.value };
      case "branch-pending":
        return { ...state, branchPending: action.pending };
      case "branch-create": {
        if (state.busy !== null || state.reloading) return state;
        const name = state.branchDraft.trim();
        if (name === "" || /\s/.test(name)) {
          return withResult(state, { tone: "error", text: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002", detail: null, source: "branch" });
        }
        if (state.branches.some((row) => row.name === name)) {
          return withResult(state, { tone: "error", text: `\u5206\u652F ${name} \u5DF2\u7ECF\u5B58\u5728\u3002`, detail: null, source: "branch" });
        }
        const current = state.branches.find((row) => row.current);
        const created = {
          name,
          upstream: null,
          ahead: 0,
          behind: 0,
          oidShort: current === void 0 ? state.branches[0]?.oidShort ?? "" : current.oidShort,
          lastCommitMs: Date.now(),
          subject: current === void 0 ? "\u4ECE\u5F53\u524D\u63D0\u4EA4\u521B\u5EFA" : `\u4ECE ${current.name} \u7684\u5F53\u524D\u63D0\u4EA4\u521B\u5EFA`,
          mergedIntoCurrent: true,
          current: false
        };
        return withResult({
          ...state,
          branches: [...state.branches, created],
          branchSub: "detail",
          branchSelected: name,
          branchDraft: ""
        }, { tone: "ok", text: `\u5DF2\u521B\u5EFA\u5206\u652F ${name}\uFF0C\u8FD8\u6CA1\u6709\u5207\u6362\u8FC7\u53BB\u3002`, detail: "\u65B0\u5206\u652F\u6307\u5411\u5F53\u524D\u5206\u652F\u7684\u6700\u65B0\u63D0\u4EA4\u3002\u5207\u6362\u8FC7\u53BB\u4E4B\u540E\u624D\u4F1A\u5728\u5B83\u4E0A\u9762\u63D0\u4EA4\u3002", source: "branch" });
      }
      case "branch-rename": {
        if (state.busy !== null || state.reloading) return state;
        const name = state.branchDraft.trim();
        const from = action.name;
        if (name === "" || /\s/.test(name)) {
          return withResult(state, { tone: "error", text: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002", detail: null, source: "branch" });
        }
        if (name === from) return { ...state, branchSub: "detail", branchDraft: "" };
        if (state.branches.some((row) => row.name === name)) {
          return withResult(state, { tone: "error", text: `\u5206\u652F ${name} \u5DF2\u7ECF\u5B58\u5728\u3002`, detail: null, source: "branch" });
        }
        return withResult({
          ...state,
          branches: state.branches.map((row) => row.name === from ? { ...row, name } : row),
          branchSub: "detail",
          branchSelected: name,
          branchDraft: ""
        }, { tone: "ok", text: `\u5206\u652F ${from} \u5DF2\u6539\u540D\u4E3A ${name}\u3002`, detail: "\u53EA\u6539\u672C\u5730\u540D\u5B57\u3002\u4E0A\u6E38\u8DDF\u8E2A\u5F15\u7528\u4E0E\u8FDC\u7AEF\u5206\u652F\u540D\u90FD\u4E0D\u53D7\u5F71\u54CD\u3002", source: "branch" });
      }
      case "branch-switch": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        if (target === void 0 || target.current) return { ...state, branchPending: null };
        return withResult({
          ...state,
          branches: state.branches.map((row) => ({ ...row, current: row.name === action.name })),
          branchPending: null,
          branchSub: "detail",
          branchSelected: action.name,
          ahead: target.ahead,
          behind: target.behind
        }, { tone: "ok", text: `\u5DF2\u5207\u6362\u5230\u5206\u652F ${action.name}\u3002`, detail: "\u5DE6\u4FA7\u5DE5\u4F5C\u533A\u7684\u672A\u63D0\u4EA4\u6539\u52A8\u5DF2\u7ECF\u5E26\u8FC7\u6765\u4E86\u3002\u8BFB\u5199\u4E0E\u63D0\u4EA4\u90FD\u53D1\u751F\u5728\u65B0\u5206\u652F\u4E0A\u3002", source: "branch" });
      }
      case "branch-merge": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        const current = state.branches.find((row) => row.current);
        if (target === void 0 || current === void 0) return { ...state, branchPending: null };
        if (target.current) {
          return withResult(state, { tone: "error", text: "\u4E0D\u80FD\u628A\u5F53\u524D\u5206\u652F\u5408\u5E76\u8FDB\u5B83\u81EA\u5DF1\u3002", detail: null, source: "branch" });
        }
        const commits = target.ahead + 1;
        return withResult({
          ...state,
          branches: state.branches.map((row) => row.name === target.name ? { ...row, mergedIntoCurrent: true } : row),
          ahead: state.ahead + commits,
          branchPending: null
        }, {
          tone: "ok",
          text: `\u5DF2\u628A ${target.name} \u5408\u5E76\u8FDB ${current.name}\uFF0C\u63A5\u5165 ${commits} \u4E2A\u63D0\u4EA4\u3002`,
          detail: "\u8FD9\u6B21\u5408\u5E76\u6CA1\u6709\u51B2\u7A81\u3002\u5408\u5E76\u540E\u7684\u7ED3\u679C\u8FD8\u5728\u672C\u5730\uFF0C\u63A8\u9001\u4E4B\u540E\u8FDC\u7AEF\u624D\u770B\u5F97\u5230\u3002",
          source: "branch"
        });
      }
      case "branch-delete": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        if (target === void 0) return { ...state, branchPending: null };
        if (target.current) {
          return withResult(state, { tone: "error", text: "\u4E0D\u80FD\u5220\u9664\u5F53\u524D\u5206\u652F\uFF0C\u5148\u5207\u6362\u5230\u522B\u7684\u5206\u652F\u3002", detail: null, source: "branch" });
        }
        return withResult({
          ...state,
          branches: state.branches.filter((row) => row.name !== action.name),
          branchSub: "list",
          branchSelected: null,
          branchPending: null
        }, { tone: "ok", text: `\u5DF2\u5220\u9664\u5206\u652F ${action.name}\u3002`, detail: "\u53EA\u5220\u4E86\u672C\u5730\u8BB0\u5F55\u3002\u5982\u679C\u8FDC\u7AEF\u8FD8\u6709\u8FD9\u6761\u5206\u652F\uFF0C\u5B83\u4E0D\u53D7\u5F71\u54CD\u3002", source: "branch" });
      }
      case "branch-rebase": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        const current = state.branches.find((row) => row.current);
        if (target === void 0 || current === void 0 || target.current) {
          return withResult(state, { tone: "error", text: "\u4E0D\u80FD\u628A\u5F53\u524D\u5206\u652F\u53D8\u57FA\u5230\u5B83\u81EA\u5DF1\u3002", detail: null, source: "branch" });
        }
        return withResult({
          ...state,
          branches: state.branches.map((row) => row.name === target.name ? { ...row, mergedIntoCurrent: true } : row),
          branchSub: "list",
          branchSelected: null
        }, {
          tone: "warn",
          text: `\u5DF2\u628A ${current.name} \u53D8\u57FA\u5230 ${target.name} \u4E0A\u3002`,
          detail: "\u672C\u5730\u5386\u53F2\u88AB\u91CD\u5199\u6210\u300C\u5148\u653E\u5BF9\u65B9\u5206\u652F\uFF0C\u518D\u63A5\u4E0A\u81EA\u5DF1\u7684\u63D0\u4EA4\u300D\u3002\u63D0\u4EA4\u53F7\u53D8\u4E86\uFF0C\u5982\u679C\u8FD9\u6761\u5206\u652F\u5DF2\u7ECF\u63A8\u9001\u8FC7\uFF0C\u8FDC\u7AEF\u9700\u8981\u5F3A\u63A8\u624D\u80FD\u5BF9\u9F50\u3002\u539F\u578B\u53EA\u6F14\u793A\u7ED3\u679C\u4E0E\u72B6\u6001\u53D8\u5316\uFF0C\u4E0D\u6539\u5199\u771F\u5B9E\u5386\u53F2\u3002",
          source: "branch"
        });
      }
      case "stash-create": {
        if (state.busy !== null || state.reloading) return state;
        if (state.conflicts.length > 0) {
          return withResult(state, { tone: "error", text: "\u6709\u51B2\u7A81\u6587\u4EF6\u65F6\u4E0D\u80FD\u6536\u8D77\u6539\u52A8\u3002", detail: "\u6536\u8D77\u6539\u52A8\u4F1A\u628A\u5DE5\u4F5C\u6811\u6062\u590D\u6210\u4E0A\u6B21\u63D0\u4EA4\u65F6\u7684\u6837\u5B50\uFF0C\u51B2\u7A81\u6587\u4EF6\u6CA1\u6709\u53EF\u4EE5\u5B89\u5168\u6062\u590D\u7684\u7248\u672C\u3002\u5148\u89E3\u51B3\u51B2\u7A81\uFF0C\u518D\u6536\u8D77\u5269\u4E0B\u7684\u6539\u52A8\u3002", source: "changes" });
        }
        const paths = unique([...state.staged, ...state.unstaged]);
        if (paths.length === 0) {
          return withResult(state, { tone: "info", text: "\u5DE5\u4F5C\u533A\u662F\u5E72\u51C0\u7684\uFF0C\u6CA1\u6709\u53EF\u6536\u8D77\u7684\u6539\u52A8\u3002", detail: null, source: "changes" });
        }
        const branchName = state.branches.find((row) => row.current)?.name ?? base.branch ?? "detached";
        const message = state.message.trim() === "" ? `WIP on ${branchName}` : state.message.trim();
        const entry = {
          id: `stash@{${state.stashes.length}}`,
          message,
          whenMs: Date.now(),
          paths
        };
        return withResult({
          ...state,
          stashes: [entry, ...state.stashes],
          staged: [],
          unstaged: [],
          message: ""
        }, {
          tone: "ok",
          text: `\u5DF2\u6536\u8D77 ${paths.length} \u4E2A\u6587\u4EF6\u7684\u6539\u52A8\u3002`,
          detail: `\u6536\u8D77\u8BB0\u5F55 ${entry.id} \u91CC\u653E\u7740\u8FD9\u4E9B\u6587\u4EF6\u3002\u5DE5\u4F5C\u533A\u4E0E\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u7684\u6E05\u5355\u90FD\u6062\u590D\u6210\u4E0A\u6B21\u63D0\u4EA4\u65F6\u7684\u6837\u5B50\uFF0C\u653E\u56DE\u5DE5\u4F5C\u533A\u6216\u653E\u56DE\u5E76\u5220\u6389\u8BB0\u5F55\u90FD\u80FD\u628A\u5B83\u62FF\u56DE\u6765\u3002`,
          source: "changes"
        });
      }
      case "stash-apply":
      case "stash-pop": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.stashes.find((row) => row.id === action.id);
        if (entry === void 0) return state;
        const restored = entry.paths.filter((path) => !state.conflicts.includes(path));
        const before = state.stashes.length;
        const stashes = action.type === "stash-pop" ? state.stashes.filter((row) => row.id !== action.id) : state.stashes;
        return withResult({
          ...state,
          stashes,
          unstaged: unique([...state.unstaged, ...restored]),
          stashPending: null
        }, {
          tone: "ok",
          text: action.type === "stash-pop" ? `\u5DF2\u628A ${entry.id} \u653E\u56DE\u5DE5\u4F5C\u533A\u5E76\u5220\u6389\u8BB0\u5F55\uFF0C${restored.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u5DE5\u4F5C\u533A\u3002` : `\u5DF2\u628A ${entry.id} \u653E\u56DE\u5DE5\u4F5C\u533A\uFF0C${restored.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u5DE5\u4F5C\u533A\u3002`,
          detail: action.type === "stash-pop" ? `\u300C\u653E\u56DE\u5E76\u5220\u6389\u8BB0\u5F55\u300D\u7B49\u4E8E\u300C\u653E\u56DE + \u5220\u9664\u8BB0\u5F55\u300D\uFF1A\u8FD9\u6761\u8BB0\u5F55\u5DF2\u7ECF\u4ECE\u6E05\u5355\u91CC\u79FB\u9664\uFF08\u539F\u6765 ${before} \u6761\uFF09\u3002\u6539\u52A8\u73B0\u5728\u5728\u300C\u672A\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u91CC\uFF0C\u9700\u8981\u91CD\u65B0\u52A0\u5165\u518D\u63D0\u4EA4\u3002` : `\u300C\u653E\u56DE\u5DE5\u4F5C\u533A\u300D\u53EA\u628A\u6539\u52A8\u6062\u590D\u51FA\u6765\uFF0C\u8BB0\u5F55\u4ECD\u7136\u4FDD\u7559\u5728\u6E05\u5355\u91CC\uFF08${before} \u6761\uFF09\uFF0C\u53EF\u4EE5\u518D\u653E\u56DE\u4E00\u6B21\uFF0C\u4E4B\u540E\u4E5F\u53EF\u4EE5\u4E22\u5F03\u8BB0\u5F55\u3002`,
          source: "stash"
        });
      }
      case "stash-pending":
        return { ...state, stashPending: action.pending };
      case "stash-drop": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.stashes.find((row) => row.id === action.id);
        if (entry === void 0) return { ...state, stashPending: null };
        return withResult({
          ...state,
          stashes: state.stashes.filter((row) => row.id !== action.id),
          stashPending: null
        }, {
          tone: "warn",
          text: `\u5DF2\u4E22\u5F03\u8BB0\u5F55 ${entry.id}\u3002`,
          detail: `\u8BB0\u5F55\u91CC\u90A3 ${entry.paths.length} \u4E2A\u6587\u4EF6\u5F53\u65F6\u7684\u6837\u5B50\u5DF2\u7ECF\u4E0D\u5B58\u5728\u3002\u8FD9\u4E00\u6B65\u4E0D\u80FD\u64A4\u56DE\u3002`,
          source: "stash"
        });
      }
      case "commit-undo": {
        if (state.busy !== null || state.reloading) return state;
        const localHead = state.localCommits[0] ?? null;
        const capturedHead2 = base.screen.commits[0];
        const headOid = localHead !== null ? localHead.oid : capturedHead2?.oid ?? null;
        if (headOid === null || action.oid !== headOid) {
          return withResult(state, {
            tone: "error",
            text: "\u53EA\u80FD\u64A4\u9500\u6700\u65B0\u4E00\u6761\u63D0\u4EA4\u3002",
            detail: "\u64A4\u9500\u4F1A\u628A\u63D0\u4EA4\u91CC\u7684\u6539\u52A8\u653E\u56DE\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u3001\u5E76\u8BA9\u5206\u652F\u9000\u4E00\u6B65\u3002\u9009\u62E9\u66F4\u65E9\u7684\u63D0\u4EA4\u5C31\u5F97\u6539\u5199\u5B83\u540E\u9762\u7684\u5386\u53F2\uFF0C\u539F\u578B\u4E0D\u505A\u8FD9\u4E00\u6B65\u3002",
            source: "history"
          });
        }
        const files = localHead !== null ? localHead.files.map((file) => file.path) : (base.commitFiles.get(action.oid) ?? []).map((file) => file.path);
        const subject = localHead !== null ? localHead.subject : capturedHead2?.subject ?? "";
        const pushed = state.ahead === 0;
        return withResult({
          ...state,
          localCommits: localHead !== null ? state.localCommits.slice(1) : state.localCommits,
          undoneOid: localHead !== null ? state.undoneOid : action.oid,
          staged: unique([...state.staged, ...files]),
          message: state.message.trim() === "" ? subject : state.message,
          ahead: pushed ? state.ahead : Math.max(0, state.ahead - 1),
          behind: pushed ? state.behind + 1 : state.behind
        }, {
          tone: "warn",
          text: `\u5DF2\u64A4\u9500\u63D0\u4EA4 ${subject === "" ? action.oid.slice(0, 7) : subject}\u3002`,
          detail: pushed ? `\u63D0\u4EA4\u91CC\u7684 ${files.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\uFF0C\u63D0\u4EA4\u8BF4\u660E\u7559\u5728\u8F93\u5165\u6846\u91CC\u3002\u8FD9\u6761\u63D0\u4EA4\u5DF2\u7ECF\u63A8\u9001\u8FC7\uFF0C\u6240\u4EE5\u672C\u5730\u73B0\u5728\u6BD4\u8FDC\u7AEF\u5404\u5C11\u4E00\u6B65\uFF0C\u9700\u8981\u91CD\u65B0\u63D0\u4EA4\u540E\u518D\u63A8\u9001\u3002` : `\u63D0\u4EA4\u91CC\u7684 ${files.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\uFF0C\u63D0\u4EA4\u8BF4\u660E\u7559\u5728\u8F93\u5165\u6846\u91CC\u3002\u53EF\u4EE5\u6539\u5B8C\u518D\u91CD\u65B0\u63D0\u4EA4\u3002`,
          source: "history"
        });
      }
      case "commit-revert": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.localCommits.find((row) => row.oid === action.oid) ?? base.screen.commits.find((row) => row.oid === action.oid);
        if (entry === void 0) return state;
        return withResult({ ...state, ahead: state.ahead + 1 }, {
          tone: "ok",
          text: `\u5DF2\u751F\u6210\u4E00\u6B21\u53CD\u5411\u63D0\u4EA4\uFF0C\u62B5\u6D88\u300C${entry.subject}\u300D\u3002`,
          detail: "\u56DE\u9000\u4E0D\u662F\u5220\u9664\u5386\u53F2\uFF1A\u539F\u63D0\u4EA4\u8FD8\u5728\uFF0C\u540E\u9762\u591A\u4E86\u4E00\u7B14\u628A\u5B83\u7684\u6539\u52A8\u64A4\u56DE\u53BB\u7684\u65B0\u63D0\u4EA4\u3002\u8FD9\u7B14\u65B0\u63D0\u4EA4\u8FD8\u6CA1\u6709\u63A8\u9001\u3002\u5982\u679C\u548C\u522B\u7684\u5206\u652F\u51B2\u7A81\uFF0C\u9700\u8981\u5148\u89E3\u51B3\u51B2\u7A81\u3002\u539F\u578B\u4E0D\u771F\u7684\u5199\u5386\u53F2\u3002",
          source: "history"
        });
      }
      case "commit-cherry-pick": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.localCommits.find((row) => row.oid === action.oid) ?? base.screen.commits.find((row) => row.oid === action.oid);
        if (entry === void 0) return state;
        if (entry.parents.length > 1) {
          return withResult(state, { tone: "error", text: "\u5408\u5E76\u63D0\u4EA4\u4E0D\u80FD\u76F4\u63A5\u62E3\u9009\u3002", detail: "\u5408\u5E76\u63D0\u4EA4\u6709\u4E24\u4E2A\u7236\u63D0\u4EA4\uFF0C\u62E3\u9009\u65F6 git \u4E0D\u77E5\u9053\u8981\u5E26\u54EA\u4E00\u8FB9\u3002\u5148\u62E3\u9009\u5B83\u5F15\u5165\u7684\u90A3\u4E9B\u666E\u901A\u63D0\u4EA4\u3002", source: "history" });
        }
        return withResult({ ...state, ahead: state.ahead + 1 }, {
          tone: "ok",
          text: `\u5DF2\u628A\u63D0\u4EA4 ${entry.short} \u62E3\u9009\u5230\u5F53\u524D\u5206\u652F\u3002`,
          detail: "\u539F\u6765\u7684\u63D0\u4EA4\u7559\u5728\u5B83\u81EA\u5DF1\u7684\u5206\u652F\u4E0A\u3002\u5F53\u524D\u5206\u652F\u591A\u4E86\u4E00\u7B14\u5185\u5BB9\u76F8\u540C\u3001\u63D0\u4EA4\u53F7\u4E0D\u540C\u7684\u65B0\u63D0\u4EA4\uFF0C\u8FD8\u6CA1\u6709\u63A8\u9001\u3002\u539F\u578B\u4E0D\u771F\u7684\u5199\u5386\u53F2\u3002",
          source: "history"
        });
      }
      default:
        return state;
    }
  }
  function metadataOf(base, path) {
    return [...base.screen.staged, ...base.screen.unstaged].find((entry) => entry.path === path);
  }
  function nameOfPath(path) {
    const segments = path.split(/[\\/]/);
    return segments[segments.length - 1] ?? path;
  }
  function changeSummary(base, path) {
    const meta = metadataOf(base, path);
    if (meta === void 0) return "";
    const parts = [];
    if (meta.addedLines !== null && meta.addedLines > 0) parts.push(`\u65B0\u589E ${meta.addedLines} \u884C`);
    if (meta.deletedLines !== null && meta.deletedLines > 0) parts.push(`\u5220\u9664 ${meta.deletedLines} \u884C`);
    return parts.join("\uFF0C");
  }

  // docs/prototype/vc-redesign/src/domain/handoff.ts
  var TITLES = {
    general: "\u4E0D\u60F3\u4EB2\u81EA\u5904\u7406\uFF1F\u628A\u5F53\u524D\u72B6\u6001\u4EA4\u7ED9 AI",
    changes: "\u6539\u52A8\u592A\u591A\uFF1F\u4EA4\u7ED9 AI \u62C6\u6210\u51E0\u6761\u63D0\u4EA4",
    worktrees: "\u5DE5\u4F5C\u6811\u592A\u4E71\uFF1F\u4EA4\u7ED9 AI \u6536\u5C3E",
    branches: "\u5206\u652F\u5173\u7CFB\u592A\u4E71\uFF1F\u4EA4\u7ED9 AI \u7406\u6E05"
  };
  var LEDES = {
    general: "\u8FD9\u6BB5\u8BF4\u660E\u5E26\u7740\u4ED3\u5E93\u3001\u5206\u652F\u3001\u5DE5\u4F5C\u533A\u6587\u4EF6\u3001\u5176\u4ED6\u5DE5\u4F5C\u6811\u548C\u6700\u8FD1\u63D0\u4EA4\u3002\u590D\u5236\u4E4B\u540E\u7C98\u8D34\u5230\u65B0\u5BF9\u8BDD\u91CC\uFF0C\u5C31\u80FD\u63A5\u7740\u8C08\u3002",
    changes: "\u8FD9\u6BB5\u8BF4\u660E\u4F1A\u5217\u51FA\u6BCF\u4E00\u4E2A\u672A\u63D0\u4EA4\u7684\u6587\u4EF6\u548C\u589E\u5220\u884C\u6570\uFF0C\u590D\u5236\u4E4B\u540E\u7C98\u8D34\u5230\u65B0\u5BF9\u8BDD\u91CC\uFF0C\u8BA9 AI \u76F4\u63A5\u5224\u65AD\u8BE5\u5206\u6210\u51E0\u6761\u63D0\u4EA4\u3002",
    worktrees: "\u8FD9\u6BB5\u8BF4\u660E\u4F1A\u5217\u51FA\u6BCF\u4E00\u68F5\u5176\u4ED6\u5DE5\u4F5C\u6811\u7684\u72B6\u6001\u4E0E\u539F\u56E0\uFF0C\u590D\u5236\u4E4B\u540E\u8BA9 AI \u5224\u65AD\u54EA\u4E9B\u8BE5\u89E3\u9501\u3001\u54EA\u4E9B\u8BE5\u6E05\u7406\u8BB0\u5F55\u3001\u54EA\u4E9B\u8BE5\u79FB\u9664\u3002",
    branches: "\u8FD9\u6BB5\u8BF4\u660E\u4F1A\u5217\u51FA\u672C\u5730\u5206\u652F\u4E0E\u4E0A\u6E38\u7684\u5173\u7CFB\u3001\u9886\u5148\u843D\u540E\u4E0E\u662F\u5426\u5DF2\u5408\u5E76\uFF0C\u590D\u5236\u4E4B\u540E\u8BA9 AI \u7ED9\u51FA\u5B89\u5168\u7684\u5408\u5E76\u4E0E\u5220\u9664\u987A\u5E8F\u3002"
  };
  var GOALS = {
    general: "\u5148\u5E2E\u6211\u628A\u5F53\u524D\u72B6\u6001\u6838\u5BF9\u6E05\u695A\uFF0C\u518D\u544A\u8BC9\u6211\u4E0B\u4E00\u6B65\u6700\u503C\u5F97\u505A\u7684\u4E00\u4EF6\u4E8B\u3002",
    changes: "\u628A\u8FD9\u6279\u6539\u52A8\u6574\u7406\u6210\u82E5\u5E72\u6761\u4E3B\u9898\u6E05\u695A\u7684\u63D0\u4EA4\uFF0C\u5E76\u9010\u6761\u544A\u8BC9\u6211\u5E94\u8BE5\u628A\u54EA\u4E9B\u6587\u4EF6\u653E\u8FDB\u540C\u4E00\u6761\u63D0\u4EA4\u3002",
    worktrees: "\u628A\u5DE5\u4F5C\u6811\u6E05\u5355\u6062\u590D\u5E72\u51C0\uFF1A\u80FD\u89E3\u9501\u7684\u89E3\u9501\uFF0C\u80FD\u6E05\u7406\u8BB0\u5F55\u7684\u6E05\u7406\u8BB0\u5F55\uFF0C\u80FD\u79FB\u9664\u7684\u79FB\u9664\u3002\u6BCF\u4E00\u6B65\u5148\u8BF4\u6E05\u695A\u98CE\u9669\u3002",
    branches: "\u7406\u6E05\u5206\u652F\u5173\u7CFB\uFF1A\u8BE5\u5408\u5E76\u7684\u5408\u5E76\uFF0C\u8BE5\u5220\u9664\u7684\u5220\u9664\uFF0C\u7136\u540E\u544A\u8BC9\u6211\u4EE5\u540E\u600E\u4E48\u4FDD\u6301\u6574\u6D01\u3002"
  };
  function fileLine(entry) {
    if (entry.conflict) return `${entry.path}\uFF08\u51B2\u7A81\uFF0C\u5C1A\u672A\u89E3\u51B3\uFF09`;
    const added = entry.addedLines;
    const deleted = entry.deletedLines;
    if (added === null && deleted === null) return `${entry.path}\uFF08\u672A\u8DDF\u8E2A\u6216\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u6CA1\u6709\u884C\u6570\uFF09`;
    const parts = [];
    if (added !== null && added > 0) parts.push(`\u65B0\u589E ${added} \u884C`);
    if (deleted !== null && deleted > 0) parts.push(`\u5220\u9664 ${deleted} \u884C`);
    return parts.length === 0 ? `${entry.path}\uFF08\u5185\u5BB9\u4E0D\u53D8\uFF0C\u53EA\u6709\u6587\u4EF6\u72B6\u6001\u53D8\u5316\uFF09` : `${entry.path}\uFF08${parts.join("\uFF0C")}\uFF09`;
  }
  function pendingOperationText(screen) {
    const names = [];
    if (screen.repo.merging) names.push("\u5408\u5E76");
    if (screen.repo.rebasing) names.push("\u53D8\u57FA");
    if (screen.repo.cherryPicking) names.push("\u62E3\u9009");
    if (screen.repo.reverting) names.push("\u56DE\u9000");
    return names.length === 0 ? "\u65E0\uFF0C\u6CA1\u6709\u6B63\u5728\u8FDB\u884C\u7684\u5408\u5E76\u3001\u53D8\u57FA\u3001\u62E3\u9009\u6216\u56DE\u9000" : `\u6B63\u5728\u8FDB\u884C\uFF1A${names.join("\u3001")}`;
  }
  function worktreeStateText(row) {
    if (row.locked) return row.lockReason === null ? "\u5DF2\u88AB\u5360\u7528\uFF0Cgit \u8BB0\u4E86\u7BA1\u7406\u5458\u9501" : `\u5DF2\u88AB\u5360\u7528\uFF1A${row.lockReason}`;
    if (row.prunable) return "\u76EE\u5F55\u5DF2\u7ECF\u4E0D\u5B58\u5728\uFF0C\u53EA\u5269\u4E00\u6761 git \u8BB0\u5F55";
    if (row.prunableUnknown) return "\u76EE\u5F55\u8FD8\u5728\u4E0D\u5728\u65E0\u6CD5\u5224\u65AD\uFF0C\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4";
    return null;
  }
  function numbered(lines) {
    return lines.map((line, index) => `  ${index + 1}. ${line}`).join("\n");
  }
  function buildHandoff(data, kind, nowMs, focus) {
    const screen = data.screen;
    const identity = screen.identity;
    const upstream = screen.branches.find((row) => row.short === data.branch)?.upstream ?? null;
    const otherWorktrees = screen.otherWorktrees;
    const abnormal = otherWorktrees.filter((row) => worktreeStateText(row) !== null);
    const branches = data.branches;
    const mergedBranches = branches.filter((row) => row.mergedIntoCurrent && row.name !== data.branch);
    const looseBranches = branches.filter((row) => row.upstream === null && row.name !== data.branch);
    const stagedLines = screen.staged.map(fileLine);
    const unstagedLines = screen.unstaged.map(fileLine);
    const conflictLines = screen.unstaged.filter((row) => row.conflict).map(fileLine);
    const recentCommits = data.commits.slice(0, 5).map((commit) => `${commit.short} ${commit.subject}\uFF08${commit.author}\uFF0C${whenText(nowMs, commit.authorDateMs)}\uFF09`);
    const repoPath = data.repoRoot.replace(/\\/g, "/");
    const identityLines = [
      `\u8DEF\u5F84\uFF1A${repoPath}`,
      `\u5F53\u524D\u5DE5\u4F5C\u6811\uFF1A${identity.worktreePath.replace(/\\/g, "/")}`,
      `\u5206\u652F\uFF1A${identity.branch ?? "\u6E38\u79BB HEAD\uFF0C\u4E0D\u5728\u4EFB\u4F55\u5206\u652F\u4E0A"}`,
      `\u4E0A\u6E38\uFF1A${upstream ?? "\u8FD9\u6761\u5206\u652F\u6CA1\u6709\u8BBE\u7F6E\u4E0A\u6E38"}`,
      `\u540C\u6B65\uFF1A\u8D85\u524D ${identity.ahead} \u7B14\u63D0\u4EA4\uFF0C\u843D\u540E ${identity.behind} \u7B14\u63D0\u4EA4`
    ];
    const changesLines = [
      `\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\uFF1A${screen.stagedCount} \u4E2A\u6587\u4EF6`,
      ...stagedLines.length === 0 ? [] : [numbered(stagedLines)],
      `\u672A\u52A0\u5165\uFF1A${screen.unstagedCount} \u4E2A\u6587\u4EF6`,
      ...unstagedLines.length === 0 ? [] : [numbered(unstagedLines)],
      `\u51B2\u7A81\uFF1A${screen.conflictCount} \u4E2A\u6587\u4EF6`,
      ...conflictLines.length === 0 ? [] : [numbered(conflictLines)],
      `\u672A\u5B8C\u6210\u7684\u64CD\u4F5C\uFF1A${pendingOperationText(screen)}`
    ];
    const worktreeLines = otherWorktrees.length === 0 ? ["\u6CA1\u6709\u5176\u4ED6\u5DE5\u4F5C\u6811\u3002"] : [
      `\u5171 ${otherWorktrees.length} \u68F5\uFF0C\u5176\u4E2D ${abnormal.length} \u68F5\u9700\u8981\u5904\u7406\u3002`,
      ...abnormal.length === 0 ? [] : [numbered(abnormal.map((row) => {
        const reason = worktreeStateText(row);
        return `${row.display}\uFF1A${row.path}\uFF08${reason ?? ""}\uFF09`;
      }))]
    ];
    const branchLines = branches.length === 0 ? ["\u6CA1\u6709\u8BFB\u5230\u7684\u672C\u5730\u5206\u652F\u3002"] : [
      `\u672C\u5730 ${branches.length} \u6761\uFF0C\u5F53\u524D\u662F ${data.branch}\u3002`,
      numbered(branches.map((row) => {
        const parts = [];
        if (row.name === data.branch) parts.push("\u5F53\u524D\u5206\u652F");
        parts.push(row.upstream === null ? "\u6CA1\u6709\u4E0A\u6E38" : `\u4E0A\u6E38 ${row.upstream}`);
        if (row.ahead > 0) parts.push(`\u8D85\u524D ${row.ahead}`);
        if (row.behind > 0) parts.push(`\u843D\u540E ${row.behind}`);
        if (row.name !== data.branch) parts.push(row.mergedIntoCurrent ? "\u5DF2\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F" : "\u5C1A\u672A\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F");
        return `${row.name}\uFF08${parts.join("\uFF0C")}\uFF09\uFF1A${row.subject}`;
      })),
      `\u5176\u4E2D\u5DF2\u5408\u5E76 ${mergedBranches.length} \u6761\uFF0C\u6CA1\u6709\u4E0A\u6E38 ${looseBranches.length} \u6761\u3002`
    ];
    const prompt = [
      "\u6211\u5728\u672C\u5730\u4ED3\u5E93\u7684\u7248\u672C\u7BA1\u7406\u9875\u4E0A\u9047\u5230\u4E86\u4E0B\u9762\u7684\u60C5\u51B5\uFF0C\u8BF7\u4F60\u5E2E\u6211\u5224\u65AD\u5E76\u7ED9\u51FA\u4E0B\u4E00\u6B65\u505A\u6CD5\u3002",
      "",
      "\u3010\u4ED3\u5E93\u4E0E\u5206\u652F\u3011",
      ...identityLines,
      "",
      "\u3010\u5DE5\u4F5C\u533A\u73B0\u72B6\u3011",
      ...changesLines,
      "",
      "\u3010\u5176\u4ED6\u5DE5\u4F5C\u6811\u3011",
      ...worktreeLines,
      "",
      "\u3010\u672C\u5730\u5206\u652F\u3011",
      ...branchLines,
      "",
      "\u3010\u6700\u8FD1\u63D0\u4EA4\u3011",
      recentCommits.length === 0 ? "  \u6CA1\u6709\u8BFB\u5230\u63D0\u4EA4\u3002" : numbered(recentCommits),
      "",
      "\u3010\u6211\u770B\u5230\u7684\u73B0\u8C61\u3011",
      `  \u754C\u9762\u505C\u5728\uFF1A${focus}`,
      "  \uFF08\u5728\u8FD9\u91CC\u8865\u4E00\u53E5\uFF1A\u4F60\u6253\u5F00\u9762\u677F\u65F6\u60F3\u505A\u4EC0\u4E48\uFF0C\u6216\u8005\u770B\u5230\u54EA\u91CC\u4E0D\u5BF9\u52B2\u3002\u8FD9\u4E00\u53E5\u4E0D\u5199\uFF0C\u6A21\u578B\u53EA\u80FD\u4ECE\u4E0A\u9762\u7684\u72B6\u6001\u91CC\u731C\u3002\uFF09",
      "",
      "\u3010\u6211\u60F3\u505A\u4EC0\u4E48\u3011",
      `  \uFF08\u7528\u4E00\u4E24\u53E5\u8BDD\u8BF4\u6E05\u4F60\u60F3\u5F97\u5230\u7684\u7ED3\u679C\u3002\u53EF\u4EE5\u7167\u8FD9\u4E2A\u65B9\u5411\u5199\uFF1A${GOALS[kind]}\uFF09`,
      "",
      "\u3010\u8BF7\u4F60\u3011",
      "  1. \u5148\u7528\u4E09\u4E94\u53E5\u8BDD\u590D\u8FF0\u4F60\u7406\u89E3\u7684\u72B6\u6001\uFF0C\u5E76\u6307\u51FA\u6211\u53EF\u80FD\u8BEF\u89E3\u7684\u5730\u65B9\u3002",
      "  2. \u518D\u6309\u6B65\u9AA4\u7ED9\u51FA\u505A\u6CD5\uFF0C\u6BCF\u4E00\u6B65\u5199\u6E05\u695A\u4F1A\u6539\u52A8\u4EC0\u4E48\u3001\u4E0D\u4F1A\u6539\u52A8\u4EC0\u4E48\u3001\u600E\u4E48\u9A8C\u8BC1\u6210\u529F\u3002",
      "  3. \u78B0\u5230\u4E22\u5F03\u6539\u52A8\u3001\u8986\u76D6\u5DF2\u63A8\u9001\u7684\u5386\u53F2\u3001\u5F3A\u5236\u63A8\u9001\u4E4B\u524D\uFF0C\u5148\u505C\u4E0B\u6765\u95EE\u6211\u786E\u8BA4\u3002",
      "",
      "\u3010\u8865\u5145\u3011",
      "  \uFF08\u5982\u679C\u8FD8\u6709\u522B\u7684\u80CC\u666F\u6216\u9650\u5236\uFF0C\u5199\u5728\u8FD9\u91CC\u3002\uFF09"
    ].join("\n");
    return { title: TITLES[kind], lede: LEDES[kind], prompt, charCount: prompt.length };
  }
  var HANDOFF_ENTRY = {
    general: "\u4E0D\u60F3\u4EB2\u81EA\u5904\u7406\uFF1F\u4EA4\u7ED9 AI",
    changes: "\u62FF\u4E0D\u51C6\u600E\u4E48\u62C6\u63D0\u4EA4\uFF1F\u4EA4\u7ED9 AI",
    worktrees: "\u4E0D\u60F3\u81EA\u5DF1\u6392\u67E5\uFF1F\u4EA4\u7ED9 AI",
    branches: "\u5206\u652F\u5173\u7CFB\u592A\u4E71\uFF1F\u4EA4\u7ED9 AI \u7406\u6E05"
  };

  // docs/prototype/vc-redesign/src/data/patches.ts
  var TS_SAMPLE = [
    { kind: "filehead", text: "diff --git a/src/client/views/shared/workRouteTable.ts b/src/client/views/shared/workRouteTable.ts" },
    { kind: "hunk", text: "@@ -18,7 +18,7 @@ export const workRouteTableOf = function (rows) {" },
    { kind: "context", text: "  const table = new Map()" },
    { kind: "context", text: "  for (const row of rows) {" },
    { kind: "del", text: "-    table.set(row.key, row.ticket)" },
    { kind: "add", text: "+    table.set(row.key, row.ticket ?? row.fallback)" },
    { kind: "context", text: "  }" },
    { kind: "context", text: "  return table" },
    { kind: "context", text: "}" }
  ];
  var TS_SAMPLE_TWO = [
    { kind: "filehead", text: "diff --git a/src/refresh/rooms/host/outbound-admission.ts b/src/refresh/rooms/host/outbound-admission.ts" },
    { kind: "hunk", text: "@@ -41,6 +41,10 @@ export const admitOutbound = function (request) {" },
    { kind: "context", text: "  if (!request.sessionId) return { ok: false, reason: 'no-session' }" },
    { kind: "add", text: "+  if (request.retryOf) {" },
    { kind: "add", text: "+    traces.push({ kind: 'retry', id: request.retryOf })" },
    { kind: "add", text: "+  }" },
    { kind: "context", text: "  const admitted = checkQuota(request)" },
    { kind: "del", text: "-  return admitted ? allow(request) : deny(request)" },
    { kind: "add", text: "+  return admitted ? allow(request) : deny(request, { retryable: true })" }
  ];
  var MARKDOWN_SAMPLE = [
    { kind: "filehead", text: "diff --git a/docs/review/sample.md b/docs/review/sample.md" },
    { kind: "hunk", text: "@@ -1,4 +1,6 @@" },
    { kind: "context", text: "# \u8BC4\u5BA1\u8BB0\u5F55" },
    { kind: "add", text: "+## \u7ED3\u8BBA" },
    { kind: "add", text: "+\u4E24\u5904\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4\u7684\u8FB9\u754C\u5DF2\u7ECF\u5217\u5728\u4E0B\u9762\u3002" },
    { kind: "context", text: "" },
    { kind: "context", text: "## \u8BC1\u636E" }
  ];
  var PNG_SAMPLE = [
    { kind: "filehead", text: "Binary files a/docs/design/md-env-check-chain.png and b/docs/design/md-env-check-chain.png differ" },
    { kind: "no-newline", text: "\u539F\u578B\u4E0D\u6E32\u67D3\u4E8C\u8FDB\u5236\u5DEE\u5F02\u3002" }
  ];
  function samplePatch(path) {
    if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".tsx")) {
      return path.includes("outbound-admission") ? TS_SAMPLE_TWO : TS_SAMPLE;
    }
    if (path.endsWith(".md")) return MARKDOWN_SAMPLE;
    if (path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".webp")) return PNG_SAMPLE;
    return null;
  }

  // docs/prototype/vc-redesign/src/domain/select.ts
  function judgeScreen(base, state) {
    const screen = base.screen;
    return {
      ...screen,
      stagedCount: state.staged.length,
      unstagedCount: state.unstaged.length,
      conflictCount: state.conflicts.length,
      identity: {
        ...screen.identity,
        ahead: state.ahead,
        behind: state.behind,
        basisMs: state.basisMs
      }
    };
  }
  function verdictOf(screen, op) {
    const decision = judge(screen, op);
    if (decision.verdict === "block") {
      return { disabled: true, warn: false, reason: COPY.block[decision.reasons[0]] ?? COPY.block["unknown-operation"] };
    }
    if (decision.verdict === "warn") {
      return { disabled: false, warn: true, reason: COPY.warn[decision.reasons[0]] ?? null };
    }
    return { disabled: false, warn: false, reason: null };
  }
  function actionOf(screen, op, label, state, override = {}) {
    const verdict = verdictOf(screen, op);
    const disabled = override.disabled === true || verdict.disabled || state.busy !== null || state.reloading;
    const busy = state.busy === op || op === "fetch" && state.reloading;
    return {
      id: op,
      label,
      disabled,
      reason: override.reason ?? verdict.reason,
      warn: verdict.warn,
      primary: override.primary === true && !disabled,
      busy
    };
  }
  function tabsOf(base, state) {
    const changes = state.staged.length + state.unstaged.length + state.conflicts.length;
    return [
      { id: "changes", label: COPY.views.changes, count: changes, unit: COPY.units.change },
      { id: "commits", label: COPY.views.commits, count: base.totalCommits, unit: COPY.units.commit },
      { id: "worktrees", label: COPY.views.worktrees, count: base.screen.otherWorktrees.filter((item) => !item.current).length + (state.demoWorktrees ? DEMO_WORKTREE_COUNT : 0), unit: COPY.units.worktree },
      { id: "stash", label: COPY.views.stash, count: state.stashes.length, unit: COPY.units.stash, explain: "\u628A\u6682\u65F6\u4E0D\u60F3\u63D0\u4EA4\u7684\u6539\u52A8\u6253\u5305\u6536\u8D77\u6765\uFF0C\u4E4B\u540E\u80FD\u653E\u56DE\u5DE5\u4F5C\u533A" }
    ];
  }
  function nextStepOf(state) {
    if (state.conflicts.length > 0) return { text: "\u5148\u89E3\u51B3\u51B2\u7A81\u6587\u4EF6\uFF0C\u518D\u63D0\u4EA4", tone: "error" };
    if (state.behind > 0) return { text: "\u5148\u62C9\u53D6\u8FDC\u7AEF\u7684\u65B0\u63D0\u4EA4", tone: "warn" };
    if (state.staged.length > 0 && state.message.trim() === "") return { text: "\u5199\u4E00\u53E5\u63D0\u4EA4\u8BF4\u660E\uFF0C\u518D\u63D0\u4EA4", tone: "info" };
    if (state.staged.length > 0) return { text: "\u63D0\u4EA4\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u6587\u4EF6", tone: "ok" };
    if (state.unstaged.length > 0) return { text: "\u5148\u52A0\u5165\u8981\u63D0\u4EA4\u7684\u6587\u4EF6", tone: "muted" };
    if (state.ahead > 0) return { text: "\u63A8\u9001\u672C\u5730\u63D0\u4EA4\u5230\u8FDC\u7AEF", tone: "ok" };
    return { text: "\u5DE5\u4F5C\u533A\u4E0E\u8FDC\u7AEF\u90FD\u5DF2\u540C\u6B65", tone: "muted" };
  }
  function railOf(base, state, nowMs) {
    const identity = base.screen.identity;
    const currentBranch = state.branches.find((row) => row.current);
    const screen = judgeScreen(base, state);
    const sync = syncModel(identity.sync, state.ahead, state.behind);
    const syncChips = [];
    if (sync.kind === "counts") {
      syncChips.push({ kind: "ahead", label: COPY.rail.syncAhead, value: sync.ahead, muted: sync.ahead === 0 });
      syncChips.push({ kind: "behind", label: COPY.rail.syncBehind, value: sync.behind, muted: sync.behind === 0 });
    }
    const next = nextStepOf(state);
    const pullVerdict = verdictOf(screen, "pull");
    const pushAheadMissing = state.ahead === 0;
    const pull = actionOf(screen, "pull", COPY.actions.pull, state, {
      primary: state.behind > 0,
      busyLabel: COPY.busy.pull
    });
    const fetch = actionOf(screen, "fetch", COPY.actions.fetch, state, { busyLabel: COPY.busy.fetch });
    const push = actionOf(screen, "push", COPY.actions.push, state, {
      disabled: pushAheadMissing,
      reason: pushAheadMissing ? COPY.block["nothing-to-push"] : null,
      primary: !pushAheadMissing && state.behind === 0,
      busyLabel: COPY.busy.push
    });
    return {
      worktreeDisplay: identity.worktreeDisplay,
      worktreePath: identity.worktreePath,
      branch: currentBranch === void 0 ? identity.branch : currentBranch.name,
      detached: identity.detached,
      oidShort: identity.oid === null ? null : shortOid(identity.oid),
      sync,
      syncChips,
      readAtText: timeText(nowMs, state.readAtMs),
      // 上游写的是 <远端>/<分支>；只取第一段做标签，读者看到的是「远端 origin 12 分钟前」。
      remoteName: currentBranch === void 0 || currentBranch.upstream === null ? null : currentBranch.upstream.split("/")[0],
      basisText: state.basisMs === null ? COPY.rail.basisUnknown : timeText(nowMs, state.basisMs),
      next: next.text,
      nextTone: next.tone,
      pull: { ...pull, disabled: pullVerdict.disabled || pull.disabled },
      fetch,
      push,
      busy: state.busy,
      busyLabel: state.busy === null ? null : COPY.busy[state.busy],
      reloading: state.reloading,
      copiedPath: state.copiedPath
    };
  }
  function timeText(nowMs, ms) {
    const minutes = Math.max(0, Math.floor((nowMs - ms) / 6e4));
    if (minutes < 1) return "\u521A\u521A";
    if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    const date = new Date(ms);
    return `${date.getMonth() + 1} \u6708 ${date.getDate()} \u65E5`;
  }
  function fileRowOf(base, state, path, options) {
    const meta = metadataOf(base, path);
    const change = meta?.change ?? "modified";
    const badge = changeBadge(change);
    const { dir, name } = splitPath(path);
    const isUntracked = change === "untracked";
    const expanded = state.openFile === path;
    const patch = expanded && !isUntracked && !options.conflict ? samplePatch(path) : null;
    let patchNote = null;
    if (expanded) {
      if (options.conflict) patchNote = "\u51B2\u7A81\u6587\u4EF6\u5728\u5408\u5E76\u5B8C\u6210\u524D\u6CA1\u6709\u5355\u4E00\u57FA\u7EBF\uFF0C\u539F\u578B\u4E0D\u5C55\u793A\u5DEE\u5F02\u3002";
      else if (isUntracked) patchNote = "\u672A\u8DDF\u8E2A\u6587\u4EF6\u8FD8\u6CA1\u6709\u57FA\u7EBF\u7248\u672C\uFF0C\u539F\u578B\u4E0D\u5C55\u793A\u5DEE\u5F02\u3002";
      else if (patch === null) patchNote = "\u8FD9\u4E2A\u6269\u5C55\u540D\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u793A\u4F8B\u8865\u4E01\u3002";
    }
    const extraBadges = [];
    if (options.conflict) extraBadges.push("\u51B2\u7A81");
    else if (options.staged) extraBadges.push(COPY.changes.stagedBadge);
    if (isUntracked) extraBadges.push(COPY.changes.untracked);
    const busy = state.busy !== null || state.reloading;
    return {
      path,
      dir,
      name,
      fullPath: path,
      badge,
      changeLabel: null,
      extraBadges,
      delta: isUntracked ? null : lineDelta(meta?.addedLines ?? null, meta?.deletedLines ?? null),
      conflict: options.conflict,
      staged: options.staged,
      expanded,
      patch,
      patchNote,
      canStage: !busy && !options.conflict && !options.staged,
      canUnstage: !busy && !options.conflict && options.staged,
      untracked: isUntracked,
      showMenu: !busy && !options.staged,
      canDiscard: !busy && !options.conflict && !options.staged && !isUntracked,
      canIgnore: !busy && !options.conflict && !options.staged && isUntracked,
      canDeleteUntracked: !busy && !options.conflict && !options.staged && isUntracked,
      resolvable: !busy && options.conflict
    };
  }
  function pendingOf(base, state) {
    const pending = state.changesPending;
    if (pending === null) return null;
    if (state.busy !== null || state.reloading) return null;
    if (pending.kind === "discard-all") {
      return {
        kind: pending.kind,
        path: null,
        title: COPY.changes.confirmDiscardAllTitle(state.unstaged.length),
        body: COPY.changes.confirmDiscardAllBody,
        meta: COPY.changes.confirmDiscardAllMeta(state.unstaged.length),
        confirmLabel: COPY.changes.confirmDiscard,
        danger: true
      };
    }
    const path = pending.path;
    if (path === null) return null;
    const meta = metadataOf(base, path);
    const name = splitPath(path).name;
    const lines = [];
    if (meta !== void 0) {
      if (meta.addedLines !== null && meta.addedLines > 0) lines.push(`\u65B0\u589E ${meta.addedLines} \u884C`);
      if (meta.deletedLines !== null && meta.deletedLines > 0) lines.push(`\u5220\u9664 ${meta.deletedLines} \u884C`);
    }
    const metaText = lines.length === 0 ? null : `\u8FD9\u6B21\u4F1A\u4E22\u6389 ${lines.join("\uFF0C")}`;
    switch (pending.kind) {
      case "discard":
        return { kind: pending.kind, path, title: COPY.changes.confirmDiscardTitle(name), body: COPY.changes.confirmDiscardBody, meta: metaText, confirmLabel: COPY.changes.confirmDiscard, danger: true };
      case "ignore":
        return { kind: pending.kind, path, title: COPY.changes.confirmIgnoreTitle(name), body: COPY.changes.confirmIgnoreBody, meta: null, confirmLabel: COPY.changes.confirmIgnore, danger: false };
      case "delete-untracked":
        return { kind: pending.kind, path, title: COPY.changes.confirmDeleteTitle(name), body: COPY.changes.confirmDeleteBody, meta: null, confirmLabel: COPY.changes.confirmDelete, danger: true };
      case "resolve-ours":
        return { kind: pending.kind, path, title: COPY.changes.confirmResolveOursTitle(name), body: COPY.changes.confirmResolveOursBody, meta: null, confirmLabel: COPY.changes.confirmResolve, danger: true };
      case "resolve-theirs":
        return { kind: pending.kind, path, title: COPY.changes.confirmResolveTheirsTitle(name), body: COPY.changes.confirmResolveTheirsBody, meta: null, confirmLabel: COPY.changes.confirmResolve, danger: true };
      default:
        return null;
    }
  }
  function changesOf(base, state) {
    const screen = judgeScreen(base, state);
    const busy = state.busy !== null || state.reloading;
    const stagedRows = state.staged.map((path) => fileRowOf(base, state, path, { staged: true, conflict: false }));
    const unstagedRows = state.unstaged.map((path) => fileRowOf(base, state, path, { staged: false, conflict: false }));
    const conflictRows = state.conflicts.map((path) => fileRowOf(base, state, path, { staged: false, conflict: true }));
    const groups = [];
    if (state.changesFilter === "all" || state.changesFilter === "conflict") {
      groups.push({
        id: "conflict",
        label: COPY.changes.groupConflict,
        emptyText: COPY.changes.groupEmptyConflict,
        rows: conflictRows
      });
    }
    if (state.changesFilter === "all" || state.changesFilter === "staged") {
      groups.push({
        id: "staged",
        label: COPY.changes.groupStaged,
        emptyText: COPY.changes.groupEmptyStaged,
        rows: stagedRows
      });
    }
    if (state.changesFilter === "all" || state.changesFilter === "unstaged") {
      groups.push({
        id: "unstaged",
        label: COPY.changes.groupUnstaged,
        emptyText: COPY.changes.groupEmptyUnstaged,
        rows: unstagedRows
      });
    }
    const keepEmptyGroup = state.changesFilter !== "all";
    const visibleGroups = groups.filter((group) => {
      if (keepEmptyGroup) return true;
      if (group.id === "staged") return true;
      return group.rows.length > 0;
    });
    const commitVerdict = verdictOf(screen, "commit");
    let disabledReason = commitVerdict.reason;
    if (state.staged.length === 0) disabledReason = COPY.changes.commitNoStaged;
    else if (state.conflicts.length > 0) disabledReason = COPY.block["conflicts-unresolved"];
    else if (state.message.trim() === "") disabledReason = COPY.changes.commitNoMessage;
    const changeCount = state.staged.length + state.unstaged.length;
    return {
      stats: [
        { id: "conflict", label: COPY.changes.filterConflict, count: state.conflicts.length, tone: "error" },
        { id: "staged", label: COPY.changes.filterStaged, count: state.staged.length, tone: "ok" },
        { id: "unstaged", label: COPY.changes.filterUnstaged, count: state.unstaged.length, tone: "mod" }
      ],
      filter: state.changesFilter,
      groups: visibleGroups,
      empty: state.staged.length === 0 && state.unstaged.length === 0 && state.conflicts.length === 0,
      stagedCount: state.staged.length,
      unstagedCount: state.unstaged.length,
      conflictCount: state.conflicts.length,
      busy,
      canStageAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
      canUnstageAll: !busy && state.staged.length > 0,
      canDiscardAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
      canStash: !busy && state.conflicts.length === 0 && changeCount > 0,
      stashReason: state.conflicts.length > 0 ? COPY.block["conflicts-unresolved"] : null,
      openMenuPath: state.openMenuPath,
      pending: pendingOf(base, state),
      ignoredNote: state.ignored.length === 0 ? null : COPY.changes.ignoredNote(state.ignored.length),
      composer: {
        stagedCount: state.staged.length,
        message: state.message,
        placeholder: COPY.changes.messagePlaceholder,
        hint: COPY.changes.messageHint,
        disabled: busy || disabledReason !== null,
        disabledReason,
        busy: state.busy === "commit"
      }
    };
  }
  function dayGroupLabel(nowMs, ms) {
    const date = new Date(ms);
    const now = new Date(nowMs);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (dayStart === startOfToday) return COPY.history.groupToday;
    if (dayStart === startOfToday - 24 * 60 * 60 * 1e3) return COPY.history.groupYesterday;
    return COPY.history.groupDate(date.getMonth() + 1, date.getDate());
  }
  function historyEntries(base, state) {
    const local = state.localCommits.map((commit) => ({
      oid: commit.oid,
      short: commit.short,
      subject: commit.subject,
      author: commit.author,
      authorDateMs: commit.authorDateMs,
      parents: commit.parents,
      files: commit.files,
      local: true
    }));
    const total = historyTotal(base, state);
    const keep = Math.max(0, total - local.length);
    const captured = base.screen.commits.filter((commit) => commit.oid !== state.undoneOid).slice(0, keep).map((commit) => ({
      oid: commit.oid,
      short: commit.short,
      subject: commit.subject,
      author: commit.author,
      authorDateMs: commit.authorDateMs,
      parents: commit.parents,
      files: base.commitFiles.get(commit.oid) ?? [],
      local: false
    }));
    return [...local, ...captured];
  }
  function historyTotal(base, state) {
    return Math.max(0, base.totalCommits - (state.undoneOid === null ? 0 : 1));
  }
  function matchesQuery(entry, query) {
    if (query === "") return true;
    const needle = query.trim().toLowerCase();
    if (needle === "") return true;
    return entry.subject.toLowerCase().includes(needle) || entry.author.toLowerCase().includes(needle) || entry.short.toLowerCase().includes(needle);
  }
  function historyOf(base, state, nowMs) {
    const entries = historyEntries(base, state);
    const filtered = entries.filter((entry) => matchesQuery(entry, state.historyQuery) && (!state.historyMergeOnly || entry.parents.length > 1));
    let previousGroup = "";
    const rows = filtered.map((entry) => {
      const group = dayGroupLabel(nowMs, entry.authorDateMs);
      const groupLabel = group === previousGroup ? null : group;
      previousGroup = group;
      return {
        oid: entry.oid,
        short: entry.short,
        subject: entry.subject,
        author: entry.author,
        when: timeText(nowMs, entry.authorDateMs),
        merge: entry.parents.length > 1,
        filesCount: entry.files.length,
        group: groupLabel,
        selected: state.historyOpenOid === entry.oid
      };
    });
    let detail = null;
    if (state.historyOpenOid !== null) {
      const entry = entries.find((item) => item.oid === state.historyOpenOid);
      if (entry !== void 0) {
        const merge = entry.parents.length > 1;
        const files = entry.files.map((file) => {
          const { dir, name } = splitPath(file.path);
          const patch = samplePatch(file.path);
          return {
            path: file.path,
            dir,
            name,
            // 和改动视图共用同一套行数差规则：0 不显示（见 data/format.ts 的 lineDelta 注释）。
            delta: lineDelta(file.added, file.deleted),
            expanded: state.historyOpenFile === file.path,
            patch,
            binary: patch !== null && patch.every((line) => line.kind === "filehead" || line.kind === "no-newline")
          };
        });
        detail = {
          oid: entry.oid,
          short: entry.short,
          subject: entry.subject,
          author: entry.author,
          when: timeText(nowMs, entry.authorDateMs),
          parents: entry.parents.map(shortOid),
          files,
          filesNote: entry.files.length === 0 ? merge ? COPY.history.filesEmptyMerge : COPY.history.filesEmpty : null,
          loading: false
        };
      }
    }
    return {
      detail,
      rows,
      loaded: rows.length,
      total: historyTotal(base, state),
      query: state.historyQuery,
      mergeOnly: state.historyMergeOnly,
      empty: rows.length === 0,
      scopeText: COPY.history.loadedCount(rows.length, historyTotal(base, state)),
      mergeOnlyText: COPY.history.mergeOnly
    };
  }
  var DEMO_WORKTREE_COUNT = 2;
  function demoWorktreesOf(repoRoot) {
    const base = repoRoot.replace(/[\\\\/]+$/, "");
    return [
      {
        path: base + "/.worktrees/1600-locked-demo",
        display: "1600-locked-demo",
        head: "9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293",
        branch: "ticket/1600-locked-demo",
        bare: false,
        current: false,
        locked: true,
        lockReason: "\u53E6\u4E00\u4E2A\u7EC8\u7AEF\u6B63\u5728\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8DD1\u957F\u6D4B\u8BD5\uFF0Cgit \u7528 admin \u9501\u6321\u4F4F\u4E86\u5360\u7528",
        lockUnknown: false,
        prunable: false,
        prunableUnknown: false
      },
      {
        path: base + "/.worktrees/1502-gone-demo",
        display: "1502-gone-demo",
        head: "4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6",
        branch: "fix/1502-gone-demo",
        bare: false,
        current: false,
        locked: false,
        lockReason: null,
        lockUnknown: false,
        prunable: true,
        prunableUnknown: false
      }
    ];
  }
  function stateChipsOf(worktree) {
    const states = [];
    if (worktree.locked) states.push({ label: COPY.worktrees.locked, tone: "warn", detail: worktree.lockReason });
    if (worktree.prunable) states.push({ label: COPY.worktrees.prunable, tone: "error", detail: null });
    else if (worktree.prunableUnknown) states.push({ label: COPY.worktrees.prunableUnknown, tone: "warn", detail: "\u8FD9\u4E2A git \u7248\u672C\u7B54\u4E0D\u51FA\u76EE\u5F55\u8FD8\u5728\u4E0D\u5728\u3002" });
    if (worktree.lockUnknown) states.push({ label: COPY.worktrees.lockUnknown, tone: "warn", detail: "\u8FD9\u4E2A git \u7248\u672C\u7B54\u4E0D\u51FA\u9501\u5B9A\u72B6\u6001\u3002" });
    if (worktree.bare) states.push({ label: COPY.worktrees.bare, tone: "info", detail: "\u88F8\u4ED3\u5E93\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002" });
    if (worktree.branch === null && !worktree.bare) states.push({ label: COPY.worktrees.noBranch, tone: "muted", detail: null });
    const abnormal = states.some((state) => state.tone === "warn" || state.tone === "error");
    return { states, abnormal };
  }
  function worktreeRowOf(state, worktree) {
    const { dir, name } = splitPath(worktree.path);
    const chips = stateChipsOf(worktree);
    return {
      path: worktree.path,
      dir,
      name,
      branch: worktree.branch,
      detached: worktree.branch === null,
      oidShort: shortOid(worktree.head),
      states: chips.states,
      abnormal: chips.abnormal,
      copied: state.copiedPath === worktree.path,
      locked: worktree.locked,
      prunable: worktree.prunable
    };
  }
  function applyWorktreeActions(state, item) {
    const unlocked = state.unlockedWorktrees.includes(item.path);
    const pruned = state.prunedWorktrees.includes(item.path);
    if (!unlocked && !pruned) return item;
    return {
      ...item,
      locked: unlocked ? false : item.locked,
      lockReason: unlocked ? null : item.lockReason,
      prunable: pruned ? false : item.prunable
    };
  }
  function worktreesOf(base, state) {
    const identity = base.screen.identity;
    const current = identity.worktreePath === "" ? null : worktreeRowOf(state, {
      path: identity.worktreePath,
      display: identity.worktreeDisplay,
      head: identity.oid ?? "",
      branch: identity.branch,
      bare: false,
      current: true,
      locked: false,
      lockReason: null,
      lockUnknown: false,
      prunable: false,
      prunableUnknown: false
    });
    const demo = state.demoWorktrees ? demoWorktreesOf(identity.worktreePath) : [];
    const othersRaw = [...base.screen.otherWorktrees.filter((item) => !item.current), ...demo].filter((item) => !state.hiddenWorktrees.includes(item.path)).map((item) => applyWorktreeActions(state, item));
    const others = othersRaw.map((item) => worktreeRowOf(state, item)).sort((a, b) => Number(b.abnormal) - Number(a.abnormal));
    const abnormal = others.filter((row) => row.abnormal).length;
    return {
      current,
      others,
      othersCount: others.length,
      abnormalCount: abnormal,
      empty: others.length === 0,
      notice: COPY.worktrees.scope,
      aiLabel: COPY.worktrees.ai,
      aiEnabled: abnormal > 0,
      pending: state.worktreePending
    };
  }
  function branchRowOf(state, row, nowMs) {
    return {
      name: row.name,
      current: row.current,
      upstream: row.upstream,
      ahead: row.ahead,
      behind: row.behind,
      oidShort: row.oidShort,
      when: timeText(nowMs, row.lastCommitMs),
      subject: row.subject,
      merged: row.mergedIntoCurrent
    };
  }
  function branchesOf(base, state, nowMs) {
    const query = state.branchQuery.trim().toLowerCase();
    const rows = state.branches.filter((row) => query === "" || row.name.toLowerCase().includes(query)).map((row) => branchRowOf(state, row, nowMs));
    const current = state.branches.find((row) => row.current) ?? null;
    const selectedRaw = state.branchSelected === null ? null : state.branches.find((row) => row.name === state.branchSelected) ?? null;
    let selected = null;
    if (selectedRaw !== null) {
      const row = branchRowOf(state, selectedRaw, nowMs);
      const isCurrent = selectedRaw.current;
      selected = {
        row,
        canSwitch: !isCurrent,
        canMerge: !isCurrent,
        canDelete: !isCurrent,
        canRebase: !isCurrent,
        switchReason: isCurrent ? COPY.branches.switchCurrent : null,
        mergeReason: null,
        deleteReason: isCurrent ? COPY.branches.cannotDeleteCurrent : null,
        rebaseReason: isCurrent ? COPY.branches.rebaseCurrent : null,
        pending: state.branchPending
      };
    }
    return {
      rows,
      total: state.branches.length,
      currentName: current === null ? base.branch : current.name,
      selected,
      sub: state.branchSub,
      draft: state.branchDraft,
      query: state.branchQuery,
      pending: state.branchPending,
      empty: rows.length === 0,
      dirty: state.staged.length > 0 || state.unstaged.length > 0 || state.conflicts.length > 0
    };
  }
  function stashOf(state, nowMs) {
    const rows = state.stashes.map((entry) => ({
      id: entry.id,
      message: entry.message,
      when: timeText(nowMs, entry.whenMs),
      paths: entry.paths,
      filesCount: entry.paths.length
    }));
    const pending = state.stashPending === null ? null : {
      id: state.stashPending.id,
      title: COPY.stash.dropTitle(state.stashPending.id),
      body: COPY.stash.dropBody
    };
    return {
      rows,
      total: rows.length,
      empty: rows.length === 0,
      pending,
      busy: state.busy !== null
    };
  }
  function panelModelOf(base, state, nowMs) {
    const tabs = tabsOf(base, state);
    const confirm = state.confirmPull === null ? null : {
      title: COPY.rail.confirmTitle,
      lead: COPY.rail.confirmLead,
      points: COPY.rail.confirmPoints,
      files: state.confirmPull.files,
      continueLabel: COPY.rail.confirmContinue,
      cancelLabel: COPY.rail.confirmCancel
    };
    return {
      rail: railOf(base, state, nowMs),
      tabs,
      changes: changesOf(base, state),
      history: historyOf(base, state, nowMs),
      worktrees: worktreesOf(base, state),
      branches: branchesOf(base, state, nowMs),
      stash: stashOf(state, nowMs),
      result: state.result,
      confirm,
      busy: state.busy,
      nowMs
    };
  }

  // docs/prototype/vc-redesign/src/data/capabilities.generated.ts
  var CAPABILITIES = [
    {
      "id": "1.1",
      "domain": "1",
      "name": "\u770B\u5DE5\u4F5C\u533A\u72B6\u6001",
      "command": "git status `--porcelain=v2 --branch -z`",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u6539\u52A8\u9875\u4E09\u7EC4\uFF08\u5DF2\u52A0\u5165 / \u672A\u52A0\u5165 / \u51B2\u7A81\uFF09\u8BA1\u6570\u4E0E\u6587\u4EF6\u884C",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.2",
      "domain": "1",
      "name": "\u9010\u5757\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      "command": "git add `-p`\uFF08\u9762\u677F\u7B49\u4EF7\u4E8E\u8BFB diff \u540E `apply --cached`\uFF09",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5757\u884C\u6253\u52FE\uFF0C\u6587\u4EF6\u884C\u663E\u793A\u5269\u4F59\u5757\u6570",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.3",
      "domain": "1",
      "name": "\u628A\u5355\u4E2A\u6587\u4EF6\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      "command": "git add `-- <path>`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u6587\u4EF6\u884C\u79FB\u8FDB\u300C\u5DF2\u52A0\u5165\u300D\uFF0C\u63D0\u4EA4\u533A\u4EAE\u8D77",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.4",
      "domain": "1",
      "name": "\u5168\u90E8\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      "command": "git add `-A`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u7EC4\u5934\u8BA1\u6570\u66F4\u65B0",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.5",
      "domain": "1",
      "name": "\u628A\u6587\u4EF6\u79FB\u51FA\u8FD9\u6B21\u63D0\u4EA4",
      "command": "git restore `--staged -- <path>`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u6587\u4EF6\u884C\u56DE\u300C\u672A\u52A0\u5165\u300D\u7EC4",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.6",
      "domain": "1",
      "name": "\u4E22\u5F03\u5355\u4E2A\u6587\u4EF6\u7684\u672A\u52A0\u5165\u6539\u52A8",
      "command": "git restore `-- <path>`",
      "level": "\u6BC1",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u8BE5\u884C\u6D88\u5931\u3001\u8BA1\u6570\u51CF\u4E00",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.7",
      "domain": "1",
      "name": "\u4E22\u5F03\u5168\u90E8\u672A\u52A0\u5165\u6539\u52A8",
      "command": "git restore `-- .`",
      "level": "\u6BC1",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u7EC4\u5934",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.8",
      "domain": "1",
      "name": "\u5220\u9664\u672A\u8DDF\u8E2A\u6587\u4EF6",
      "command": "git clean `-fd -- <path>`",
      "level": "\u6BC1",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u884C\u6D88\u5931",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.9",
      "domain": "1",
      "name": "\u5220\u9664\u5DF2\u8DDF\u8E2A\u6587\u4EF6",
      "command": "git rm `-- <path>`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u6587\u4EF6\u884C\u8FDB\u300C\u5DF2\u52A0\u5165\uFF08\u5220\u9664\uFF09\u300D",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.10",
      "domain": "1",
      "name": "\u53EA\u505C\u6B62\u8DDF\u8E2A\u3001\u4FDD\u7559\u78C1\u76D8\u6587\u4EF6",
      "command": "git rm `--cached -- <path>`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C\u4E0A",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.11",
      "domain": "1",
      "name": "\u91CD\u547D\u540D\u6216\u79FB\u52A8",
      "command": "git mv `<old> <new>`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u884C\u6539\u540D\u5E76\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.12",
      "domain": "1",
      "name": "\u52A0\u8FDB\u5FFD\u7565\u6E05\u5355",
      "command": "gitignore + git check-ignore `-v`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u884C\u5185\u5C55\u5F00\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u6587\u4EF6\u884C\u79FB\u8FDB\u300C\u5DF2\u5FFD\u7565\u300D\u7EC4",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "1.13",
      "domain": "1",
      "name": "\u67E5\u8FD9\u6761\u8DEF\u5F84\u4E3A\u4EC0\u4E48\u88AB\u5FFD\u7565",
      "command": "git check-ignore `-v`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u6539\u52A8\u9875\u6587\u4EF6\u884C",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u6587\u4EF6\u884C\u4E0B\u4E00\u884C\u5C0F\u5B57\u300C\u88AB .gitignore \u7B2C 12 \u884C\u547D\u4E2D\u300D",
      "target": "changes",
      "readOnly": true
    },
    {
      "id": "2.1",
      "domain": "2",
      "name": "\u63D0\u4EA4\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u5185\u5BB9",
      "command": "git commit `-m`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u63D0\u4EA4\u533A\u6309\u94AE\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u63D0\u4EA4\u533A\u7ED3\u679C\u6761 + \u5386\u53F2\u5217\u8868\u9996\u884C",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "2.2",
      "domain": "2",
      "name": "\u63D0\u4EA4\u5168\u90E8\u5DF2\u8DDF\u8E2A\u6539\u52A8",
      "command": "git commit `-a -m`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 2.1",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "2.3",
      "domain": "2",
      "name": "\u4FEE\u8BA2\u4E0A\u4E00\u6761\u63D0\u4EA4",
      "command": "git commit `--amend`\uFF08\u53EF\u53EA\u6539\u8BF4\u660E\uFF09",
      "level": "\u6539\u5199",
      "placement": "\u76F4",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u63D0\u4EA4\u533A\u6309\u94AE\u3001\u884C\u83DC\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u63D0\u4EA4\u533A\u4E0E\u5386\u53F2\u9996\u884C\u539F\u5730\u66FF\u6362",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "2.4",
      "domain": "2",
      "name": "\u751F\u6210 fixup / squash \u63D0\u4EA4",
      "command": "git commit `--fixup` / `--squash`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u884C\u6807 fixup / squash\uFF0C\u7B49\u4E0B\u4E00\u6B21 `rebase --autosquash` \u5438\u6536",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "2.5",
      "domain": "2",
      "name": "\u8DF3\u8FC7\u63D0\u4EA4\u94A9\u5B50",
      "command": "git commit `--no-verify`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u7ED3\u679C\u6761\u6807\u300C\u5DF2\u8DF3\u8FC7\u94A9\u5B50\u300D",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "2.6",
      "domain": "2",
      "name": "\u7B7E\u540D\u63D0\u4EA4 / \u8FFD\u52A0\u7B7E\u540D\u884C",
      "command": "git commit `-S` / `-s`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u884C\u663E\u793A\u300C\u5DF2\u7B7E\u540D\u300D",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "2.7",
      "domain": "2",
      "name": "\u7528\u7F16\u8F91\u5668\u5199\u5B8C\u6574\u8BF4\u660E",
      "command": "git commit\uFF08\u4E0D\u5E26 `-m`\uFF09",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u9762\u677F\u53EA\u7ED9\u6807\u9898 + \u6B63\u6587\u4E24\u680F\uFF0C\u63D0\u4EA4\u6A21\u677F\u4E0E\u6CE8\u91CA\u9884\u586B",
      "target": "changes",
      "readOnly": true
    },
    {
      "id": "2.8",
      "domain": "2",
      "name": "\u5957\u7528\u63D0\u4EA4\u8BF4\u660E\u6A21\u677F",
      "command": "git commit \u7684 `commit.template`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u6539\u52A8\u9875\u63D0\u4EA4\u533A\u4E0E\u63D0\u4EA4\u5386\u53F2\u884C\u83DC\u5355",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8BF4\u660E\u680F\u9884\u586B\u6A21\u677F\u5185\u5BB9",
      "target": "changes",
      "readOnly": false
    },
    {
      "id": "3.1",
      "domain": "3",
      "name": "\u63D0\u4EA4\u5217\u8868",
      "command": "git log",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u5217\u8868\u3001\u8BE6\u60C5\u3001\u4E8C\u7EA7\u9875\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u5386\u53F2\u5217\u8868\uFF0C\u9996\u5217\u77ED\u53F7\u3001\u8BF4\u660E\u9996\u884C\u3001\u4F5C\u8005\u4E0E\u65F6\u95F4",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.2",
      "domain": "3",
      "name": "\u5355\u6761\u63D0\u4EA4\u8BE6\u60C5",
      "command": "git show",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u5217\u8868\u3001\u8BE6\u60C5\u3001\u4E8C\u7EA7\u9875\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u5386\u53F2\u5217\u8868\u4E0B\u65B9\u7684\u8BE6\u60C5\u533A\uFF08\u6574\u9875\u66FF\u6362\u6216\u4FA7\u6ED1\uFF09",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.3",
      "domain": "3",
      "name": "\u63D0\u4EA4\u5185\u9010\u6587\u4EF6\u5DEE\u5F02",
      "command": "git show `<oid> -- <path>`\uFF08\u6839\u63D0\u4EA4\u52A0 `--root`\uFF09",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8BE6\u60C5\u533A\u91CC\u7684 diff\uFF0C\u6309\u6587\u4EF6\u6298\u53E0",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.4",
      "domain": "3",
      "name": "\u5355\u6587\u4EF6\u5386\u53F2",
      "command": "git log `--follow -- <path>`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u5217\u8868\u8FC7\u6EE4\u6210\u8BE5\u6587\u4EF6\uFF0C\u884C\u9996\u6807\u91CD\u547D\u540D",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.5",
      "domain": "3",
      "name": "\u884C\u7EA7\u8FFD\u6EAF",
      "command": "git blame `-L`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u6216\u4E8C\u7EA7\u9875\uFF0C\u884C\u53F7 + \u77ED\u53F7 + \u4F5C\u8005",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "3.6",
      "domain": "3",
      "name": "\u6309\u8BF4\u660E\u641C\u63D0\u4EA4",
      "command": "git log `--grep -i`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u5217\u8868\u5E26\u641C\u7D22\u6846\uFF0C\u547D\u4E2D\u9AD8\u4EAE",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.7",
      "domain": "3",
      "name": "\u6309\u4EE3\u7801\u53D8\u5316\u641C\u63D0\u4EA4",
      "command": "git log `-S` / `-G`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u5217\u8868\uFF0C\u547D\u4E2D\u884C\u6807\u300C\u65B0\u589E/\u5220\u9664\u4E86\u8FD9\u6BB5\u6587\u5B57\u300D",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.8",
      "domain": "3",
      "name": "\u6BD4\u8F83\u4E24\u4E2A\u5F15\u7528",
      "command": "git diff `a..b` / `a...b`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u4E8C\u7EA7\u9875\u7684 diff",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.9",
      "domain": "3",
      "name": "\u4E24\u7EC4\u63D0\u4EA4\u5BF9\u7167",
      "command": "git range-diff",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\uFF0C\u6309\u300C\u5DF2\u88AB\u6539\u5199 / \u65B0\u589E / \u5220\u9664\u300D\u5206\u7EC4",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "3.10",
      "domain": "3",
      "name": "\u7248\u672C\u540D",
      "command": "git describe `--tags --dirty --always`",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u5217\u8868\u3001\u8BE6\u60C5\u3001\u4E8C\u7EA7\u9875\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u9876\u90E8\u8EAB\u4EFD\u6761\uFF0C`v1.2.3-4-gabc1234` \u6216 `abc1234`",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.11",
      "domain": "3",
      "name": "\u5F15\u7528\u65E5\u5FD7",
      "command": "git reflog `show`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\uFF0C\u9010\u884C\u5217\u51FA HEAD \u4E0E\u5206\u652F\u7684\u79FB\u52A8",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "3.12",
      "domain": "3",
      "name": "\u63D0\u4EA4\u5907\u6CE8",
      "command": "git notes `show`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8BE6\u60C5\u533A\u591A\u4E00\u6BB5\u300C\u5907\u6CE8\u300D",
      "target": "commits",
      "readOnly": false
    },
    {
      "id": "3.13",
      "domain": "3",
      "name": "\u53D6\u67D0\u7248\u672C\u7684\u6587\u4EF6\u5185\u5BB9",
      "command": "git show `<rev>:<path>`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u63D0\u4EA4\u5386\u53F2\u5217\u8868\u3001\u63D0\u4EA4\u8BE6\u60C5\u4E0E\u5168\u5E93\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u4E8C\u7EA7\u9875\u53EA\u8BFB\u6587\u672C\uFF0C\u8D85\u957F\u622A\u65AD\u5E76\u63D0\u793A",
      "target": "commits",
      "readOnly": true
    },
    {
      "id": "4.1",
      "domain": "4",
      "name": "\u5206\u652F\u5217\u8868",
      "command": "git branch `-vv` / git for-each-ref",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u5206\u652F\u6D6E\u5C42\u3001\u6807\u7B7E\u6298\u53E0\u533A\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u652F\u6D6E\u5C42\uFF0C\u6BCF\u884C\u5E26\u4E0A\u6E38\u4E0E\u9886\u5148/\u843D\u540E\u6570",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.2",
      "domain": "4",
      "name": "\u65B0\u5EFA\u5E76\u5207\u6362",
      "command": "git switch `-c`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u5206\u652F\u6D6E\u5C42\u3001\u6807\u7B7E\u6298\u53E0\u533A\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u652F\u6D6E\u5C42\u65B0\u884C + \u9876\u90E8\u8EAB\u4EFD\u6761\u5207\u6362",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.3",
      "domain": "4",
      "name": "\u5207\u6362\u5206\u652F",
      "command": "git switch",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u5206\u652F\u6D6E\u5C42\u3001\u6807\u7B7E\u6298\u53E0\u533A\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u9876\u90E8\u8EAB\u4EFD\u6761 + \u6539\u52A8\u9875\u6574\u4F53\u5237\u65B0",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.4",
      "domain": "4",
      "name": "\u5207\u5230\u67D0\u63D0\u4EA4\uFF08\u5206\u79BB\u5934\u6307\u9488\uFF09",
      "command": "git switch `--detach`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u9876\u90E8\u8EAB\u4EFD\u6761\u663E\u793A\u77ED\u53F7 + \u300C\u5206\u79BB\u300D",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.5",
      "domain": "4",
      "name": "\u91CD\u547D\u540D\u5206\u652F",
      "command": "git branch `-m`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u5206\u652F\u6D6E\u5C42\u3001\u6807\u7B7E\u6298\u53E0\u533A\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u652F\u6D6E\u5C42\u884C\u539F\u5730\u6539\u540D",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.6",
      "domain": "4",
      "name": "\u5220\u9664\u5206\u652F",
      "command": "git branch `-d` / `-D`",
      "level": "\u6539\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u5206\u652F\u6D6E\u5C42\u3001\u6807\u7B7E\u6298\u53E0\u533A\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u652F\u6D6E\u5C42\u884C\u6D88\u5931",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.7",
      "domain": "4",
      "name": "\u8BBE\u7F6E\u6216\u53D6\u6D88\u4E0A\u6E38",
      "command": "git branch `-u` / `--unset-upstream`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u5206\u652F\u6D6E\u5C42\u3001\u6807\u7B7E\u6298\u53E0\u533A\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5206\u652F\u884C\u663E\u793A `origin/main` \u4E0E\u9886\u5148/\u843D\u540E",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.8",
      "domain": "4",
      "name": "\u54EA\u4E9B\u5206\u652F\u5DF2\u5E76\u5165",
      "command": "git branch `--merged` / `--no-merged`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u5206\u652F\u6D6E\u5C42\u91CC\u7ED9\u5DF2\u5E76\u5165\u7684\u52A0\u300C\u53EF\u5B89\u5168\u5220\u9664\u300D\u6807\u8BB0",
      "target": "branch-tags",
      "readOnly": true
    },
    {
      "id": "4.9",
      "domain": "4",
      "name": "\u6807\u7B7E\u5217\u8868",
      "command": "git tag `-l`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u300C\u6807\u7B7E\u300D\uFF0C\u9644\u6CE8\u6807\u7B7E\u663E\u793A\u8BF4\u660E\u9996\u884C",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.10",
      "domain": "4",
      "name": "\u5EFA\u6807\u7B7E",
      "command": "git tag\uFF08\u8F7B\u91CF\uFF09/ `-a`\uFF08\u9644\u6CE8\uFF09/ `-s`\uFF08\u7B7E\u540D\uFF09",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u65B0\u884C + \u5386\u53F2\u5217\u8868\u8BE5\u63D0\u4EA4\u65C1\u51FA\u73B0\u6807\u7B7E",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.11",
      "domain": "4",
      "name": "\u5220\u6807\u7B7E",
      "command": "git tag `-d`",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u884C\u6D88\u5931",
      "target": "branch-tags",
      "readOnly": false
    },
    {
      "id": "4.12",
      "domain": "4",
      "name": "\u9A8C\u7B7E",
      "command": "git verify-commit / git verify-tag",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u5386\u53F2\u884C\u6216\u6807\u7B7E\u884C\u663E\u793A\u300C\u7B7E\u540D\u6709\u6548 / \u65E0\u6CD5\u9A8C\u8BC1 / \u6CA1\u6709\u516C\u94A5\u300D",
      "target": "branch-tags",
      "readOnly": true
    },
    {
      "id": "4.13",
      "domain": "4",
      "name": "\u5206\u652F\u8BF4\u660E",
      "command": "git branch `--edit-description`",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u9876\u90E8\u8EAB\u4EFD\u884C\u5206\u652F\u6309\u94AE\u4E0E\u7BA1\u7406\u9875\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u8BFB\u663E\u793A\u73B0\u6709\u7684 `branch.<name>.description`",
      "target": "branch-tags",
      "readOnly": true
    },
    {
      "id": "5.1",
      "domain": "5",
      "name": "\u64A4\u9500\u4E0A\u4E00\u6761\u63D0\u4EA4\u3001\u6539\u52A8\u56DE\u5230\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D",
      "command": "git reset `--soft HEAD~1`",
      "level": "\u6539\u5199",
      "placement": "\u76F4",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u884C\u83DC\u5355\u3001\u6574\u9875\u5F85\u529E\u6E05\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5386\u53F2\u5217\u8868\u9996\u884C\u6D88\u5931 + \u63D0\u4EA4\u533A\u51FA\u73B0\u6539\u52A8",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.2",
      "domain": "5",
      "name": "\u64A4\u9500\u63D0\u4EA4\u5E76\u628A\u6539\u52A8\u79FB\u51FA\u8FD9\u6B21\u63D0\u4EA4",
      "command": "git reset `HEAD~1`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u9996\u884C\u6D88\u5931 + \u6539\u52A8\u9875",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.3",
      "domain": "5",
      "name": "\u786C\u91CD\u7F6E\u5230\u67D0\u63D0\u4EA4",
      "command": "git reset `--hard`",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6574\u9875\u5237\u65B0",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.4",
      "domain": "5",
      "name": "\u53CD\u5411\u63D0\u4EA4",
      "command": "git revert",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u884C\u83DC\u5355\u3001\u6574\u9875\u5F85\u529E\u6E05\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5386\u53F2\u5217\u8868\u65B0\u884C\uFF0C\u8BF4\u660E\u4EE5 `Revert` \u5F00\u5934",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.5",
      "domain": "5",
      "name": "\u62E3\u9009\u63D0\u4EA4",
      "command": "git cherry-pick",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u884C\u83DC\u5355\u3001\u6574\u9875\u5F85\u529E\u6E05\u5355\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5386\u53F2\u5217\u8868\u65B0\u884C\u3002\u51B2\u7A81\u5219\u5207\u5230\u51B2\u7A81\u5411\u5BFC",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.6",
      "domain": "5",
      "name": "\u4EA4\u4E92\u5F0F\u53D8\u57FA\uFF08\u6700\u5C0F\u96C6\uFF1A\u6539\u8BF4\u660E\u3001\u538B\u7F29\u3001\u4E22\u5F03\u3001\u91CD\u6392\uFF09",
      "command": "git rebase `-i`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u5217\u8868\u6574\u6BB5\u66FF\u6362",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.7",
      "domain": "5",
      "name": "\u6362\u57FA\u5EA7",
      "command": "git rebase `--onto`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 5.6",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.8",
      "domain": "5",
      "name": "\u81EA\u52A8\u5438\u6536 fixup / squash",
      "command": "git rebase `-i --autosquash`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5386\u53F2\u5217\u8868\u884C\u6570\u51CF\u5C11",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.9",
      "domain": "5",
      "name": "\u540C\u6B65\u5176\u4ED6\u5206\u652F\u6307\u9488",
      "command": "git rebase `--update-refs`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5206\u652F\u6D6E\u5C42\u591A\u5904\u6307\u9488\u53D8\u5316",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.10",
      "domain": "5",
      "name": "\u4FDD\u7559\u5408\u5E76\u7ED3\u6784",
      "command": "git rebase `--rebase-merges`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 5.6",
      "target": "rebase",
      "readOnly": false
    },
    {
      "id": "5.11",
      "domain": "5",
      "name": "\u6279\u91CF\u91CD\u5199\u5386\u53F2",
      "command": "git filter-branch",
      "level": "\u6BC1",
      "placement": "\u5916",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u8BFB\u663E\u793A\u300C\u672C\u4ED3\u5E93\u5386\u53F2\u5F88\u5927\uFF0C\u9700\u8981\u91CD\u5199\u8BF7\u7528\u4E13\u7528\u5DE5\u5177\u300D",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "5.12",
      "domain": "5",
      "name": "\u66FF\u6362\u5BF9\u8C61",
      "command": "git replace",
      "level": "\u6539\u5199",
      "placement": "\u5916",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u66FF\u6362\u53EA\u5F71\u54CD\u672C\u5730\u8BFB\u53D6\uFF0C\u63A8\u9001\u4E0D\u5E26\u8D70\u3002\u9762\u677F\u53EA\u8BFB\u663E\u793A\u73B0\u6709\u66FF\u6362",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "5.13",
      "domain": "5",
      "name": "\u5BFC\u51FA / \u5BFC\u5165\u5386\u53F2",
      "command": "git fast-export / git fast-import",
      "level": "\u6BC1",
      "placement": "\u5916",
      "entry": "\u63D0\u4EA4\u884C\u83DC\u5355\u4E0E\u300C\u53D8\u57FA\u5F85\u529E\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u8BFB\u663E\u793A\u300C\u5BFC\u51FA\u7528 git bundle\uFF0C\u89C1 11.13\u300D",
      "target": "migrate",
      "readOnly": true
    },
    {
      "id": "6.1",
      "domain": "6",
      "name": "\u5408\u5E76\u5206\u652F",
      "command": "git merge",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u5185\u8054\u786E\u8BA4\u5361\u3001\u6574\u9875\u5411\u5BFC\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u5386\u53F2\u5217\u8868\u65B0\u884C + \u9876\u90E8\u540C\u6B65\u5E26",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.2",
      "domain": "6",
      "name": "\u53EA\u63A5\u53D7\u76F4\u63A5\u66F4\u65B0",
      "command": "git merge `--ff-only`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u5185\u8054\u786E\u8BA4\u5361\u3001\u6574\u9875\u5411\u5BFC\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u540C 6.1",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.3",
      "domain": "6",
      "name": "\u603B\u662F\u751F\u6210\u5408\u5E76\u63D0\u4EA4",
      "command": "git merge `--no-ff`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 6.1",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.4",
      "domain": "6",
      "name": "\u538B\u7F29\u5408\u5E76",
      "command": "git merge `--squash`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6539\u52A8\u9875\u51FA\u73B0\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u6539\u52A8",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.5",
      "domain": "6",
      "name": "\u51B2\u7A81\u6587\u4EF6\u6E05\u5355",
      "command": "git status / git diff `--diff-filter=U`",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u5185\u8054\u786E\u8BA4\u5361\u3001\u6574\u9875\u5411\u5BFC\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u6539\u52A8\u9875\u300C\u51B2\u7A81\u300D\u7EC4\uFF0C\u9010\u6587\u4EF6\u6807\u300C\u4E24\u8FB9\u90FD\u6539 / \u4E00\u8FB9\u5220\u4E86\u4E00\u8FB9\u6539\u300D",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.6",
      "domain": "6",
      "name": "\u6574\u6587\u4EF6\u9009\u4E00\u8FB9",
      "command": "git checkout `--ours` / `--theirs`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6587\u4EF6\u884C\u53D8\u300C\u5DF2\u89E3\u51B3\u300D",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.7",
      "domain": "6",
      "name": "\u624B\u5DE5\u7F16\u8F91\u51B2\u7A81",
      "command": "\u5916\u90E8\u7F16\u8F91\u5668",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u6587\u4EF6\u884C\u7ED9\u300C\u5728\u7F16\u8F91\u5668\u91CC\u6253\u5F00\u300D\uFF0C\u4EBA\u56DE\u6765\u540E\u7528\u72B6\u6001\u5237\u65B0",
      "target": "conflicts",
      "readOnly": true
    },
    {
      "id": "6.8",
      "domain": "6",
      "name": "\u6807\u8BB0\u5DF2\u89E3\u51B3",
      "command": "git add `-- <path>`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u5185\u8054\u786E\u8BA4\u5361\u3001\u6574\u9875\u5411\u5BFC\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u51B2\u7A81\u7EC4\u8BA1\u6570\u51CF\u4E00",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.9",
      "domain": "6",
      "name": "\u5916\u90E8\u5408\u5E76\u5DE5\u5177",
      "command": "git mergetool",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u663E\u793A\u300C\u5DF2\u914D\u7F6E\u54EA\u4E2A\u5DE5\u5177\u300D",
      "target": "conflicts",
      "readOnly": true
    },
    {
      "id": "6.10",
      "domain": "6",
      "name": "\u9884\u6F14\u5408\u5E76",
      "command": "git merge-tree `--write-tree`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u300C\u80FD\u5E72\u51C0\u5408\u5E76 / \u6709 N \u4E2A\u6587\u4EF6\u51B2\u7A81\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "6.11",
      "domain": "6",
      "name": "\u7EE7\u7EED",
      "command": "`--continue`\uFF08merge / rebase / cherry-pick / revert / am \u5171\u7528\uFF09",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u5185\u8054\u786E\u8BA4\u5361\u3001\u6574\u9875\u5411\u5BFC\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u51B2\u7A81\u5411\u5BFC\u6536\u8D77 + \u5386\u53F2\u4E0E\u5206\u652F\u66F4\u65B0",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.12",
      "domain": "6",
      "name": "\u8DF3\u8FC7\u8FD9\u4E00\u6B65",
      "command": "`--skip`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5F85\u529E\u5C11\u4E00\u6B65",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.13",
      "domain": "6",
      "name": "\u4E2D\u6B62",
      "command": "`--abort`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u5185\u8054\u786E\u8BA4\u5361\u3001\u6574\u9875\u5411\u5BFC\u6216\u53EA\u8BFB\u8BCA\u65AD",
      "result": "\u6574\u9875\u5237\u65B0",
      "target": "conflicts",
      "readOnly": false
    },
    {
      "id": "6.14",
      "domain": "6",
      "name": "\u590D\u7528\u51B2\u7A81\u89E3\u6CD5",
      "command": "git rerere",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u300C\u8FD9\u4E2A\u51B2\u7A81\u4E0A\u6B21\u662F\u8FD9\u4E48\u89E3\u7684\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "6.15",
      "domain": "6",
      "name": "\u63D0\u4EA4\u524D\u67E5\u6B8B\u7559\u6807\u8BB0",
      "command": "git diff `--check`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u5206\u652F\u6D6E\u5C42\u4E0E\u300C\u51B2\u7A81\u5411\u5BFC\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u6587\u4EF6\u884C\u6807\u300C\u7B2C N \u884C\u8FD8\u6709\u51B2\u7A81\u6807\u8BB0\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "7.1",
      "domain": "7",
      "name": "\u628A\u5F53\u524D\u6539\u52A8\u6536\u8D77\u6765",
      "command": "git stash `push -m`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u884C\u5185\u52A8\u4F5C\u6216\u8D34\u884C\u786E\u8BA4\u5361",
      "result": "\u6536\u8D77\u8BB0\u5F55\u884C\u65B0\u589E + \u6539\u52A8\u9875\u6E05\u7A7A",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.2",
      "domain": "7",
      "name": "\u8FDE\u672A\u8DDF\u8E2A\u6587\u4EF6\u4E00\u8D77\u6536\u8D77\u6765",
      "command": "git stash `push -u`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 7.1",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.3",
      "domain": "7",
      "name": "\u53EA\u6536\u8D77\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u7684\u6539\u52A8",
      "command": "git stash `push --staged`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6536\u8D77\u8BB0\u5F55\u884C + \u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u7684\u6E05\u5355\u6E05\u7A7A",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.4",
      "domain": "7",
      "name": "\u5217\u51FA",
      "command": "git stash `list`",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u884C\u5185\u52A8\u4F5C\u6216\u8D34\u884C\u786E\u8BA4\u5361",
      "result": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875 / \u6298\u53E0\u533A\uFF0C\u6BCF\u6761\u5E26\u8BF4\u660E\u9996\u884C",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.5",
      "domain": "7",
      "name": "\u770B\u5185\u5BB9",
      "command": "git stash `show -p`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6536\u8D77\u8BB0\u5F55\u884C\u5C55\u5F00\u7684 diff",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.6",
      "domain": "7",
      "name": "\u653E\u56DE\u5DE5\u4F5C\u533A\u5E76\u4FDD\u7559\u8BB0\u5F55",
      "command": "git stash `apply`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u884C\u5185\u52A8\u4F5C\u6216\u8D34\u884C\u786E\u8BA4\u5361",
      "result": "\u6539\u52A8\u9875\u51FA\u73B0\u6539\u52A8 + \u6536\u8D77\u8BB0\u5F55\u884C\u4ECD\u5728",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.7",
      "domain": "7",
      "name": "\u653E\u56DE\u5DE5\u4F5C\u533A\u5E76\u5220\u6389\u8BB0\u5F55",
      "command": "git stash `pop`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u884C\u5185\u52A8\u4F5C\u6216\u8D34\u884C\u786E\u8BA4\u5361",
      "result": "\u6539\u52A8\u9875 + \u6536\u8D77\u8BB0\u5F55\u884C\u6D88\u5931",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.8",
      "domain": "7",
      "name": "\u4ECE\u6536\u8D77\u7684\u6539\u52A8\u5EFA\u5206\u652F",
      "command": "git stash `branch`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5206\u652F\u6D6E\u5C42\u65B0\u884C + \u6539\u52A8\u9875 + \u6536\u8D77\u8BB0\u5F55\u884C\u6D88\u5931",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.9",
      "domain": "7",
      "name": "\u5220\u8BB0\u5F55",
      "command": "git stash `drop`",
      "level": "\u6BC1",
      "placement": "\u76F4",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u884C\u5185\u52A8\u4F5C\u6216\u8D34\u884C\u786E\u8BA4\u5361",
      "result": "\u884C\u6D88\u5931",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "7.10",
      "domain": "7",
      "name": "\u5168\u6E05",
      "command": "git stash `clear`",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u300C\u6536\u8D77\u7684\u6539\u52A8\u300D\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6536\u8D77\u6E05\u5355\u4E3A\u7A7A",
      "target": "stash",
      "readOnly": false
    },
    {
      "id": "8.1",
      "domain": "8",
      "name": "\u8FDC\u7AEF\u5217\u8868",
      "command": "git remote `-v`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u300C\u8FDC\u7AEF\u300D\uFF0C\u540D\u5B57 + \u6293\u53D6\u5730\u5740 + \u63A8\u9001\u5730\u5740",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.2",
      "domain": "8",
      "name": "\u65B0\u589E / \u6539\u540D / \u5220\u9664\u8FDC\u7AEF",
      "command": "git remote `add` / `rename` / `remove`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u884C\u53D8\u5316",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.3",
      "domain": "8",
      "name": "\u6539\u5730\u5740",
      "command": "git remote `set-url`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u884C\u66F4\u65B0",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.4",
      "domain": "8",
      "name": "\u770B\u8FDC\u7AEF\u5206\u652F\u4E0E\u6807\u7B7E",
      "command": "git ls-remote / git branch `-r`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5206\u652F\u6D6E\u5C42\u7684\u8FDC\u7AEF\u7EC4 / \u6298\u53E0\u533A\u6807\u7B7E",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.5",
      "domain": "8",
      "name": "\u6293\u53D6",
      "command": "git fetch `[--all] [--prune] [--tags]`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u540C\u6B65\u5E26\u6309\u94AE\u3001\u4E8C\u7EA7\u9875\u6216\u6298\u53E0\u533A",
      "result": "\u9876\u90E8\u540C\u6B65\u5E26 + \u5206\u652F\u6D6E\u5C42\u9886\u5148/\u843D\u540E",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.6",
      "domain": "8",
      "name": "\u62C9\u53D6\u5E76\u5408\u5E76",
      "command": "git pull",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u540C\u6B65\u5E26\u6309\u94AE\u3001\u4E8C\u7EA7\u9875\u6216\u6298\u53E0\u533A",
      "result": "\u9876\u90E8\u540C\u6B65\u5E26 + \u5386\u53F2\u5217\u8868",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.7",
      "domain": "8",
      "name": "\u62C9\u53D6\u5E76\u53D8\u57FA",
      "command": "git pull `--rebase`",
      "level": "\u6539\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 8.6",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.8",
      "domain": "8",
      "name": "\u53EA\u63A5\u53D7\u76F4\u63A5\u66F4\u65B0",
      "command": "git pull `--ff-only`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u540C\u6B65\u5E26\u6309\u94AE\u3001\u4E8C\u7EA7\u9875\u6216\u6298\u53E0\u533A",
      "result": "\u540C 8.6",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.9",
      "domain": "8",
      "name": "\u63A8\u9001\u5F53\u524D\u5206\u652F",
      "command": "git push",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u540C\u6B65\u5E26\u6309\u94AE\u3001\u4E8C\u7EA7\u9875\u6216\u6298\u53E0\u533A",
      "result": "\u9876\u90E8\u540C\u6B65\u5E26\u300C\u5DF2\u540C\u6B65\u300D",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.10",
      "domain": "8",
      "name": "\u9996\u6B21\u63A8\u9001\u5E76\u8BBE\u4E0A\u6E38",
      "command": "git push `-u`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u540C\u6B65\u5E26\u6309\u94AE\u3001\u4E8C\u7EA7\u9875\u6216\u6298\u53E0\u533A",
      "result": "\u5206\u652F\u884C\u51FA\u73B0\u4E0A\u6E38",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.11",
      "domain": "8",
      "name": "\u5220\u8FDC\u7AEF\u5206\u652F / \u6807\u7B7E",
      "command": "git push `--delete`",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5206\u652F\u6D6E\u5C42\u8FDC\u7AEF\u7EC4\u884C\u6D88\u5931",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.12",
      "domain": "8",
      "name": "\u5F3A\u63A8\uFF08\u5E26\u79DF\u7EA6\uFF09",
      "command": "git push `--force-with-lease`",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u9876\u90E8\u540C\u6B65\u5E26 + \u5386\u53F2\u5217\u8868\u6574\u6BB5\u53D8\u5316",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.13",
      "domain": "8",
      "name": "\u539F\u5B50\u63A8\u9001",
      "command": "git push `--atomic`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 8.9",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.14",
      "domain": "8",
      "name": "\u63A8\u9001\u6807\u7B7E",
      "command": "git push `--follow-tags` / `--tags`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u6807\u7B7E\u884C\u6807\u300C\u5DF2\u63A8\u9001\u300D",
      "target": "remote",
      "readOnly": false
    },
    {
      "id": "8.15",
      "domain": "8",
      "name": "\u8BA4\u8BC1\u4E0E\u51ED\u636E",
      "command": "git credential / git-credential-cache / git-credential-store",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u663E\u793A\u300C\u5DF2\u8BA4\u8BC1\u4E3A X / \u672A\u8BA4\u8BC1\u300D\uFF0C\u8BA4\u8BC1\u4EA4\u7ED9\u7CFB\u7EDF\u51ED\u636E\u7BA1\u7406\u5668\u6216\u7EC8\u7AEF",
      "target": "remote",
      "readOnly": true
    },
    {
      "id": "8.16",
      "domain": "8",
      "name": "\u514B\u9686",
      "command": "git clone",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u9876\u90E8\u540C\u6B65\u5E26\u4E0E\u300C\u8FDC\u7AEF\u4E0E\u540C\u6B65\u300D\u9875",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u8BFB\u663E\u793A\u300C\u5F53\u524D\u4ED3\u5E93\u6765\u81EA\u54EA\u91CC\u300D",
      "target": "migrate",
      "readOnly": true
    },
    {
      "id": "9.1",
      "domain": "9",
      "name": "\u5DE5\u4F5C\u6811\u5217\u8868",
      "command": "git worktree `list`",
      "level": "\u8BFB",
      "placement": "\u76F4",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u884C\u5185\u5C55\u5F00\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u5DE5\u4F5C\u6811\u9875\uFF0C\u6BCF\u884C\u8DEF\u5F84 + \u5206\u652F + \u9501\u5B9A\u6807\u8BB0",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.2",
      "domain": "9",
      "name": "\u65B0\u5EFA\u5DE5\u4F5C\u6811",
      "command": "git worktree `add`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5DE5\u4F5C\u6811\u884C\u65B0\u589E",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.3",
      "domain": "9",
      "name": "\u7528\u5DF2\u6709\u5206\u652F\u5EFA\u5DE5\u4F5C\u6811",
      "command": "git worktree `add <path> <branch>`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u540C 9.2",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.4",
      "domain": "9",
      "name": "\u5220\u9664\u5DE5\u4F5C\u6811",
      "command": "git worktree `remove`",
      "level": "\u6BC1",
      "placement": "\u76F4",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u884C\u5185\u5C55\u5F00\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u884C\u6D88\u5931",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.5",
      "domain": "9",
      "name": "\u6E05\u7406\u5931\u6548\u767B\u8BB0",
      "command": "git worktree `prune`",
      "level": "\u5199",
      "placement": "\u76F4",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u884C\u5185\u5C55\u5F00\u6216\u5185\u8054\u786E\u8BA4\u5361",
      "result": "\u884C\u6D88\u5931",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.6",
      "domain": "9",
      "name": "\u9501 / \u89E3\u9501",
      "command": "git worktree `lock` / `unlock`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u884C\u4E0A\u51FA\u73B0\u9501\u6807\u8BB0\u4E0E\u539F\u56E0",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.7",
      "domain": "9",
      "name": "\u79FB\u52A8\u5DE5\u4F5C\u6811",
      "command": "git worktree `move`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u884C\u8DEF\u5F84\u66F4\u65B0",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "9.8",
      "domain": "9",
      "name": "\u7A00\u758F\u68C0\u51FA",
      "command": "git sparse-checkout",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u5DE5\u4F5C\u6811\u9875\u7B7E",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6539\u52A8\u9875\u53EA\u663E\u793A\u4FDD\u7559\u7684\u8DEF\u5F84",
      "target": "worktrees",
      "readOnly": false
    },
    {
      "id": "10.1",
      "domain": "10",
      "name": "\u5217\u8868\u4E0E\u72B6\u6001",
      "command": "git submodule `status`",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6298\u53E0\u533A\u300C\u5B50\u6A21\u5757\u300D\uFF0C\u6BCF\u884C\u8DEF\u5F84 + \u5F53\u524D\u63D0\u4EA4 + \u662F\u5426\u5DF2\u521D\u59CB\u5316",
      "target": "submodules",
      "readOnly": false
    },
    {
      "id": "10.2",
      "domain": "10",
      "name": "\u65B0\u589E\u5B50\u6A21\u5757",
      "command": "git submodule `add`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6539\u52A8\u9875\u51FA\u73B0 `.gitmodules` \u4E0E\u5B50\u6A21\u5757\u76EE\u5F55",
      "target": "submodules",
      "readOnly": false
    },
    {
      "id": "10.3",
      "domain": "10",
      "name": "\u521D\u59CB\u5316\u5E76\u68C0\u51FA",
      "command": "git submodule `update --init [--recursive]`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5B50\u6A21\u5757\u884C\u300C\u5DF2\u5C31\u7EEA\u300D",
      "target": "submodules",
      "readOnly": false
    },
    {
      "id": "10.4",
      "domain": "10",
      "name": "\u6279\u91CF\u6267\u884C",
      "command": "git submodule `foreach`",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u8BFB\u663E\u793A\u300CN \u4E2A\u5B50\u6A21\u5757\uFF0CM \u4E2A\u5DF2\u5C31\u7EEA\u300D",
      "target": "submodules",
      "readOnly": true
    },
    {
      "id": "10.5",
      "domain": "10",
      "name": "\u6539\u5730\u5740 / \u540C\u6B65",
      "command": "git submodule `set-url` / `sync`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5B50\u6A21\u5757\u884C\u66F4\u65B0",
      "target": "submodules",
      "readOnly": false
    },
    {
      "id": "10.6",
      "domain": "10",
      "name": "\u6539\u8DDF\u8E2A\u5206\u652F",
      "command": "git submodule `set-branch --branch`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u5B50\u6A21\u5757\u884C\u6807\u5206\u652F\u540D",
      "target": "submodules",
      "readOnly": false
    },
    {
      "id": "10.7",
      "domain": "10",
      "name": "\u53D6\u6D88\u767B\u8BB0",
      "command": "git submodule `deinit`",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u884C\u6D88\u5931",
      "target": "submodules",
      "readOnly": false
    },
    {
      "id": "10.8",
      "domain": "10",
      "name": "\u5438\u6536\u5B50\u6A21\u5757\u7684 .git",
      "command": "git submodule `absorbgitdirs`",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u5B50\u6A21\u5757\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u884C\u4E0A\u4E0D\u518D\u663E\u793A\u300C\u72EC\u7ACB .git\u300D",
      "target": "submodules",
      "readOnly": true
    },
    {
      "id": "11.1",
      "domain": "11",
      "name": "\u521D\u59CB\u5316\u4ED3\u5E93",
      "command": "git init `[--bare]`",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u663E\u793A\u300C\u8FD9\u4E2A\u76EE\u5F55\u8FD8\u4E0D\u662F\u4ED3\u5E93\u300D",
      "target": "migrate",
      "readOnly": true
    },
    {
      "id": "11.2",
      "domain": "11",
      "name": "\u68C0\u67E5\u5B8C\u6574\u6027",
      "command": "git fsck",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\uFF0C\u51E0\u884C\u95EE\u9898\u3001\u4E22\u5931\u5BF9\u8C61\u3001\u60AC\u7A7A\u63D0\u4EA4",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "11.3",
      "domain": "11",
      "name": "\u627E\u8FD8\u80FD\u635E\u56DE\u6765\u7684\u5BF9\u8C61",
      "command": "git fsck `--unreachable` / `--lost-found`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u5217\u51FA\u4E0D\u53EF\u8FBE\u63D0\u4EA4\uFF0C\u5E26\u300C\u4ECE\u8FD9\u91CC\u5EFA\u5206\u652F\u300D\u5165\u53E3",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "11.4",
      "domain": "11",
      "name": "\u7EDF\u8BA1\u5BF9\u8C61\u4E0E\u4F53\u79EF",
      "command": "git count-objects `-vH`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u300C\u677E\u6563\u5BF9\u8C61 N \u4E2A / \u6253\u5305 M \u4E2A / \u5171 X MB\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "11.5",
      "domain": "11",
      "name": "\u5783\u573E\u56DE\u6536",
      "command": "git gc",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8BCA\u65AD\u9875",
      "target": "maintenance",
      "readOnly": false
    },
    {
      "id": "11.6",
      "domain": "11",
      "name": "\u6E05\u7406\u4E0D\u53EF\u8FBE\u5BF9\u8C61",
      "command": "git prune",
      "level": "\u6BC1",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8BCA\u65AD\u9875",
      "target": "maintenance",
      "readOnly": false
    },
    {
      "id": "11.7",
      "domain": "11",
      "name": "\u91CD\u65B0\u6253\u5305",
      "command": "git repack",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "11.8",
      "domain": "11",
      "name": "\u81EA\u52A8\u7EF4\u62A4",
      "command": "git maintenance `run` / `start` / `stop` / `register`",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u8BCA\u65AD\u9875\u5F00\u5173",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "11.9",
      "domain": "11",
      "name": "\u63D0\u4EA4\u56FE",
      "command": "git commit-graph",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u53EA\u662F\u52A0\u901F\uFF0C\u9762\u677F\u53EA\u663E\u793A\u300C\u6709\u6CA1\u6709\u300D",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "11.10",
      "domain": "11",
      "name": "\u591A\u5305\u7D22\u5F15",
      "command": "git multi-pack-index",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u540C\u4E0A",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "11.11",
      "domain": "11",
      "name": "\u6253\u5305\u5F15\u7528",
      "command": "git pack-refs",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u540C\u4E0A",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "11.12",
      "domain": "11",
      "name": "\u5F52\u6863\u5BFC\u51FA",
      "command": "git archive",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u663E\u793A\u300C\u53EF\u5BFC\u51FA\u4E3A zip\u300D",
      "target": "migrate",
      "readOnly": true
    },
    {
      "id": "11.13",
      "domain": "11",
      "name": "\u79BB\u7EBF\u5305",
      "command": "git bundle `create` / `verify` / `unbundle`",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u8BCA\u65AD\u9875\u663E\u793A\u300C\u4E0A\u6B21\u5BFC\u51FA\u65F6\u95F4\u300D",
      "target": "migrate",
      "readOnly": true
    },
    {
      "id": "11.14",
      "domain": "11",
      "name": "\u5F15\u7528\u5B58\u50A8\u683C\u5F0F\u8FC1\u79FB",
      "command": "git refs `migrate`",
      "level": "\u6BC1",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u8BCA\u65AD\u9875",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "11.15",
      "domain": "11",
      "name": "\u5927\u4ED3\u5E93\u5DE5\u5177",
      "command": "scalar",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u7EF4\u62A4\uFF08\u542B\u5371\u9669\u533A\uFF09\u300D\u4E0E\u300C\u8FC1\u79FB\u4E0E\u5907\u4EFD\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u9762\u5411\u8D85\u5927\u4ED3\u5E93\u7684\u5C01\u88C5\uFF0C\u9762\u677F\u53EA\u663E\u793A\u300C\u8FD9\u4E2A\u4ED3\u5E93\u9002\u5408\u7528 scalar\u300D",
      "target": "maintenance",
      "readOnly": true
    },
    {
      "id": "12.1",
      "domain": "12",
      "name": "\u8BFB\u914D\u7F6E",
      "command": "git config `--list --show-origin`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\uFF0C\u6309\u6765\u6E90\u5206\u7EC4\uFF08\u7CFB\u7EDF / \u5168\u5C40 / \u672C\u5730 / \u5DE5\u4F5C\u6811\uFF09",
      "target": "config",
      "readOnly": true
    },
    {
      "id": "12.2",
      "domain": "12",
      "name": "\u5199\u914D\u7F6E",
      "command": "git config `set`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8BCA\u65AD\u9875\u884C\u66F4\u65B0",
      "target": "config",
      "readOnly": false
    },
    {
      "id": "12.3",
      "domain": "12",
      "name": "\u5220\u914D\u7F6E",
      "command": "git config `unset`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u884C\u6D88\u5931",
      "target": "config",
      "readOnly": false
    },
    {
      "id": "12.4",
      "domain": "12",
      "name": "\u8EAB\u4EFD",
      "command": "git config `user.name` / `user.email`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u9876\u90E8\u8EAB\u4EFD\u6761",
      "target": "config",
      "readOnly": false
    },
    {
      "id": "12.5",
      "domain": "12",
      "name": "\u94A9\u5B50\u6E05\u5355",
      "command": "githooks + `core.hooksPath`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u300C\u88C5\u4E86\u54EA\u4E9B\u94A9\u5B50\u3001\u54EA\u4E9B\u53EF\u6267\u884C\u3001\u76EE\u5F55\u88AB\u6539\u5230\u54EA\u300D",
      "target": "hooks",
      "readOnly": true
    },
    {
      "id": "12.6",
      "domain": "12",
      "name": "\u624B\u52A8\u8DD1\u4E00\u4E2A\u94A9\u5B50",
      "command": "git hook `run`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u8F93\u51FA\u8D34\u6309\u94AE\u4E0B",
      "target": "hooks",
      "readOnly": false
    },
    {
      "id": "12.7",
      "domain": "12",
      "name": "\u5C5E\u6027\u89C4\u5219",
      "command": "git check-attr / gitattributes",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\uFF0C\u67D0\u8DEF\u5F84\u7684\u6362\u884C / \u8FC7\u6EE4 / \u5408\u5E76\u89C4\u5219",
      "target": "config",
      "readOnly": true
    },
    {
      "id": "12.8",
      "domain": "12",
      "name": "\u90AE\u4EF6\u6620\u5C04",
      "command": "git check-mailmap / gitmailmap",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u914D\u7F6E\u300D\u4E0E\u300C\u94A9\u5B50\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u5386\u53F2\u5217\u8868\u91CC\u4F5C\u8005\u663E\u793A\u4E3A\u6620\u5C04\u540E\u7684\u540D\u5B57",
      "target": "config",
      "readOnly": true
    },
    {
      "id": "13.1",
      "domain": "13",
      "name": "\u4E8C\u5206\u5B9A\u4F4D",
      "command": "git bisect `start` / `bad` / `good` / `skip` / `reset`",
      "level": "\u5199",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u9876\u90E8\u8EAB\u4EFD\u6761\u5E38\u9A7B\u300C\u4E8C\u5206\u8FDB\u884C\u4E2D\uFF0C\u8FD8\u5269 N \u6B65\u300D",
      "target": "diagnostics",
      "readOnly": false
    },
    {
      "id": "13.2",
      "domain": "13",
      "name": "\u4E8C\u5206\u53EF\u89C6\u5316 / \u91CD\u653E",
      "command": "git bisect `visualize` / `replay`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.3",
      "domain": "13",
      "name": "\u6309\u5185\u5BB9\u641C\u5DE5\u4F5C\u533A",
      "command": "git grep",
      "level": "\u8BFB",
      "placement": "\u6298",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u8D34\u89E6\u53D1\u70B9\u7684\u6D6E\u5C42\u6216\u6574\u9875\u66FF\u6362",
      "result": "\u6574\u9875\u641C\u7D22\uFF08\u539F\u578B\u5217\u4E3A\u672A\u5B9E\u73B0\u9879\uFF09",
      "target": "search",
      "readOnly": false
    },
    {
      "id": "13.4",
      "domain": "13",
      "name": "\u6309\u6761\u4EF6\u5217\u6587\u4EF6",
      "command": "git ls-files",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u300C\u7D22\u5F15\u91CC N \u4E2A\u6587\u4EF6\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.5",
      "domain": "13",
      "name": "\u770B\u5BF9\u8C61\u5185\u5BB9",
      "command": "git cat-file `-p` / `-t`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u53EA\u8BFB\u6587\u672C",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.6",
      "domain": "13",
      "name": "\u770B\u6811",
      "command": "git ls-tree",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u76EE\u5F55\u6E05\u5355",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.7",
      "domain": "13",
      "name": "\u89E3\u6790\u5F15\u7528\u4E0E\u8DEF\u5F84",
      "command": "git rev-parse",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u9762\u677F\u5185\u90E8\u7528\uFF0C\u4E0D\u66B4\u9732\u6309\u94AE",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.8",
      "domain": "13",
      "name": "\u679A\u4E3E\u5F15\u7528",
      "command": "git for-each-ref",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u9762\u677F\u5185\u90E8\u7528\uFF08\u5206\u652F\u3001\u6807\u7B7E\u5217\u8868\u90FD\u9760\u5B83\uFF09",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.9",
      "domain": "13",
      "name": "\u5305\u542B\u5173\u7CFB",
      "command": "git merge-base `--is-ancestor`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u9762\u677F\u5185\u90E8\u7528\uFF08\u5224\u65AD\u80FD\u4E0D\u80FD\u76F4\u63A5\u66F4\u65B0\uFF09",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.10",
      "domain": "13",
      "name": "\u8865\u4E01\u7B49\u4EF7",
      "command": "git cherry / git patch-id",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u8BCA\u65AD\u9875\u300C\u8FD9\u6761\u63D0\u4EA4\u5728\u90A3\u8FB9\u6709\u6CA1\u6709\u7B49\u4EF7\u8865\u4E01\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.11",
      "domain": "13",
      "name": "\u8BA1\u6570\u4E0E\u5DE6\u53F3\u5DEE",
      "command": "git rev-list `--count` / `--left-right`",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u9762\u677F\u5185\u90E8\u7528\uFF08\u9886\u5148 / \u843D\u540E\u6570\uFF09",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.12",
      "domain": "13",
      "name": "\u5E94\u7528\u8865\u4E01",
      "command": "git apply `--check` / `--3way`",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u53EA\u663E\u793A\u300C\u8FD9\u4E2A diff \u80FD\u4E0D\u80FD\u5E72\u51C0\u5E94\u7528\u300D",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.13",
      "domain": "13",
      "name": "\u5C3E\u90E8\u7B7E\u540D",
      "command": "git interpret-trailers",
      "level": "\u5199",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u9762\u677F\u5728\u8BF4\u660E\u680F\u91CC\u52A0 `Signed-off-by` \u65F6\u5185\u90E8\u7528",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "13.14",
      "domain": "13",
      "name": "\u56FE\u5F62\u5386\u53F2\u6D4F\u89C8\u5668",
      "command": "gitk",
      "level": "\u8BFB",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u8BCA\u65AD\u300D\u4E0E\u63D0\u4EA4\u5386\u53F2\u641C\u7D22",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u5916\u90E8\u7A97\u53E3\uFF0C\u9762\u677F\u4E0D\u5D4C",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "14.1",
      "domain": "14",
      "name": "\u751F\u6210\u8865\u4E01\u90AE\u4EF6",
      "command": "git format-patch",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u663E\u793A\u300C\u8FD9\u6761\u5206\u652F\u4E0A\u6709 N \u6761\u5F85\u53D1\u8865\u4E01\u300D",
      "target": "migrate",
      "readOnly": true
    },
    {
      "id": "14.2",
      "domain": "14",
      "name": "\u53D1\u8865\u4E01\u90AE\u4EF6",
      "command": "git send-email",
      "level": "\u5199",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u53EA\u663E\u793A\u300C\u6709 N \u6761\u8865\u4E01\u5F85\u53D1\u300D",
      "target": "platform",
      "readOnly": true
    },
    {
      "id": "14.3",
      "domain": "14",
      "name": "\u8BF7\u6C42\u62C9\u53D6\u7684\u8BF4\u660E",
      "command": "git request-pull",
      "level": "\u8BFB",
      "placement": "\u8BCA",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BCA\u65AD\u6E05\u5355",
      "result": "\u7ED3\u679C\u662F\u7ED9\u90AE\u4EF6\u7528\u7684\u6587\u672C\uFF0C\u9762\u677F\u53EA\u8BFB\u663E\u793A",
      "target": "diagnostics",
      "readOnly": true
    },
    {
      "id": "14.4",
      "domain": "14",
      "name": "PR / Issue / Release",
      "command": "",
      "level": "\u975E git",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u4E0D\u505A\uFF08\u7968 #1586 \u7684 C \u7EC4\uFF09",
      "target": "platform",
      "readOnly": true
    },
    {
      "id": "14.5",
      "domain": "14",
      "name": "Actions / CI \u72B6\u6001",
      "command": "",
      "level": "\u975E git",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u4E0D\u505A",
      "target": "platform",
      "readOnly": true
    },
    {
      "id": "14.6",
      "domain": "14",
      "name": "\u8D26\u53F7\u4E0E\u6743\u9650",
      "command": "",
      "level": "\u975E git",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "git \u53EA\u5230 credential helper\uFF088.15\uFF09",
      "target": "platform",
      "readOnly": true
    },
    {
      "id": "14.7",
      "domain": "14",
      "name": "\u5206\u652F\u4FDD\u62A4 / \u7981\u6B62\u5F3A\u63A8",
      "command": "",
      "level": "\u975E git",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "git \u7AEF\u53EA\u6709 `--force-with-lease`\uFF088.12\uFF09",
      "target": "platform",
      "readOnly": true
    },
    {
      "id": "14.8",
      "domain": "14",
      "name": "\u4ED3\u5E93\u8F6C\u79FB / \u5F52\u6863",
      "command": "",
      "level": "\u975E git",
      "placement": "\u5916",
      "entry": "\u7BA1\u7406\u9875\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D",
      "opens": "\u53EA\u8BFB\u8BF4\u660E\u4E0E\u8FB9\u754C",
      "result": "\u4E0D\u505A",
      "target": "platform",
      "readOnly": true
    }
  ];

  // docs/prototype/vc-redesign/src/domain/pages.ts
  var MANAGE_PAGES = ["branch-tags", "remote", "submodules", "maintenance", "migrate", "config", "hooks", "diagnostics", "platform"];
  function createPageState() {
    return {
      stack: [],
      paletteOpen: false,
      paletteQuery: "",
      query: "",
      filter: "all",
      expanded: ["identity"],
      draft: "",
      capOpen: "",
      capStage: 0,
      capResult: null,
      dangerId: null,
      confirmText: "",
      rebaseDemo: false,
      rebaseStep: 0,
      conflictDemo: false,
      conflictChoice: null,
      conflictResolved: [],
      taskDemo: false,
      taskProgress: 62,
      highlight: null,
      result: null
    };
  }
  function activePage(state) {
    return state.stack.length === 0 ? null : state.stack[state.stack.length - 1];
  }
  function pushPage(stack, page) {
    if (stack[stack.length - 1] === page) return stack;
    if (page === "manage") return ["manage"];
    return [...stack, page];
  }
  function toggle(list, key) {
    return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
  }
  function needsSecondConfirm(cap) {
    return cap.level === "\u6BC1" && (cap.target === "maintenance" || cap.target === "migrate");
  }
  function demoResultText(cap) {
    if (cap.readOnly) return `\u53EA\u8BFB\u80FD\u529B\uFF1A\u539F\u578B\u53EA\u5C55\u793A ${cap.name} \u8BFB\u5230\u7684\u5F62\u72B6\uFF0C\u4E0D\u5199\u4ED3\u5E93\u3002`;
    if (cap.level === "\u8BFB") return `${cap.name} \u8BFB\u5B8C\u4E86\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002${cap.result}`;
    if (cap.level === "\u6BC1") return `${cap.name} \u5DF2\u5B8C\u6210\uFF08\u539F\u578B\u6A21\u62DF\uFF0C\u65E0\u6CD5\u6062\u590D\uFF09\u3002${cap.result}`;
    return `${cap.name} \u5DF2\u5B8C\u6210\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002${cap.result}`;
  }
  function capabilitiesOf(target) {
    return CAPABILITIES.filter((cap) => cap.target === target);
  }
  function reducePage(state, action) {
    switch (action.type) {
      case "page-open": {
        const stack = pushPage(state.stack, action.page);
        if (stack === state.stack) return state;
        return { ...state, stack, query: "", filter: "all", draft: "", capOpen: "", capStage: 0, dangerId: null, confirmText: "", result: null };
      }
      case "page-back": {
        if (state.dangerId !== null) return { ...state, dangerId: null, capOpen: "", capStage: 0, confirmText: "" };
        if (state.capOpen !== "") return { ...state, capOpen: "", capStage: 0, capResult: null };
        if (state.stack.length === 0) return state;
        const stack = state.stack.slice(0, -1);
        return { ...state, stack, query: "", filter: "all", capOpen: "", capStage: 0, dangerId: null, capResult: null, result: null };
      }
      case "page-close-all":
        if (state.stack.length === 0 && !state.paletteOpen) return state;
        return { ...state, stack: [], paletteOpen: false, capOpen: "", capStage: 0, dangerId: null, confirmText: "", capResult: null, result: null, highlight: null };
      case "page-query":
        return { ...state, query: action.value, draft: action.value };
      case "page-filter":
        return { ...state, filter: action.filter };
      case "page-fold":
        return { ...state, expanded: toggle(state.expanded, action.key) };
      case "page-draft":
        return { ...state, draft: action.value };
      case "page-result":
        return { ...state, result: action.text };
      case "page-result-clear":
        return state.result === null ? state : { ...state, result: null };
      case "cap-open": {
        const cap = CAPABILITIES.find((item) => item.id === action.id);
        if (cap === void 0 || cap.readOnly) return state;
        return { ...state, capOpen: cap.id, capStage: 1, capResult: null };
      }
      case "cap-next": {
        if (state.capOpen === "") return state;
        return { ...state, capStage: 2 };
      }
      case "cap-close":
        return { ...state, capOpen: "", capStage: 0, capResult: null };
      case "cap-run": {
        const cap = CAPABILITIES.find((item) => item.id === state.capOpen);
        if (cap === void 0) return state;
        return { ...state, capOpen: "", capStage: 0, capResult: { id: cap.id, text: demoResultText(cap) }, highlight: cap.id };
      }
      case "danger-open": {
        const cap = CAPABILITIES.find((item) => item.id === action.id);
        if (cap === void 0 || !needsSecondConfirm(cap)) return state;
        return { ...state, dangerId: cap.id, capOpen: "", capStage: 0, confirmText: "" };
      }
      case "danger-close":
        return { ...state, dangerId: null, confirmText: "" };
      case "danger-run": {
        const cap = CAPABILITIES.find((item) => item.id === state.dangerId);
        if (cap === void 0 || !needsSecondConfirm(cap)) return state;
        return { ...state, dangerId: null, confirmText: "", capResult: { id: cap.id, text: demoResultText(cap) }, highlight: cap.id, result: "\u5371\u9669\u52A8\u4F5C\u5DF2\u5728\u6838\u5BF9\u9875\u786E\u8BA4\uFF08\u539F\u578B\u6A21\u62DF\uFF09\uFF1A\u771F\u5B9E\u6267\u884C\u4E0D\u5728\u539F\u578B\u91CC\u53D1\u751F\uFF0C\u754C\u9762\u53EA\u8BB0\u5F55\u8FD9\u4E00\u6B65\u8D70\u8FC7\u3002" };
      }
      case "confirm-text":
        return { ...state, confirmText: action.value };
      case "rebase-demo":
        return { ...state, rebaseDemo: true, rebaseStep: 0, result: null };
      case "rebase-step":
        return { ...state, rebaseStep: Math.min(state.rebaseStep + 1, 6) };
      case "rebase-abort":
        return { ...state, rebaseDemo: false, rebaseStep: 0, result: "\u5DF2\u4E2D\u6B62\u53D8\u57FA\uFF0C\u5206\u652F\u56DE\u5230\u6F14\u793A\u5F00\u59CB\u524D\u7684\u63D0\u4EA4\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002" };
      case "conflict-demo":
        return { ...state, conflictDemo: true, conflictChoice: null, conflictResolved: [], result: null };
      case "conflict-choice":
        return { ...state, conflictChoice: action.choice };
      case "conflict-resolve":
        if (!state.conflictResolved.includes(action.path)) return { ...state, conflictResolved: [...state.conflictResolved, action.path] };
        return { ...state, conflictResolved: state.conflictResolved.filter((path) => path !== action.path) };
      case "conflict-abort":
        return { ...state, conflictDemo: false, conflictChoice: null, conflictResolved: [], result: "\u5DF2\u4E2D\u6B62\u5408\u5E76\uFF0C\u5DE5\u4F5C\u533A\u56DE\u5230\u5408\u5E76\u5F00\u59CB\u524D\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002" };
      case "task-demo":
        return { ...state, taskDemo: true, taskProgress: 62, result: null };
      case "task-tick":
        return { ...state, taskProgress: Math.min(100, state.taskProgress + 19) };
      case "palette-open":
        return { ...state, paletteOpen: true, paletteQuery: "" };
      case "palette-close":
        return { ...state, paletteOpen: false, paletteQuery: "" };
      case "palette-query":
        return { ...state, paletteQuery: action.value };
      case "palette-highlight":
        return { ...state, highlight: action.id };
      case "highlight-clear":
        return state.highlight === null ? state : { ...state, highlight: null };
      default:
        return state;
    }
  }
  function targetOfCapability(cap) {
    switch (cap.target) {
      case "changes":
        return "view";
      case "commits":
        return "view";
      case "worktrees":
        return "view";
      case "stash":
        return "view";
      case "manage":
        return "manage";
      default:
        return cap.target;
    }
  }

  // docs/prototype/vc-redesign/src/data/pages-copy.ts
  var MANAGE_INDEX = {
    id: "manage",
    title: "\u7BA1\u7406",
    card: "\u7248\u672C\u7BA1\u7406\u9762\u677F\u91CC\u4E0D\u5E38\u70B9\u3001\u4F46\u9700\u8981\u8D1F\u8D23\u4EFB\u7684\u52A8\u4F5C\u90FD\u6536\u5728\u8FD9\u4E5D\u4E2A\u5206\u533A\u91CC\u3002",
    lede: "\u7D22\u5F15\u672C\u8EAB\u4E0D\u5199\u4ED3\u5E93\uFF0C\u53EA\u8D1F\u8D23\u628A\u300C\u5206\u652F\u4E0E\u6807\u7B7E\u3001\u8FDC\u7AEF\u3001\u5B50\u6A21\u5757\u3001\u7EF4\u62A4\u3001\u8FC1\u79FB\u3001\u914D\u7F6E\u3001\u94A9\u5B50\u3001\u8BCA\u65AD\u3001\u5E73\u53F0\u8FB9\u754C\u300D\u4E5D\u4E2A\u5206\u533A\u6446\u51FA\u6765\u3002\u6BCF\u4E2A\u5206\u533A\u5165\u53E3\u90FD\u5199\u6E05\u5B83\u7BA1\u4EC0\u4E48\u3002",
    count: "9 \u4E2A\u5206\u533A \xB7 162 \u6761\u80FD\u529B\u91CC\u7684 104 \u6761\u53EF\u4EA4\u4E92\u80FD\u529B\u90FD\u6709\u843D\u70B9"
  };
  var PAGE_META = {
    manage: MANAGE_INDEX,
    "branch-tags": {
      id: "branch-tags",
      title: "\u5206\u652F\u4E0E\u6807\u7B7E",
      card: "\u672C\u5730\u5206\u652F\u3001\u8FDC\u7AEF\u5206\u652F\u3001\u6807\u7B7E\u4E0E\u4E0A\u6E38\u8BBE\u7F6E\u3002\u5207\u5206\u652F\u4ECD\u8D70\u9876\u90E8\u5206\u652F\u6D6E\u5C42\uFF0C\u8FD9\u91CC\u8D1F\u8D23\u5176\u4F59\u7684\u6574\u7406\u52A8\u4F5C\u3002",
      lede: "\u5206\u652F\u5217\u8868\u6765\u81EA git \u7684\u771F\u5B9E\u5F15\u7528\u3002\u6807\u7B7E\u662F\u4ECE\u672C\u5730 refs \u8BFB\u5230\u7684\u56DB\u5341\u4E2A\u7248\u672C\u6807\u8BB0\u3002\u5207\u6362\u5206\u652F\u7684\u65E5\u5E38\u5165\u53E3\u4ECD\u662F\u9876\u90E8\u90A3\u679A\u5206\u652F\u6309\u94AE\uFF0C\u8FD9\u4E00\u9875\u7BA1\u7684\u662F\u6574\u7406\uFF1A\u8BBE\u4E0A\u6E38\u3001\u91CD\u547D\u540D\u3001\u5220\u9664\u3001\u65B0\u5EFA\u6807\u7B7E\u3002",
      count: "62 \u6761\u672C\u5730\u5206\u652F \xB7 40 \u4E2A\u6807\u7B7E"
    },
    remote: {
      id: "remote",
      title: "\u8FDC\u7AEF\u4E0E\u540C\u6B65",
      card: "\u4E09\u4E2A\u8FDC\u7AEF\u3001\u5404\u81EA\u5730\u5740\u3001\u6293\u53D6\u4E0E\u63A8\u9001\u89C4\u5219\uFF0C\u4EE5\u53CA\u300C\u4E0A\u4E00\u6B21\u4ECE\u8FDC\u7AEF\u8BFB\u5230\u4EC0\u4E48\u300D\u7684\u4F9D\u636E\u3002",
      lede: "\u8FDC\u7AEF\u5730\u5740\u662F\u4ECE git \u914D\u7F6E\u91CC\u8BFB\u5230\u7684\u771F\u5B9E\u503C\uFF0C\u6807\u4E86 fetch \u4E0E push \u4E24\u6761\u5730\u5740\u3002\u540C\u6B65\u6570\u5B57\u6CBF\u7528\u9876\u90E8\u540C\u6B65\u5E26\u7684\u8BFB\u6570\uFF0C\u8BFB\u4E0D\u5230\u65F6\u5982\u5B9E\u5199\u8BFB\u4E0D\u5230\u3002",
      count: "3 \u4E2A\u8FDC\u7AEF \xB7 1 \u6761\u4E0A\u6E38\u8DDF\u8E2A"
    },
    submodules: {
      id: "submodules",
      title: "\u5B50\u6A21\u5757",
      card: "\u767B\u8BB0\u3001\u521D\u59CB\u62C9\u53D6\u3001\u6279\u91CF\u66F4\u65B0\u4E0E\u79FB\u9664\u5B50\u6A21\u5757\u3002\u8FD9\u4E2A\u4ED3\u5E93\u76EE\u524D\u4E00\u4E2A\u90FD\u6CA1\u6709\uFF0C\u7A7A\u6001\u4E5F\u5982\u5B9E\u753B\u51FA\u6765\u3002",
      lede: "\u8FD9\u4E2A\u4ED3\u5E93\u6CA1\u6709 .gitmodules\uFF0C\u6240\u4EE5\u4E0B\u9762\u6CA1\u6709\u5B50\u6A21\u5757\u884C\u3002\u754C\u9762\u4ECD\u7136\u7ED9\u51FA\u6DFB\u52A0\u5165\u53E3\u4E0E\u6279\u91CF\u52A8\u4F5C\u7684\u8BF4\u660E\uFF0C\u56E0\u4E3A\u7A7A\u6001\u672C\u8EAB\u5C31\u662F\u8981\u8BC4\u5BA1\u7684\u72B6\u6001\u4E4B\u4E00\u3002",
      count: "0 \u4E2A\u5B50\u6A21\u5757"
    },
    maintenance: {
      id: "maintenance",
      title: "\u7EF4\u62A4",
      card: "\u6574\u7406\u5BF9\u8C61\u3001\u68C0\u67E5\u5B8C\u6574\u6027\u3001\u91CD\u5199\u5386\u53F2\u8FD9\u7C7B\u52A8\u4F5C\u3002\u4E0D\u53EF\u9006\u7684\u8FDB\u6700\u5E95\u4E0B\u7684\u5371\u9669\u533A\u3002",
      lede: "\u6570\u5B57\u5168\u90E8\u6765\u81EA\u672C\u4ED3\u5E93\u6B64\u523B\u7684 git \u8BFB\u6570\uFF08\u677E\u6563\u5BF9\u8C61\u3001\u5305\u6587\u4EF6\u3001\u53EF\u56DE\u6536\u5BF9\u8C61\uFF09\u3002\u4E0A\u534A\u9875\u662F\u53EF\u64A4\u9500\u7684\u6574\u7406\u52A8\u4F5C\uFF0C\u6700\u5E95\u4E0B\u7684\u5371\u9669\u533A\u96C6\u4E2D\u653E\u65E0\u6CD5\u6062\u590D\u7684\u6574\u4ED3\u52A8\u4F5C\uFF0C\u8FDB\u5165\u524D\u8981\u5148\u8FC7\u4E00\u9875\u9010\u6761\u6838\u5BF9\u3002",
      count: "\u5DE5\u5177\u8BFB\u6570 \xB7 \u5371\u9669\u533A 3 \u6761",
      danger: true
    },
    migrate: {
      id: "migrate",
      title: "\u8FC1\u79FB\u4E0E\u5907\u4EFD",
      card: "\u514B\u9686\u3001\u521D\u59CB\u5316\u3001\u5F52\u6863\u5BFC\u51FA\u3001\u79BB\u7EBF\u5305\u4E0E\u5386\u53F2\u5BFC\u5165\u5BFC\u51FA\uFF1A\u6362\u673A\u5668\u6216\u6362\u6258\u7BA1\u4E4B\u524D\u8981\u7528\u7684\u52A8\u4F5C\u3002",
      lede: "\u8FD9\u4E00\u9875\u7684\u52A8\u4F5C\u90FD\u4F1A\u4EA7\u751F\u4E00\u4EFD\u65B0\u526F\u672C\u6216\u6574\u4ED3\u66FF\u6362\uFF0C\u6240\u4EE5\u6BCF\u4E00\u884C\u90FD\u5199\u7740\u300C\u4EA7\u51FA\u4EC0\u4E48\u3001\u653E\u5728\u54EA\u3001\u539F\u4ED3\u5E93\u4F1A\u4E0D\u4F1A\u88AB\u52A8\u300D\u3002\u4EFB\u52A1\u65F6\u95F4\u957F\u7684\u8D70\u4EFB\u52A1\u8FDB\u5EA6\u9875\uFF0C\u4E0D\u5728\u9762\u677F\u91CC\u5047\u88C5\u77AC\u95F4\u5B8C\u6210\u3002",
      count: "6 \u6761\u80FD\u529B \xB7 3 \u7C7B\u4EA7\u51FA"
    },
    config: {
      id: "config",
      title: "\u914D\u7F6E",
      card: "\u8EAB\u4EFD\u3001\u884C\u5C3E\u3001\u5927\u5C0F\u5199\u3001\u94A9\u5B50\u8DEF\u5F84\u4E0E\u51ED\u636E\u6765\u6E90\u3002\u4E0D\u662F\u6574\u4EFD git \u914D\u7F6E\u7684\u7F16\u8F91\u5668\u3002",
      lede: "\u53EA\u5217\u4E0E\u7248\u672C\u7BA1\u7406\u754C\u9762\u76F4\u63A5\u76F8\u5173\u7684\u952E\uFF0C\u503C\u662F\u4ECE git \u914D\u7F6E\u91CC\u8BFB\u5230\u7684\u771F\u5B9E\u503C\u3002\u6CA1\u914D\u7684\u952E\u663E\u793A\u300C\u672A\u914D\u7F6E\u300D\u800C\u4E0D\u662F\u7A7A\u7740\u3002\u51ED\u636E\u53EA\u5C55\u793A\u6765\u6E90\u7C7B\u578B\uFF0C\u6C38\u8FDC\u4E0D\u663E\u793A\u51ED\u636E\u539F\u6587\u3002",
      count: "8 \u6761\u76F8\u5173\u952E \xB7 2 \u5C42\u4F5C\u7528\u57DF"
    },
    hooks: {
      id: "hooks",
      title: "\u94A9\u5B50",
      card: "\u672C\u4ED3\u5E93\u88C5\u4E86\u54EA\u4E9B\u94A9\u5B50\u3001\u6765\u81EA\u54EA\u4E2A\u76EE\u5F55\u3001\u662F\u4E0D\u662F git \u81EA\u5E26\u7684\u793A\u4F8B\u3002",
      lede: "\u94A9\u5B50\u76EE\u5F55\u91CC\u6709\u5341\u56DB\u4E2A\u6587\u4EF6\uFF0C\u5168\u90E8\u662F git \u521D\u59CB\u5316\u81EA\u5E26\u7684 .sample\uFF0C\u6CA1\u6709\u771F\u6B63\u542F\u7528\u7684\u94A9\u5B50\u3002\u8FD9\u4E00\u9875\u8D1F\u8D23\u5B89\u88C5\u3001\u505C\u7528\u4E0E\u770B\u6E05\u5355\u3002\u7F16\u8F91\u94A9\u5B50\u6B63\u6587\u8981\u4EA4\u56DE\u5916\u90E8\u7F16\u8F91\u5668\uFF0C\u9762\u677F\u4E0D\u5185\u5D4C\u7F16\u8F91\u5668\u3002",
      count: "0 \u4E2A\u5DF2\u542F\u7528 \xB7 14 \u4E2A\u793A\u4F8B"
    },
    diagnostics: {
      id: "diagnostics",
      title: "\u8BCA\u65AD",
      card: "\u7248\u672C\u4FE1\u606F\u3001\u5F15\u7528\u8BA1\u6570\u3001\u5BF9\u8C61\u8BFB\u53D6\u3001\u5B8C\u6574\u6027\u68C0\u67E5\u4E0E\u53EA\u8BFB\u7684\u5E95\u5C42\u6392\u67E5\u5165\u53E3\u3002",
      lede: "\u8FD9\u4E00\u9875\u628A\u300C\u770B\u5F97\u5230\u4F46\u6539\u4E0D\u4E86\u300D\u7684\u80FD\u529B\u96C6\u4E2D\u5C55\u793A\uFF1A\u6BCF\u4E00\u6761\u90FD\u5199\u660E\u5B83\u8BFB\u5230\u4EC0\u4E48\u3001\u54EA\u4E9B\u7248\u672C\u624D\u652F\u6301\u3001\u8BFB\u4E0D\u5230\u65F6\u754C\u9762\u600E\u4E48\u5199\u3002\u8BCA\u65AD\u7ED3\u679C\u53EA\u8D34\u5728\u5BF9\u5E94\u884C\u4E0B\u9762\uFF0C\u4E0D\u8DF3\u9875\u3002",
      count: "14 \u6761\u8C03\u8BD5\u80FD\u529B \xB7 23 \u6761\u53EA\u8BFB"
    },
    platform: {
      id: "platform",
      title: "\u5E73\u53F0\u4E0E\u8FB9\u754C",
      card: "\u54EA\u4E9B\u4E8B\u9762\u677F\u53EA\u89E3\u91CA\u3001\u4E0D\u4EE3\u505A\uFF1A\u7F51\u9875\u7AEF\u80FD\u529B\u3001\u670D\u52A1\u7AEF\u6743\u9650\u3001\u5916\u90E8\u5DE5\u5177\u4E0E\u6574\u4ED3\u91CD\u5199\u3002",
      lede: "\u8FD9\u4E00\u9875\u9010\u6761\u5217\u51FA\u5FC5\u987B\u4EA4\u51FA\u53BB\u7684\u80FD\u529B\uFF0C\u4EE5\u53CA\u4E3A\u4EC0\u4E48\u4EA4\u51FA\u53BB\uFF1A\u9762\u677F\u4E0D\u6301\u6709\u7F51\u9875\u7AEF\u4EE4\u724C\u3001\u4E0D\u66FF\u4EE3\u670D\u52A1\u7AEF\u6743\u9650\u3001\u4E0D\u5185\u5D4C\u7F16\u8F91\u5668\u4E0E\u56FE\u5F62\u5DE5\u5177\u3002\u6BCF\u4E00\u6761\u90FD\u7ED9\u51FA\u300C\u53BB\u54EA\u91CC\u505A\u300D\u3002",
      count: "6 \u6761\u80FD\u529B \xB7 6 \u6761\u65E0\u64CD\u4F5C\u5165\u53E3"
    },
    rebase: {
      id: "rebase",
      title: "\u53D8\u57FA\u5F85\u529E",
      card: "\u628A\u300C\u54EA\u51E0\u6761\u63D0\u4EA4\u8981\u632A\u3001\u54EA\u6761\u8981\u5408\u5E76\u3001\u54EA\u6761\u8981\u6539\u5199\u8BF4\u660E\u300D\u6446\u6210\u4E00\u5F20\u6E05\u5355\u518D\u6267\u884C\u3002",
      lede: "\u53D8\u57FA\u4F1A\u6539\u5199\u63D0\u4EA4\uFF0C\u6240\u4EE5\u6267\u884C\u524D\u8981\u5148\u770B\u5230\u5B8C\u6574\u6E05\u5355\u4E0E\u6BCF\u4E00\u6761\u7684\u5904\u7406\u65B9\u5F0F\u3002\u6E05\u5355\u662F\u6F14\u793A\u6570\u636E\u3002\u771F\u5B9E\u5B9E\u73B0\u91CC\u5B83\u6765\u81EA git \u7684\u53D8\u57FA\u8BA1\u5212\uFF0C\u6267\u884C\u4E2D\u6682\u505C\u4E0E\u7EE7\u7EED\u90FD\u5728\u8FD9\u4E00\u9875\u3002",
      count: "6 \u6761\u5F85\u529E \xB7 \u6F14\u793A",
      danger: true
    },
    conflicts: {
      id: "conflicts",
      title: "\u51B2\u7A81\u5411\u5BFC",
      card: "\u5408\u5E76\u3001\u53D8\u57FA\u6216\u62E3\u9009\u649E\u4E0A\u51B2\u7A81\u65F6\uFF0C\u9010\u6587\u4EF6\u9009\u7248\u672C\u3001\u770B\u7ED3\u679C\u3001\u6807\u8BB0\u89E3\u51B3\uFF0C\u518D\u7EE7\u7EED\u3002",
      lede: "\u51B2\u7A81\u4E0D\u662F\u9519\u8BEF\u5F39\u7A97\uFF0C\u800C\u662F\u4E00\u4E2A\u8981\u9010\u6587\u4EF6\u8D70\u5B8C\u7684\u6D41\u7A0B\u3002\u8FD9\u4E00\u9875\u628A\u300C\u9009\u54EA\u8FB9\u3001\u7ED3\u679C\u957F\u4EC0\u4E48\u6837\u3001\u8FD8\u5269\u51E0\u4E2A\u6587\u4EF6\u6CA1\u89E3\u51B3\u300D\u653E\u5728\u540C\u4E00\u5C4F\uFF0C\u907F\u514D\u5728\u6587\u4EF6\u5217\u8868\u4E0E\u7EC8\u7AEF\u4E4B\u95F4\u6765\u56DE\u627E\u3002",
      count: "3 \u4E2A\u51B2\u7A81\u6587\u4EF6 \xB7 \u6F14\u793A"
    },
    task: {
      id: "task",
      title: "\u4EFB\u52A1\u8FDB\u5EA6",
      card: "\u514B\u9686\u3001\u8FC1\u79FB\u3001\u5F52\u6863\u8FD9\u7C7B\u957F\u4EFB\u52A1\uFF1A\u8FDB\u884C\u5230\u54EA\u4E00\u6B65\u3001\u5199\u5230\u54EA\u4E2A\u6587\u4EF6\u3001\u80FD\u4E0D\u80FD\u53D6\u6D88\u3002",
      lede: "\u957F\u4EFB\u52A1\u4E0D\u80FD\u5047\u88C5\u77AC\u65F6\u5B8C\u6210\u3002\u8FD9\u4E00\u9875\u628A\u51C6\u5907\u3001\u4F20\u8F93\u3001\u68C0\u51FA\u4E09\u6B65\u4E0E\u5DF2\u5199\u51FA\u7684\u6587\u4EF6\u91CF\u9010\u6761\u5217\u51FA\u3002\u53D6\u6D88\u8981\u5199\u6E05\u5DF2\u7ECF\u4EA7\u751F\u7684\u6587\u4EF6\u4F1A\u4E0D\u4F1A\u7559\u4E0B\u3002",
      count: "1 \u4E2A\u8FD0\u884C\u4E2D\u7684\u4EFB\u52A1 \xB7 \u6F14\u793A"
    },
    search: {
      id: "search",
      title: "\u5168\u5E93\u641C\u7D22",
      card: "\u4E00\u6B21\u641C\u63D0\u4EA4\u8BF4\u660E\u3001\u4F5C\u8005\u3001\u63D0\u4EA4\u53F7\u3001\u5206\u652F\u540D\u4E0E\u6807\u7B7E\u540D\u3002\u641C\u5185\u5BB9\u53EA\u5C55\u793A\u547D\u4E2D\u7684\u6587\u4EF6\u6E05\u5355\u3002",
      lede: "\u641C\u7D22\u8303\u56F4\u662F\u672C\u5730\u5DF2\u6709\u7684\u5F15\u7528\u4E0E\u63D0\u4EA4\uFF0C\u4E0D\u8BFB\u8FDC\u7AEF\u3001\u4E0D\u8BFB\u5DE5\u4F5C\u533A\u5168\u6587\u3002\u7ED3\u679C\u6309\u7C7B\u5206\u7EC4\uFF0C\u70B9\u4E00\u6761\u5C31\u5230\u5B83\u539F\u6765\u7684\u4F4D\u7F6E\uFF0C\u4E0D\u5728\u641C\u7D22\u9875\u91CC\u590D\u5236\u4E00\u5957\u8BE6\u60C5\u3002",
      count: "\u63D0\u4EA4 50 \u6761 \xB7 \u5206\u652F 62 \u6761 \xB7 \u6807\u7B7E 40 \u4E2A"
    }
  };
  var VIEW_LABEL = {
    changes: "\u6539\u52A8",
    commits: "\u5386\u53F2",
    worktrees: "\u5DE5\u4F5C\u6811",
    stash: "\u6536\u8D77\u7684\u6539\u52A8"
  };
  var LEVEL_LABEL = {
    "\u8BFB": "\u8BFB",
    "\u5199": "\u5199",
    "\u6539\u5199": "\u6539\u5199",
    "\u6BC1": "\u6BC1",
    "\u975E git": "\u975E git"
  };
  function levelTone(level) {
    switch (level) {
      case "\u8BFB":
        return "muted";
      case "\u5199":
        return "info";
      case "\u6539\u5199":
        return "warn";
      case "\u6BC1":
        return "error";
      default:
        return "muted";
    }
  }
  var PLACEMENT_LABEL = {
    "\u76F4": "\u76F4\u63A5\u64CD\u4F5C",
    "\u6298": "\u6298\u8FDB\u6D41\u7A0B",
    "\u8BCA": "\u53EA\u8BFB\u8BCA\u65AD",
    "\u5916": "\u9762\u677F\u4E4B\u5916"
  };
  var PLACEMENT_HINT = {
    "\u76F4": "\u5728\u4E3B\u754C\u9762\u4E0A\u4E00\u4E24\u4E0B\u5C31\u80FD\u5B8C\u6210\uFF0C\u52A8\u4F5C\u957F\u5728\u5BF9\u8C61\u4E0A\u3002",
    "\u6298": "\u8981\u6536\u8FDB\u591A\u6B65\u6D41\u7A0B\u6216\u786E\u8BA4\u5361\uFF0C\u4E0D\u6446\u5728\u7B2C\u4E00\u5C4F\u3002",
    "\u8BCA": "\u9762\u677F\u53EA\u5C55\u793A\u8BFB\u5230\u7684\u7ED3\u679C\u4E0E\u547D\u4EE4\uFF0C\u4E0D\u7ED9\u53EF\u64CD\u4F5C\u6309\u94AE\u3002",
    "\u5916": "\u9762\u677F\u53EA\u89E3\u91CA\u53BB\u54EA\u91CC\u505A\uFF0C\u4E0D\u4EE3\u505A\u4E5F\u4E0D\u6301\u6709\u51ED\u636E\u3002"
  };
  var MANAGE_CARD_ORDER = ["branch-tags", "remote", "submodules", "maintenance", "migrate", "config", "hooks", "diagnostics", "platform"];
  var CAP_SAFE_NOTE = "\u4E0D\u4F1A\u6539\u52A8\u5DE5\u4F5C\u533A\u6587\u4EF6\uFF0C\u4E0D\u4F1A\u6539\u5199\u5DF2\u6709\u63D0\u4EA4\uFF0C\u4E5F\u4E0D\u4F1A\u66FF\u4F60\u63A8\u9001\u5230\u8FDC\u7AEF\u3002";

  // docs/prototype/vc-redesign/src/ui/dom.ts
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props !== null) {
      if (props.class !== void 0) node.className = props.class;
      if (props.text !== void 0) node.textContent = props.text;
      if (props.title !== void 0) node.title = props.title;
      if (props.id !== void 0) node.id = props.id;
      if (props.role !== void 0) node.setAttribute("role", props.role);
      if (props.attrs !== void 0) {
        for (const [name, value] of Object.entries(props.attrs)) {
          if (value === null || value === void 0 || value === false) continue;
          node.setAttribute(name, value === true ? "" : String(value));
        }
      }
      if (props.dataset !== void 0) {
        for (const [name, value] of Object.entries(props.dataset)) {
          if (value === void 0) continue;
          node.dataset[name] = String(value);
        }
      }
      if (props.on !== void 0) {
        for (const [name, handler] of Object.entries(props.on)) {
          if (handler !== void 0) node.addEventListener(name, handler);
        }
      }
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }
  function clear(node) {
    while (node.firstChild !== null) node.removeChild(node.firstChild);
  }
  var ICON_PATHS = {
    chevron: "M6 9l6 6 6-6",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    copy: "M8 8h10v12H8zM6 16H4V4h12v2",
    check: "M4 12l5 5L20 6",
    alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
    back: "M20 12H5M11 6l-6 6 6 6",
    folder: "M3 6h7l2 3h9v10H3z",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    commit: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 12h5M16 12h5",
    branch: "M6 3v18M6 9c0 4 6 4 6 8M12 9h4M16 7a2 2 0 1 0 0 .1M9 5a2 2 0 1 1 0 .1",
    // 四角星：AI 交接的入口记号；刻意不用机器人头像，避免读者以为这是另一个终端。
    spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
    close: "M6 6l12 12M18 6L6 18",
    // 放大镜：命令面板入口。
    search: "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14M16.5 16.5L21 21",
    // 齿轮：管理索引入口。画成三段同心线，缩到 14 像素也还认得出是设置。
    settings: "M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14.1 2h-4.2l-.4 3a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 3h4.2l.4-3a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"
  };
  function icon(kind, size = 14) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[kind]);
    svg.append(path);
    return svg;
  }
  function spinner() {
    return h("span", { class: "spinner", attrs: { "aria-hidden": "true" } });
  }

  // docs/prototype/vc-redesign/src/ui/primitives.ts
  function button(options) {
    const busy = options.busy === true;
    const classes = ["btn", `btn-${options.kind ?? "secondary"}`, `btn-${options.size ?? "md"}`];
    if (options.disabled === true && !busy) classes.push("is-disabled");
    if (busy) classes.push("is-busy");
    const node = h("button", {
      class: classes.join(" "),
      attrs: {
        type: "button",
        disabled: options.disabled === true || busy,
        "aria-busy": busy ? "true" : null,
        "aria-describedby": options.describedBy ?? null,
        title: options.title ?? null,
        ...options.focusKey === void 0 ? {} : { "data-focus-key": options.focusKey }
      },
      dataset: {
        action: options.action,
        ...options.dataset ?? {}
      }
    });
    if (busy) node.append(spinner());
    if (options.icon !== void 0) node.append(icon(options.icon, 13));
    node.append(h("span", { class: "btn-label", text: busy ? options.busyLabel ?? options.label : options.label }));
    return node;
  }
  function chip(text, tone, options = {}) {
    const classes = ["chip", `chip-${tone}`];
    if (options.small === true) classes.push("chip-sm");
    if (options.mono === true) classes.push("mono");
    return h("span", { class: classes.join(" "), text, title: options.title });
  }
  function syncDelta(items, options = {}) {
    const root2 = h("span", {
      class: `sync-delta${options.compact === true ? " is-compact" : ""}`,
      attrs: { role: "group", "aria-label": items.map((item) => item.hint).join("\uFF0C") }
    });
    items.forEach((item, index) => {
      if (index > 0) root2.append(h("span", { class: "sync-delta-sep", attrs: { "aria-hidden": "true" } }));
      root2.append(h(
        "span",
        {
          class: `sync-delta-item is-${item.kind}${item.value === 0 ? " is-zero" : ""}`,
          attrs: { title: item.hint, "aria-label": item.hint }
        },
        h("span", { class: "sync-delta-label", text: item.label }),
        h("span", { class: "sync-delta-num", text: String(item.value) })
      ));
    });
    return root2;
  }
  function badgeLetter(letter, tone, title) {
    return h("span", { class: `badge badge-${tone}`, text: letter, title });
  }
  function resultBanner(result) {
    const sourceLabel = {
      sync: "\u540C\u6B65\u52A8\u4F5C",
      reload: "\u91CD\u65B0\u8BFB\u53D6",
      commit: "\u63D0\u4EA4",
      copy: "\u590D\u5236",
      ai: "AI \u4EA4\u63A5",
      branch: "\u5206\u652F\u52A8\u4F5C",
      worktree: "\u5DE5\u4F5C\u6811\u52A8\u4F5C",
      changes: "\u6539\u52A8\u52A8\u4F5C",
      history: "\u63D0\u4EA4\u52A8\u4F5C",
      stash: "\u6536\u8D77\u52A8\u4F5C"
    };
    return h(
      "div",
      {
        class: `result result-${result.tone}`,
        attrs: { role: "status", "aria-live": "polite" }
      },
      h("span", { class: "result-tag", text: sourceLabel[result.source] }),
      h("span", { class: "result-text", text: result.text }),
      result.detail === null ? null : h("span", { class: "result-detail", text: result.detail }),
      h(
        "button",
        {
          class: "result-close",
          attrs: { type: "button", "aria-label": "\u5173\u95ED\u8FD9\u6761\u7ED3\u679C" },
          dataset: { action: "result-dismiss" },
          on: {}
        },
        "\xD7"
      )
    );
  }
  function emptyState(title, hint, extra) {
    return h(
      "div",
      { class: "empty" },
      h("div", { class: "empty-title", text: title }),
      hint === null ? null : h("div", { class: "empty-hint", text: hint }),
      extra === void 0 ? null : extra
    );
  }
  var PATCH_CLASS = {
    add: "diff-add",
    del: "diff-del",
    context: "diff-ctx",
    hunk: "diff-hunk",
    filehead: "diff-head",
    "no-newline": "diff-note"
  };
  function patchBlock(lines) {
    const block = h("pre", { class: "patch", attrs: { "aria-label": "\u793A\u4F8B\u9010\u884C\u5DEE\u5F02" } });
    for (const line of lines) {
      block.append(h("code", { class: `diff-line ${PATCH_CLASS[line.kind]}`, text: line.text === "" ? " " : line.text }));
    }
    return block;
  }
  function note(text, tone = "muted") {
    return h("span", { class: `note note-${tone}`, text });
  }

  // docs/prototype/vc-redesign/src/ui/rail.ts
  function renderRail(model, result, options = {}) {
    const pageOpen = options.pageOpen === true;
    const rail = h("header", { class: "rail" + (pageOpen ? " is-page" : ""), attrs: { "aria-label": "\u4ED3\u5E93\u72B6\u6001" } });
    const idRow = h("div", { class: "rail-row rail-id" });
    const idMain = h("div", { class: "rail-id-main" });
    idMain.append(h("span", { class: "rail-repo mono", text: model.worktreeDisplay, title: model.worktreePath }));
    if (model.branch === null) {
      idMain.append(chip(COPY.rail.detached, "warn", { small: true }));
    } else {
      idMain.append(
        h("span", { class: "rail-slash", text: "/", attrs: { "aria-hidden": "true" } }),
        h(
          "button",
          {
            class: "rail-branch-btn",
            attrs: {
              type: "button",
              title: COPY.rail.branchHint,
              "aria-label": `\u5F53\u524D\u5206\u652F ${model.branch}\u3002${COPY.rail.branchHint}`,
              "data-focus-key": "branch-open"
            },
            dataset: { action: "branch-open" }
          },
          h("span", { class: "rail-branch mono", text: model.branch }),
          h("span", { class: "rail-branch-chevron", attrs: { "aria-hidden": "true" } }, icon("chevron", 11))
        )
      );
    }
    if (model.oidShort !== null) {
      idMain.append(h("span", { class: "rail-oid mono", text: model.oidShort, title: "\u5F53\u524D\u63D0\u4EA4\u7684\u77ED\u53F7" }));
    }
    const tools = h("div", { class: "rail-tools", attrs: { role: "group", "aria-label": "\u5168\u5C40\u5165\u53E3" } });
    tools.append(
      h("button", {
        class: "icon-btn",
        attrs: { type: "button", "aria-label": COPY.rail.copyRepoPath, title: COPY.rail.copyRepoPath, "data-focus-key": "copy-repo" },
        dataset: { action: "copy-repo" }
      }, icon("copy", 14)),
      h("button", {
        class: "icon-btn",
        attrs: { type: "button", "aria-label": "\u628A\u5F53\u524D\u72B6\u6001\u4EA4\u7ED9 AI", title: "\u4EA4\u7ED9 AI\uFF1A\u628A\u4ED3\u5E93\u72B6\u6001\u3001\u5F53\u524D\u8FD9\u4E00\u9875\u548C\u96BE\u5904\u6574\u7406\u6210\u4E00\u6BB5\u53EF\u590D\u5236\u7684\u4EA4\u63A5\u8BF4\u660E", "data-focus-key": "handoff-general" },
        dataset: { action: "handoff-open", kind: "general" }
      }, icon("spark", 14)),
      h("button", {
        class: "icon-btn",
        attrs: { type: "button", "aria-label": "\u547D\u4EE4\u9762\u677F\uFF1A\u641C\u7D22\u5168\u90E8 162 \u6761\u80FD\u529B", title: "\u547D\u4EE4\u9762\u677F\uFF08Ctrl/\u2318+K\uFF09\uFF1A\u6309\u540D\u79F0\u3001\u7F16\u53F7\u6216\u547D\u4EE4\u641C\u80FD\u529B", "data-focus-key": "palette-open" },
        dataset: { action: "palette-open" }
      }, icon("search", 14)),
      h("button", {
        class: "icon-btn" + (options.manageActive === true ? " is-on" : ""),
        attrs: {
          type: "button",
          "aria-label": "\u6253\u5F00\u7BA1\u7406\uFF1A\u5206\u652F\u4E0E\u8FDC\u7AEF\u3001\u7EF4\u62A4\u3001\u8BCA\u65AD\u7B49\u4E5D\u4E2A\u5206\u533A",
          title: "\u7BA1\u7406\uFF08\u5206\u652F\u4E0E\u8FDC\u7AEF\u3001\u5B50\u6A21\u5757\u3001\u7EF4\u62A4\u3001\u8FC1\u79FB\u3001\u914D\u7F6E\u3001\u94A9\u5B50\u3001\u8BCA\u65AD\u3001\u5E73\u53F0\uFF09",
          "data-focus-key": "manage-open",
          "aria-current": options.manageActive === true ? "page" : null
        },
        dataset: { action: "page-open", page: "manage" }
      }, icon("settings", 14))
    );
    idRow.append(idMain, tools);
    rail.append(idRow);
    if (pageOpen) {
      if (result !== null) rail.append(resultBanner(result));
      return rail;
    }
    const syncRow = h("div", { class: "rail-row rail-sync" });
    if (model.sync.kind === "counts") {
      syncRow.append(syncDelta(model.syncChips.map((item) => ({
        kind: item.kind,
        label: item.label,
        value: item.value,
        hint: COPY.rail.syncHint(item.label, item.value)
      }))));
    } else {
      syncRow.append(chip(model.sync.text, model.sync.tone === "warn" ? "warn" : "muted", { small: true }));
    }
    syncRow.append(
      h(
        "span",
        { class: "fact" },
        h("span", { class: "fact-k", text: "\u8BFB\u53D6\u4E8E" }),
        h("span", { class: "fact-v", text: model.readAtText, attrs: { title: COPY.rail.readHint } })
      ),
      // 「远端依据」改成入口，标签带上远端名：读者一眼能看出这个时间是跟哪个远端比的。
      h(
        "button",
        {
          class: "fact fact-btn",
          attrs: { type: "button", "data-focus-key": "basis-open", title: COPY.rail.basisHint + "\u3002\u70B9\u5F00\u67E5\u770B\u8FDC\u7AEF\u6E05\u5355\u4E0E\u540C\u6B65\u8BFB\u6570" },
          dataset: { action: "page-open", page: "remote" }
        },
        h("span", { class: "fact-k", text: model.remoteName === null ? "\u8FDC\u7AEF\u4F9D\u636E" : `\u8FDC\u7AEF ${model.remoteName}` }),
        h("span", { class: "fact-v", text: model.basisText })
      )
    );
    syncRow.append(
      h("button", {
        class: `icon-text-btn${model.reloading ? " is-busy" : ""}`,
        attrs: {
          type: "button",
          "data-focus-key": "reload",
          disabled: model.reloading || model.busy !== null,
          "aria-busy": model.reloading ? "true" : null,
          title: `${COPY.rail.reload}\uFF08${COPY.rail.readAt(model.readAtText)}\uFF09`
        },
        dataset: { action: "reload" }
      }, icon("refresh", 13), h("span", { text: model.reloading ? COPY.rail.reloadBusy : COPY.rail.reload }))
    );
    const actRow = h("div", { class: "rail-row rail-acts" });
    actRow.append(
      button({ label: model.pull.label, kind: "secondary", size: "sm", disabled: model.pull.disabled, busy: model.busy === "pull", busyLabel: COPY.busy.pull, title: model.pull.reason, action: "pull", focusKey: "pull" })
    );
    actRow.append(
      button({ label: model.fetch.label, kind: "ghost", size: "sm", disabled: model.fetch.disabled, busy: model.busy === "fetch" || model.reloading, busyLabel: COPY.busy.fetch, title: model.fetch.reason, action: "fetch", focusKey: "fetch" })
    );
    const pushButton = button({ label: model.push.label, kind: "secondary", size: "sm", disabled: model.push.disabled, busy: model.busy === "push", busyLabel: COPY.busy.push, title: model.push.reason, action: "push", focusKey: "push" });
    if (model.push.primary) pushButton.classList.add("is-suggested");
    actRow.append(pushButton);
    const nextChip = h(
      "span",
      { class: `next-step next-${model.nextTone}`, attrs: { title: COPY.rail.nextHint } },
      h("span", { class: "next-k", text: COPY.rail.next }),
      h("span", { class: "next-v", text: model.next })
    );
    actRow.append(nextChip);
    const reasons = h("div", { class: "rail-reasons" });
    const rows = [
      [COPY.actions.pull, model.pull],
      [COPY.actions.push, model.push]
    ];
    for (const [label, action] of rows) {
      if (action.reason === null) continue;
      reasons.append(h(
        "div",
        { class: `reason${action.disabled ? " is-block" : " is-warn"}` },
        h("span", { class: "reason-k", text: label }),
        h("span", { class: "reason-v", text: action.reason })
      ));
    }
    rail.append(syncRow, actRow);
    if (reasons.childElementCount > 0) rail.append(reasons);
    if (result !== null) rail.append(resultBanner(result));
    return rail;
  }

  // docs/prototype/vc-redesign/src/ui/views/handoff.ts
  function renderHandoffSheet(model) {
    const { draft, copied } = model;
    const layer = h("div", { class: "handoff-layer is-pop" });
    layer.append(h("div", {
      class: "handoff-backdrop",
      attrs: { "aria-hidden": "true" },
      dataset: { action: "handoff-close" }
    }));
    const sheet = h("section", {
      class: "handoff-sheet is-pop",
      attrs: {
        role: "dialog",
        "aria-labelledby": "handoff-title",
        "aria-describedby": "handoff-lede"
      }
    });
    const head = h(
      "header",
      { class: "handoff-head" },
      h("p", { class: "handoff-kicker mono", text: COPY.ai.kicker }),
      h("h2", { class: "handoff-title", id: "handoff-title", text: draft.title }),
      h("button", {
        class: "icon-btn handoff-close",
        attrs: {
          type: "button",
          title: COPY.ai.closeTitle,
          "aria-label": COPY.ai.closeTitle,
          "data-focus-key": "handoff-close"
        },
        dataset: { action: "handoff-close" }
      }, icon("close", 14))
    );
    const prompt = h("pre", {
      class: "handoff-prompt",
      attrs: { tabindex: 0, "aria-label": "\u4EA4\u7ED9 AI \u7684\u8BF4\u660E\u5168\u6587" }
    });
    prompt.textContent = draft.prompt;
    const foot = h("footer", { class: "handoff-foot" });
    if (copied) foot.append(h("p", { class: "handoff-copied", attrs: { role: "status" } }, icon("check", 13), h("span", { text: COPY.ai.copied(draft.charCount) })));
    else foot.append(h("p", { class: "handoff-hint", text: COPY.ai.footNote }));
    foot.append(h(
      "div",
      { class: "handoff-actions" },
      button({ label: COPY.ai.closeLabel, kind: "ghost", size: "md", action: "handoff-close", focusKey: "handoff-close-2" }),
      button({
        label: COPY.ai.copyLabel,
        kind: "primary",
        size: "md",
        action: "handoff-copy",
        focusKey: "handoff-copy",
        title: COPY.ai.footNote
      })
    ));
    sheet.append(
      head,
      h("p", { class: "handoff-lede", id: "handoff-lede", text: draft.lede }),
      prompt,
      foot
    );
    layer.append(sheet);
    return layer;
  }
  function handoffEntry(label, kind) {
    const node = h("button", {
      class: "ai-entry ai-entry-inline",
      attrs: {
        type: "button",
        title: COPY.ai.entryAria(label),
        "aria-label": COPY.ai.entryAria(label),
        "data-focus-key": `handoff-${kind}`
      },
      dataset: { action: "handoff-open", kind }
    }, icon("spark", 14), h("span", { class: "ai-entry-label", text: label }));
    return node;
  }

  // docs/prototype/vc-redesign/src/ui/views/changes.ts
  function renderChanges(model, result) {
    const view = h("div", { class: "view view-changes" });
    const filterRow = h("div", { class: "stats", attrs: { role: "group", "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009" } });
    for (const stat of model.stats) {
      const active = model.filter === stat.id;
      filterRow.append(
        h(
          "button",
          {
            class: `stat tone-${stat.tone}${active ? " is-on" : ""}`,
            attrs: {
              type: "button",
              "aria-pressed": active ? "true" : "false",
              "data-focus-key": `filter-${stat.id}`,
              title: active ? "\u518D\u70B9\u4E00\u6B21\u663E\u793A\u5168\u90E8\u5206\u7EC4" : `\u53EA\u770B${stat.label}`
            },
            dataset: { action: "filter", filter: stat.id }
          },
          h("span", { class: "stat-n", text: String(stat.count) }),
          h("span", { class: "stat-t", text: stat.label })
        )
      );
    }
    const list = h("div", { class: "changes-scroll" });
    if (result !== null && result.source === "changes") list.append(resultBanner(result));
    if (model.ignoredNote !== null) list.append(h("div", { class: "changes-note" }, note(model.ignoredNote, "muted")));
    if (model.empty) {
      list.append(emptyState(COPY.changes.emptyTitle, COPY.changes.emptyHint));
    } else {
      for (const group of model.groups) list.append(renderGroup(group, model));
    }
    const composer = h("div", { class: "composer" });
    if (result !== null && result.source === "commit") composer.append(resultBanner(result));
    const stashBtn = h("button", {
      class: `link-btn${model.canStash ? "" : " is-disabled"}`,
      attrs: {
        type: "button",
        "data-focus-key": "stash-create",
        title: model.canStash ? COPY.changes.stashHint : model.stashReason ?? COPY.changes.stashBlocked,
        disabled: !model.canStash
      },
      dataset: { action: "stash-create" }
    }, COPY.changes.stashAction);
    const stagedLine = h(
      "div",
      { class: "composer-head" },
      h(
        "span",
        { class: "composer-count" },
        h("span", { class: "count", text: String(model.composer.stagedCount) }),
        h("span", { class: "unit", text: "\u4E2A\u6587\u4EF6\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4" })
      ),
      h(
        "span",
        { class: "composer-links" },
        model.canUnstageAll ? h("button", {
          class: "link-btn",
          attrs: { type: "button", "data-focus-key": "unstage-all" },
          dataset: { action: "unstage-all" }
        }, COPY.actions.unstageAll) : null,
        stashBtn
      )
    );
    const textarea = h("textarea", {
      class: "commit-input",
      attrs: {
        id: "commit-message",
        rows: 2,
        placeholder: model.composer.placeholder,
        "data-field": "message",
        "data-focus-key": "commit-message",
        "aria-label": "\u63D0\u4EA4\u8BF4\u660E",
        "aria-describedby": "commit-hint"
      }
    });
    textarea.value = model.composer.message;
    const commitButton = button({
      label: COPY.changes.commitLabel(model.composer.stagedCount),
      kind: "primary",
      size: "md",
      disabled: model.composer.disabled,
      busy: model.composer.busy,
      busyLabel: COPY.busy.commit,
      title: model.composer.disabledReason,
      action: "commit",
      focusKey: "commit"
    });
    const footLeft = model.composer.disabledReason === null ? h("span", { class: "hint-text", text: model.composer.hint }) : h(
      "span",
      { class: "composer-reason", id: "commit-reason" },
      icon("alert", 12),
      h("span", { text: model.composer.disabledReason })
    );
    const foot = h(
      "div",
      { class: "composer-foot", id: "commit-hint" },
      footLeft,
      handoffEntry(HANDOFF_ENTRY.changes, "changes"),
      commitButton
    );
    composer.append(stagedLine, textarea, foot);
    view.append(filterRow, list, composer);
    return view;
  }
  function renderGroup(group, model) {
    const section2 = h("section", { class: `group group-${group.id}` });
    if (group.rows.length === 0) {
      section2.append(h(
        "div",
        { class: "group-empty" },
        h("span", { class: "group-empty-text", text: group.emptyText })
      ));
      return section2;
    }
    const head = h(
      "div",
      { class: "group-head" },
      h("span", { class: "group-title", text: group.label }),
      h("span", { class: "group-count", text: String(group.rows.length) })
    );
    const actions = h("div", { class: "group-actions" });
    if (group.id === "staged" && model.canUnstageAll) {
      actions.append(h("button", {
        class: "group-action",
        attrs: { type: "button", "aria-label": COPY.actions.unstageAll },
        dataset: { action: "unstage-all" }
      }, COPY.actions.unstageAll));
    }
    if (group.id === "unstaged") {
      const blocked = model.conflictCount > 0;
      actions.append(h("button", {
        class: `group-action${blocked ? " is-disabled" : ""}`,
        attrs: {
          type: "button",
          disabled: !model.canStageAll || blocked,
          title: blocked ? COPY.block["conflicts-unresolved"] : null,
          "aria-label": COPY.actions.stageAll
        },
        dataset: { action: "stage-all" }
      }, COPY.actions.stageAll));
      if (model.canDiscardAll) {
        actions.append(h("button", {
          class: "group-action is-danger",
          attrs: { type: "button", "aria-label": COPY.changes.discardAll, title: "\u628A\u5168\u90E8\u672A\u52A0\u5165\u7684\u6539\u52A8\u4E22\u5F03\uFF08\u4E0D\u80FD\u64A4\u56DE\uFF09" },
          dataset: { action: "changes-pending", kind: "discard-all" }
        }, COPY.changes.discardAll));
      }
    }
    if (actions.childElementCount > 0) head.append(actions);
    section2.append(head);
    if (model.pending !== null && model.pending.kind === "discard-all") section2.append(renderConfirmCard(model.pending));
    for (const row of group.rows) section2.append(renderFileRow(row, model));
    return section2;
  }
  function renderFileRow(row, model) {
    const pendingHere = model.pending !== null && model.pending.path === row.fullPath;
    const menuOpen = model.openMenuPath === row.fullPath;
    const rowNode = h("div", {
      class: `file-row${row.expanded ? " is-open" : ""}${row.conflict ? " is-conflict" : ""}${pendingHere ? " is-pending" : ""}`
    });
    const main = h("div", {
      class: "file-main",
      attrs: {
        role: "button",
        tabindex: 0,
        "aria-expanded": row.expanded ? "true" : "false",
        "aria-label": `${row.fullPath}\uFF1A${row.staged ? "\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4" : row.conflict ? "\u51B2\u7A81" : "\u672A\u52A0\u5165"}`,
        "data-focus-key": `row:${row.fullPath}`,
        title: row.fullPath
      },
      dataset: { action: "toggle-file", path: row.fullPath }
    });
    main.append(badgeLetter(row.badge.letter, row.badge.tone, row.conflict ? "\u51B2\u7A81\u6587\u4EF6" : "\u53D8\u66F4\u7C7B\u578B"));
    main.append(h(
      "span",
      { class: "file-path" },
      h("span", { class: "file-dir", text: row.dir }),
      h("span", { class: "file-name", text: row.name })
    ));
    if (row.extraBadges.length > 0) {
      const extras = h("span", { class: "file-extras" });
      for (const text of row.extraBadges) extras.append(chip(text, row.conflict ? "error" : text === COPY.changes.stagedBadge ? "ok" : "muted", { small: true }));
      main.append(extras);
    }
    if (row.delta !== null) {
      main.append(h(
        "span",
        { class: "file-delta" },
        row.delta.added === null ? null : h("span", { class: "dl-add", text: row.delta.added }),
        row.delta.deleted === null ? null : h("span", { class: "dl-del", text: row.delta.deleted })
      ));
    }
    main.append(h("span", { class: `row-chevron${row.expanded ? " is-open" : ""}`, attrs: { "aria-hidden": "true" } }, icon("chevron", 12)));
    const actions = h("span", { class: "file-actions" });
    if (row.canStage) {
      actions.append(h("button", {
        class: "row-act",
        attrs: { type: "button", title: `\u628A ${row.name} \u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4`, "data-focus-key": `stage:${row.fullPath}` },
        dataset: { action: "stage", path: row.fullPath }
      }, COPY.actions.stage));
    } else if (row.canUnstage) {
      actions.append(h("button", {
        class: "row-act",
        attrs: { type: "button", title: `\u628A ${row.name} \u79FB\u51FA\u8FD9\u6B21\u63D0\u4EA4`, "data-focus-key": `unstage:${row.fullPath}` },
        dataset: { action: "unstage", path: row.fullPath }
      }, COPY.actions.unstage));
    }
    if (row.showMenu) {
      actions.append(h("button", {
        class: `row-act row-more${menuOpen ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "aria-haspopup": "true",
          "aria-expanded": menuOpen ? "true" : "false",
          "aria-label": COPY.changes.menuOpen,
          title: COPY.changes.menuOpen,
          "data-focus-key": `more:${row.fullPath}`
        },
        dataset: { action: "changes-open-menu", path: row.fullPath }
      }, h("span", { class: "row-more-dots", text: "\u22EF", attrs: { "aria-hidden": "true" } })));
    }
    rowNode.append(main, actions);
    const wrap = h("div", { class: "file-row-wrap" }, rowNode);
    if (menuOpen) wrap.append(renderRowMenu(row, model));
    if (pendingHere && model.pending !== null) wrap.append(renderConfirmCard(model.pending));
    if (row.expanded) {
      const body = h("div", { class: "file-detail" });
      if (row.patch !== null) body.append(patchBlock(row.patch), h("div", { class: "file-detail-note", text: COPY.changes.patchNote }));
      else if (row.patchNote !== null) body.append(note(row.patchNote));
      wrap.append(body);
    }
    return wrap;
  }
  function renderRowMenu(row, model) {
    const menu = h("div", { class: "row-menu", attrs: { role: "menu", "aria-label": `${row.name} \u7684\u66F4\u591A\u64CD\u4F5C` } });
    const item = (label, action, dataset, danger = false) => h("button", {
      class: `row-menu-item${danger ? " is-danger" : ""}`,
      attrs: { type: "button", role: "menuitem", "data-focus-key": `menu:${row.fullPath}:${action}:${dataset.kind ?? ""}` },
      dataset: { action, ...dataset }
    }, label);
    if (row.canDiscard) menu.append(item(COPY.changes.menuDiscard, "changes-pending", { kind: "discard", path: row.fullPath }, true));
    if (row.canIgnore) menu.append(item(COPY.changes.menuIgnore, "changes-pending", { kind: "ignore", path: row.fullPath }));
    if (row.canDeleteUntracked) menu.append(item(COPY.changes.menuDelete, "changes-pending", { kind: "delete-untracked", path: row.fullPath }, true));
    if (row.resolvable) {
      menu.append(item(COPY.changes.menuResolveOurs, "changes-pending", { kind: "resolve-ours", path: row.fullPath }, true));
      menu.append(item(COPY.changes.menuResolveTheirs, "changes-pending", { kind: "resolve-theirs", path: row.fullPath }, true));
    }
    if (menu.childElementCount === 0) menu.append(note("\u8FD9\u4E00\u884C\u6CA1\u6709\u53EF\u7528\u7684\u884C\u7EA7\u52A8\u4F5C\u3002"));
    menu.append(h("button", {
      class: "row-menu-item is-close",
      attrs: { type: "button", "aria-label": COPY.changes.menuClose },
      dataset: { action: "changes-open-menu", path: "" }
    }, COPY.changes.menuClose));
    void model;
    return menu;
  }
  function renderConfirmCard(pending) {
    const card = h(
      "div",
      { class: `changes-confirm${pending.danger ? " is-danger" : " is-warn"}`, attrs: { role: "group", "aria-label": pending.title } },
      h("h3", { class: "changes-confirm-title", text: pending.title }),
      h("p", { class: "changes-confirm-body", text: pending.body })
    );
    if (pending.meta !== null) card.append(h("p", { class: "changes-confirm-meta", text: pending.meta }));
    card.append(h(
      "div",
      { class: "changes-confirm-actions" },
      button({ label: COPY.changes.confirmCancel, kind: "ghost", size: "sm", action: "changes-pending-cancel", focusKey: "changes-cancel" }),
      button({
        label: pending.confirmLabel,
        kind: pending.danger ? "danger" : "secondary",
        size: "sm",
        action: "changes-apply",
        focusKey: "changes-confirm"
      })
    ));
    return card;
  }

  // docs/prototype/vc-redesign/src/ui/views/branches.ts
  function renderBranches(model, result) {
    const view = h("div", { class: "view view-branches" });
    view.append(renderHead(model));
    if (model.sub === "create" || model.sub === "rename") {
      view.append(renderForm(model));
    } else if (model.sub === "detail" && model.selected !== null) {
      view.append(renderDetail(model.selected, model));
    } else {
      view.append(renderList(model));
    }
    if (result !== null) view.append(resultBanner(result));
    return view;
  }
  function renderHead(model) {
    const head = h("div", { class: "branch-head" });
    head.append(h("button", {
      class: "icon-text-btn",
      attrs: { type: "button", "data-focus-key": "branch-back", title: COPY.branches.back },
      dataset: { action: model.sub === "list" ? "branch-close" : "branch-sub", sub: "list" }
    }, icon("back", 13), h("span", { text: model.sub === "list" ? COPY.branches.back : COPY.branches.backList })));
    const title = model.sub === "detail" && model.selected !== null ? model.selected.row.name : model.sub === "create" ? COPY.branches.createTitle : model.sub === "rename" && model.selected !== null ? COPY.branches.renameTitle : COPY.branches.listTitle;
    head.append(h("h2", { class: "branch-title", text: title }));
    if (model.sub === "list") {
      head.append(
        h("span", { class: "branch-count", text: `${model.total}` }),
        h("span", { class: "branch-count-unit", text: "\u4E2A" })
      );
      head.append(h("span", { class: "branch-spacer" }));
      head.append(button({
        label: "\u6807\u7B7E\u4E0E\u4E0A\u6E38",
        kind: "ghost",
        size: "sm",
        action: "page-open",
        dataset: { page: "branch-tags" },
        focusKey: "branch-tags-open",
        title: "\u6253\u5F00\u300C\u5206\u652F\u4E0E\u8FDC\u7AEF\u300D\u9875\uFF1A40 \u4E2A\u6807\u7B7E\u300162 \u6761\u672C\u5730\u5206\u652F\u5404\u81EA\u8DDF\u5230\u54EA\u6761\u4E0A\u6E38\uFF0C\u90FD\u5728\u90A3\u91CC"
      }));
      head.append(button({
        label: COPY.branches.newBranch,
        kind: "secondary",
        size: "sm",
        action: "branch-sub",
        dataset: { sub: "create" },
        focusKey: "branch-new"
      }));
    }
    return head;
  }
  function renderList(model) {
    const wrap = h("div", { class: "branch-list-wrap" });
    const search = h("input", {
      class: "branch-search",
      attrs: {
        type: "search",
        value: model.query,
        placeholder: COPY.branches.searchPlaceholder,
        "aria-label": COPY.branches.searchPlaceholder,
        "data-focus-key": "branch-query"
      },
      dataset: { field: "branch-query" }
    });
    wrap.append(search);
    if (model.empty) {
      wrap.append(emptyState(COPY.branches.empty, null));
      return wrap;
    }
    const list = h("div", { class: "branch-scroll" });
    for (const row of model.rows) list.append(renderRow(model, row));
    wrap.append(list);
    wrap.append(h("div", { class: "branch-ai" }, handoffEntry(HANDOFF_ENTRY.branches, "branches")));
    return wrap;
  }
  function renderRow(model, row) {
    const sync = h("span", { class: "branch-sync" });
    if (row.ahead > 0) sync.append(h("span", { class: "branch-delta is-ahead", attrs: { title: COPY.branches.ahead(row.ahead), "aria-label": COPY.branches.ahead(row.ahead) } }, "\u2191" + row.ahead));
    if (row.behind > 0) sync.append(h("span", { class: "branch-delta is-behind", attrs: { title: COPY.branches.behind(row.behind), "aria-label": COPY.branches.behind(row.behind) } }, "\u2193" + row.behind));
    return h(
      "button",
      {
        class: `branch-row${row.current ? " is-current" : ""}${model.selected?.row.name === row.name && model.sub === "detail" ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "data-focus-key": `branch:${row.name}`,
          title: row.current ? `${row.name}\uFF1A\u5F53\u524D\u5206\u652F` : `\u67E5\u770B\u5206\u652F ${row.name}`
        },
        dataset: { action: "branch-select", name: row.name }
      },
      h(
        "span",
        { class: "branch-row-main" },
        h(
          "span",
          { class: "branch-row-name" },
          h("span", { class: "mono", text: row.name }),
          row.current ? chip(COPY.branches.current, "ok", { small: true }) : null
        ),
        h(
          "span",
          { class: "branch-row-meta" },
          h("span", { class: "mono branch-upstream", text: row.upstream ?? COPY.branches.noUpstream }),
          h("span", { class: "branch-when", text: row.when })
        )
      ),
      h(
        "span",
        { class: "branch-row-side" },
        sync,
        h("span", { class: "branch-chevron" }, icon("chevron", 12))
      )
    );
  }
  function renderDetail(detail, model) {
    const row = detail.row;
    const wrap = h("div", { class: "branch-detail" });
    if (row.ahead > 0 || row.behind > 0) {
      wrap.append(h("div", { class: "branch-detail-sync" }, syncDelta([
        { kind: "ahead", label: "\u9886\u5148", value: row.ahead, hint: COPY.branches.ahead(row.ahead) },
        { kind: "behind", label: "\u843D\u540E", value: row.behind, hint: COPY.branches.behind(row.behind) }
      ])));
    }
    wrap.append(renderFacts(row));
    const actions = h("div", { class: "branch-actions" });
    actions.append(button({
      label: COPY.branches.switch,
      kind: "secondary",
      size: "sm",
      disabled: !detail.canSwitch,
      title: detail.switchReason,
      action: "branch-switch",
      dataset: { name: row.name },
      focusKey: "branch-switch"
    }));
    actions.append(button({
      label: COPY.branches.merge,
      kind: "secondary",
      size: "sm",
      disabled: !detail.canMerge,
      title: detail.mergeReason,
      action: "branch-merge",
      dataset: { name: row.name },
      focusKey: "branch-merge"
    }));
    actions.append(button({
      label: COPY.branches.rebase,
      kind: "secondary",
      size: "sm",
      disabled: !detail.canRebase,
      title: detail.rebaseReason,
      action: "branch-rebase-start",
      dataset: { name: row.name },
      focusKey: "branch-rebase"
    }));
    actions.append(button({
      label: COPY.branches.rename,
      kind: "ghost",
      size: "sm",
      action: "branch-sub",
      dataset: { sub: "rename" },
      focusKey: "branch-rename"
    }));
    const danger = button({
      label: COPY.branches.delete,
      kind: "danger",
      size: "sm",
      disabled: !detail.canDelete,
      title: detail.deleteReason,
      action: "branch-delete-start",
      dataset: { name: row.name },
      focusKey: "branch-delete"
    });
    actions.append(danger);
    wrap.append(actions);
    if (detail.pending !== null) wrap.append(renderConfirm(detail.pending, model.currentName));
    else wrap.append(h("p", { class: "branch-hint", text: COPY.branches.mergeHint }));
    if (model.dirty) {
      wrap.append(h("p", { class: "branch-hint is-warn", text: "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8\uFF1A\u5207\u6362\u6216\u5408\u5E76\u4E4B\u524D\uFF0C\u5148\u60F3\u6E05\u695A\u8FD9\u4E9B\u6539\u52A8\u8981\u8DDF\u7740\u8D70\u8FD8\u662F\u8981\u7559\u5728\u539F\u5206\u652F\u3002" }));
    }
    return wrap;
  }
  function renderFacts(row) {
    const facts = h("dl", { class: "branch-facts" });
    const fact = (label, value, mono, title) => h(
      "div",
      { class: "branch-fact" },
      h("dt", { class: "branch-fact-k", text: label }),
      h("dd", { class: `branch-fact-v${mono ? " mono" : ""}`, text: value, attrs: title === void 0 ? {} : { title } })
    );
    facts.append(
      fact("\u4E0A\u6E38\u8DDF\u8E2A", row.upstream ?? COPY.branches.noUpstream, true),
      fact(COPY.branches.latestCommit, row.oidShort, true, row.subject),
      fact("\u63D0\u4EA4\u65F6\u95F4", row.when, false),
      fact("\u5408\u5E76\u72B6\u6001", row.merged ? COPY.branches.merged : COPY.branches.notMerged, false)
    );
    facts.append(h("p", { class: "branch-subject", text: row.subject }));
    return facts;
  }
  function renderConfirm(pending, currentName) {
    const isDelete = pending.kind === "delete";
    const isRebase = pending.kind === "rebase";
    const title = isDelete ? COPY.branches.deleteTitle(pending.name) : isRebase ? COPY.branches.rebaseTitle(currentName ?? "\u5F53\u524D\u5206\u652F", pending.name) : COPY.branches.switchDirtyTitle;
    const body = isDelete ? COPY.branches.deleteBody : isRebase ? COPY.branches.rebaseBody : COPY.branches.switchDirtyBody;
    const confirmLabel = isDelete ? COPY.branches.deleteConfirm : isRebase ? COPY.branches.rebaseConfirm : COPY.branches.switchConfirm;
    const confirmAction = isDelete ? "branch-delete-confirm" : isRebase ? "branch-rebase-confirm" : "branch-switch-confirm";
    return h(
      "div",
      { class: `branch-confirm${isDelete ? " is-danger" : " is-warn"}` },
      h("h3", { class: "branch-confirm-title", text: title }),
      h("p", { class: "branch-confirm-body", text: body }),
      h(
        "div",
        { class: "branch-confirm-actions" },
        button({
          label: COPY.branches.cancel,
          kind: "ghost",
          size: "sm",
          action: "branch-pending-cancel",
          focusKey: "branch-cancel"
        }),
        button({
          label: confirmLabel,
          kind: isDelete ? "danger" : "secondary",
          size: "sm",
          action: confirmAction,
          dataset: { name: pending.name },
          focusKey: "branch-confirm"
        })
      )
    );
  }
  function renderForm(model) {
    const isCreate = model.sub === "create";
    const wrap = h("div", { class: "branch-form" });
    wrap.append(h("p", { class: "branch-form-note", text: isCreate ? COPY.branches.createFrom(model.currentName ?? "") : model.selected?.row.name ?? "" }));
    wrap.append(h("label", { class: "branch-form-label", text: COPY.branches.branchLabel, attrs: { for: "branch-name-input" } }));
    const input = h("input", {
      class: "branch-input",
      attrs: {
        type: "text",
        id: "branch-name-input",
        value: model.draft,
        placeholder: isCreate ? COPY.branches.createPlaceholder : COPY.branches.renamePlaceholder,
        "aria-label": isCreate ? COPY.branches.createPlaceholder : COPY.branches.renamePlaceholder,
        "data-focus-key": "branch-draft"
      },
      dataset: { field: "branch-draft" }
    });
    wrap.append(input);
    wrap.append(h("p", { class: "branch-form-hint", text: COPY.branches.nameHint }));
    const actions = h("div", { class: "branch-form-actions" });
    actions.append(button({
      label: COPY.branches.cancel,
      kind: "ghost",
      size: "sm",
      action: "branch-sub",
      dataset: { sub: "list" },
      focusKey: "branch-cancel"
    }));
    actions.append(button({
      label: isCreate ? COPY.branches.create : COPY.branches.renameSubmit,
      kind: "primary",
      size: "sm",
      action: isCreate ? "branch-create" : "branch-rename-confirm",
      dataset: isCreate ? {} : { name: model.selected?.row.name ?? "" },
      focusKey: "branch-submit"
    }));
    wrap.append(actions);
    return wrap;
  }

  // docs/prototype/vc-redesign/src/ui/views/history.ts
  function renderHistory(model, options = {}) {
    if (model.detail !== null) return renderDetail2(model.detail, options);
    return renderList2(model, options);
  }
  function renderList2(model, options) {
    const view = h("div", { class: "view view-history" });
    const search = h("input", {
      class: "search-input",
      attrs: {
        type: "search",
        placeholder: COPY.history.searchPlaceholder(model.total),
        "aria-label": COPY.history.searchPlaceholder(model.total),
        autocomplete: "off",
        spellcheck: "false",
        "data-field": "history-query",
        "data-focus-key": "history-query"
      }
    });
    search.value = model.query;
    const mergeToggle = h("button", {
      class: `toggle-btn${model.mergeOnly ? " is-on" : ""}`,
      attrs: { type: "button", "aria-pressed": model.mergeOnly ? "true" : "false", "data-focus-key": "history-merge" },
      dataset: { action: "history-merge-only" }
    }, COPY.history.mergeOnly);
    const tools = h("div", { class: "history-tools" }, search, mergeToggle);
    const scope = h("div", { class: "history-scope", text: model.scopeText });
    const scroll = h("div", { class: "history-scroll" });
    if (options.result !== null && options.result !== void 0 && options.result.source === "history") {
      scroll.append(resultBanner(options.result));
    }
    if (model.empty) {
      scroll.append(emptyState(COPY.history.empty, null));
    } else {
      for (const row of model.rows) {
        if (row.group !== null) scroll.append(h("div", { class: "day-group", text: row.group }));
        scroll.append(renderCommitLine(row, model, options));
      }
    }
    view.append(tools, scope, scroll);
    return view;
  }
  function renderCommitLine(row, model, options) {
    const menuOpen = options.menuOid === row.oid;
    const line = h(
      "div",
      { class: "commit-line" },
      h(
        "div",
        {
          class: `commit-row${row.selected ? " is-selected" : ""}${menuOpen ? " is-menu" : ""}`,
          attrs: {
            role: "button",
            tabindex: 0,
            "aria-label": `${row.short} ${row.subject}`,
            "data-focus-key": `commit:${row.oid}`,
            title: row.subject
          },
          dataset: { action: "history-open", oid: row.oid }
        },
        h("span", { class: "commit-hash mono", text: row.short }),
        subjectNodeOf(row),
        h(
          "span",
          { class: "commit-meta" },
          h("span", { class: "commit-author", text: row.author }),
          h("span", { class: "commit-when", text: row.when }),
          row.filesCount > 0 ? h("span", { class: "commit-files", text: `${row.filesCount} \u4E2A\u6587\u4EF6` }) : null
        ),
        h("span", { class: "commit-chevron" }, icon("chevron", 12))
      ),
      h("button", {
        class: `commit-more${menuOpen ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "aria-haspopup": "true",
          "aria-expanded": menuOpen ? "true" : "false",
          "aria-label": COPY.history.menuOpen,
          title: COPY.history.menuOpen,
          "data-focus-key": `commit-more:${row.oid}`,
          disabled: options.busy === true
        },
        dataset: { action: "commit-menu", oid: row.oid }
      }, h("span", { text: "\u22EF", attrs: { "aria-hidden": "true" } }))
    );
    const wrap = h("div", { class: "commit-line-wrap" }, line);
    if (menuOpen) {
      const headOid = options.headOid ?? null;
      if (options.confirmOid === row.oid) {
        wrap.append(renderUndoConfirm(row, model));
      } else {
        wrap.append(renderCommitMenu(row, headOid));
      }
    }
    return wrap;
  }
  function renderCommitMenu(row, headOid) {
    const isHead = headOid !== null && headOid === row.oid;
    const menu = h("div", { class: "commit-menu", attrs: { role: "menu", "aria-label": `\u63D0\u4EA4 ${row.short} \u7684\u66F4\u591A\u64CD\u4F5C` } });
    const item = (label, action, dataset, options = {}) => h("button", {
      class: `row-menu-item${options.danger === true ? " is-danger" : ""}`,
      attrs: { type: "button", role: "menuitem", disabled: options.disabled === true, title: options.title ?? null, "aria-label": label },
      dataset: { action, ...dataset }
    }, label);
    menu.append(item(COPY.history.menuRevert, "commit-revert", { oid: row.oid }));
    if (!row.merge) menu.append(item(COPY.history.menuCherryPick, "commit-cherry-pick", { oid: row.oid }));
    else menu.append(item(COPY.history.menuCherryPick, "commit-cherry-pick", { oid: row.oid }, { disabled: true, title: "\u5408\u5E76\u63D0\u4EA4\u6709\u4E24\u4E2A\u7236\u63D0\u4EA4\uFF0C\u62E3\u9009\u65F6 git \u4E0D\u77E5\u9053\u8981\u5E26\u54EA\u4E00\u8FB9\u3002" }));
    menu.append(item(
      COPY.history.menuUndo,
      "commit-undo-start",
      { oid: row.oid },
      { disabled: !isHead, title: isHead ? COPY.history.undoBody : COPY.history.menuUndoHint, danger: true }
    ));
    menu.append(item(COPY.history.menuCopy, "copy-oid", { oid: row.oid }));
    menu.append(h("button", {
      class: "row-menu-item is-close",
      attrs: { type: "button", "aria-label": COPY.history.menuClose },
      dataset: { action: "commit-menu", oid: row.oid }
    }, COPY.history.menuClose));
    return menu;
  }
  function renderUndoConfirm(row, model) {
    void model;
    return h(
      "div",
      { class: "commit-confirm", attrs: { role: "group", "aria-label": COPY.history.undoTitle(row.subject) } },
      h("h3", { class: "commit-confirm-title", text: COPY.history.undoTitle(row.subject) }),
      h("p", { class: "commit-confirm-body", text: COPY.history.undoBody }),
      h("p", { class: "commit-confirm-note", text: COPY.history.undoNote }),
      h(
        "div",
        { class: "commit-confirm-actions" },
        button({ label: COPY.history.cancel, kind: "ghost", size: "sm", action: "commit-menu-close", focusKey: "commit-cancel" }),
        button({
          label: COPY.history.undoConfirm,
          kind: "danger",
          size: "sm",
          action: "commit-undo",
          dataset: { oid: row.oid },
          focusKey: "commit-undo-confirm"
        })
      )
    );
  }
  function subjectNodeOf(row) {
    if (!row.merge) return h("span", { class: "commit-subject", text: row.subject });
    return h(
      "span",
      { class: "commit-subject commit-subject-merge" },
      h("span", { class: "commit-merge-lead", text: COPY.history.mergeChip }),
      h("span", { class: "commit-merge-raw mono", text: row.subject })
    );
  }
  function renderDetail2(detail, options) {
    const view = h("div", { class: "view view-detail" });
    const head = h(
      "div",
      { class: "detail-head" },
      h("button", {
        class: "back-btn",
        attrs: { type: "button", "data-focus-key": "history-back" },
        dataset: { action: "history-back" }
      }, icon("back", 13), h("span", { text: COPY.actions.back }))
    );
    view.append(head);
    const scroll = h("div", { class: "detail-scroll" });
    if (detail.parents.length > 1) {
      scroll.append(
        h("h2", { class: "detail-subject", text: `${COPY.history.mergeChip}\u63D0\u4EA4` }),
        h("div", { class: "detail-subject-raw mono", text: detail.subject })
      );
    } else {
      scroll.append(h("h2", { class: "detail-subject", text: detail.subject }));
    }
    const meta = h("dl", { class: "detail-meta" });
    const row = (label, value) => h(
      "div",
      { class: "meta-row" },
      h("dt", { class: "meta-k", text: label }),
      h("dd", { class: "meta-v" }, value)
    );
    meta.append(
      row(COPY.history.hash, h("span", { class: "mono", text: detail.short, title: detail.oid })),
      row(COPY.history.author, detail.author),
      row(COPY.history.time, detail.when)
    );
    const parents = h("span", { class: "parents" });
    detail.parents.forEach((parent) => {
      parents.append(h("span", { class: "parent-hash mono", text: parent, attrs: { title: `\u7236\u63D0\u4EA4 ${parent}` } }));
    });
    meta.append(row(COPY.history.parents, parents));
    scroll.append(meta);
    const files = h("div", { class: "detail-files" });
    files.append(h("div", { class: "detail-files-head" }, COPY.history.changedFiles(detail.files.length)));
    if (detail.filesNote !== null) files.append(note(detail.filesNote, "muted"));
    for (const file of detail.files) {
      const fileNode = h("div", {
        class: `file-row commit-file${file.expanded ? " is-open" : ""}`,
        attrs: {
          role: "button",
          tabindex: 0,
          "aria-expanded": file.expanded ? "true" : "false",
          "aria-label": file.path,
          "data-focus-key": `history-file:${file.path}`,
          title: file.path
        },
        dataset: { action: "history-file", path: file.path }
      });
      fileNode.append(h(
        "span",
        { class: "file-path" },
        h("span", { class: "file-dir", text: file.dir }),
        h("span", { class: "file-name", text: file.name })
      ));
      fileNode.append(h(
        "span",
        { class: "file-delta" },
        file.delta.added === null ? null : h("span", { class: "dl-add", text: file.delta.added }),
        file.delta.deleted === null ? null : h("span", { class: "dl-del", text: file.delta.deleted })
      ));
      fileNode.append(h("span", { class: `row-chevron${file.expanded ? " is-open" : ""}` }, icon("chevron", 12)));
      files.append(fileNode);
      if (file.expanded) {
        const body = h("div", { class: "file-detail" });
        if (file.patch !== null) {
          body.append(patchBlock(file.patch));
          body.append(h("div", { class: "file-detail-note", text: file.binary ? "\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u539F\u578B\u4E0D\u6E32\u67D3\u5DEE\u5F02\u3002" : COPY.history.diffSampleNote }));
        } else {
          body.append(note("\u8FD9\u4E2A\u6269\u5C55\u540D\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u793A\u4F8B\u8865\u4E01\u3002"));
        }
        files.append(body);
      }
    }
    scroll.append(files);
    if (options.result !== null && options.result !== void 0 && options.result.source === "history") {
      scroll.append(resultBanner(options.result));
    }
    view.append(scroll);
    return view;
  }

  // docs/prototype/vc-redesign/src/ui/views/stash.ts
  function renderStash(model, result) {
    const view = h("div", { class: "view view-stash" });
    const head = h(
      "div",
      { class: "stash-head" },
      h(
        "div",
        { class: "stash-head-text" },
        h("h2", { class: "stash-title", text: COPY.stash.title }),
        h("p", { class: "stash-count", text: COPY.stash.lede })
      )
    );
    view.append(head);
    view.append(note(COPY.stash.boundary, "muted"));
    const scroll = h("div", { class: "stash-scroll" });
    if (result !== null && result.source === "stash") scroll.append(resultBanner(result));
    if (model.empty) {
      scroll.append(emptyState(COPY.stash.empty, COPY.stash.emptyHint));
    } else {
      for (const row of model.rows) scroll.append(renderStashRow(row, model));
    }
    view.append(scroll);
    return view;
  }
  function renderStashRow(row, model) {
    const wrap = h("div", { class: "stash-row-wrap" });
    const line = h("div", { class: "stash-row" });
    const main = h(
      "div",
      { class: "stash-main" },
      h(
        "div",
        { class: "stash-id-line" },
        h("span", { class: "stash-id mono", text: row.id }),
        h("span", { class: "stash-message", text: row.message, title: row.message })
      ),
      h("div", { class: "stash-meta", text: COPY.stash.entryMeta(row.when, row.filesCount) })
    );
    line.append(main);
    const actions = h("div", { class: "stash-actions" });
    actions.append(button({
      label: COPY.stash.apply,
      kind: "secondary",
      size: "sm",
      action: "stash-apply",
      dataset: { id: row.id },
      focusKey: `stash-apply:${row.id}`,
      title: COPY.stash.applyHint,
      disabled: model.busy
    }));
    actions.append(button({
      label: COPY.stash.pop,
      kind: "secondary",
      size: "sm",
      action: "stash-pop",
      dataset: { id: row.id },
      focusKey: `stash-pop:${row.id}`,
      title: COPY.stash.popHint,
      disabled: model.busy
    }));
    actions.append(button({
      label: COPY.stash.drop,
      kind: "ghost",
      size: "sm",
      action: "stash-pending",
      dataset: { kind: "drop", id: row.id },
      focusKey: `stash-drop:${row.id}`,
      title: COPY.stash.dropTitle(row.id),
      disabled: model.busy
    }));
    line.append(actions);
    wrap.append(line);
    const paths = h("div", { class: "stash-paths" });
    paths.append(h("p", { class: "stash-paths-note", text: COPY.stash.pathsNote }));
    const list = h("ul", { class: "stash-path-list" });
    for (const path of row.paths) list.append(h("li", { class: "stash-path mono", text: path, attrs: { title: path } }));
    paths.append(list);
    wrap.append(paths);
    if (model.pending !== null && model.pending.id === row.id) {
      wrap.append(h(
        "div",
        { class: "stash-confirm", attrs: { role: "group", "aria-label": model.pending.title } },
        h("p", { class: "stash-confirm-title", text: model.pending.title }),
        h("p", { class: "stash-confirm-body", text: model.pending.body }),
        h(
          "div",
          { class: "stash-confirm-actions" },
          button({ label: COPY.stash.cancel, kind: "ghost", size: "sm", action: "stash-pending-cancel", focusKey: "stash-cancel" }),
          button({
            label: COPY.stash.dropConfirm,
            kind: "danger",
            size: "sm",
            action: "stash-drop",
            dataset: { id: row.id },
            focusKey: `stash-drop-confirm:${row.id}`
          })
        )
      ));
    }
    return wrap;
  }

  // docs/prototype/vc-redesign/src/ui/views/worktrees.ts
  function renderWorktrees(model, result, options) {
    const view = h("div", { class: "view view-worktrees" });
    if (options.noticeOpen) view.append(renderNotice(model));
    view.append(renderCurrent(model.current));
    view.append(renderHead2(model, options, options.noticeOpen));
    const rows = options.filter === "abnormal" ? model.others.filter((row) => row.abnormal) : model.others;
    const list = h("div", { class: "wt-list" });
    if (model.empty) {
      list.append(emptyState(COPY.worktrees.empty, COPY.worktrees.emptyHint));
    } else if (rows.length === 0) {
      list.append(emptyState(COPY.worktrees.filterEmpty, null));
    } else {
      for (const row of rows) list.append(renderRow2(row, options.expandedPath === row.path, model.pending));
    }
    view.append(list);
    view.append(h(
      "div",
      { class: "wt-foot" },
      handoffEntry(model.abnormalCount > 0 ? HANDOFF_ENTRY.worktrees : COPY.ai.cleanEntry, "worktrees")
    ));
    if (result !== null) view.append(resultBanner(result));
    return view;
  }
  function renderNotice(model) {
    return h(
      "aside",
      { class: "wt-notice", attrs: { role: "note" } },
      h("span", { class: "wt-notice-text", text: model.notice }),
      h("button", {
        class: "wt-notice-close",
        attrs: { type: "button", "aria-label": COPY.worktrees.noticeClose, title: COPY.worktrees.noticeClose },
        dataset: { action: "wt-note-close" }
      }, "\xD7")
    );
  }
  function renderCurrent(row) {
    if (row === null) return h("div", {});
    const head = h(
      "div",
      { class: "wt-current-head" },
      chip(COPY.worktrees.current, "ok", { small: true }),
      h("span", { class: "wt-name mono", text: row.name, title: row.path }),
      row.branch === null ? chip(COPY.worktrees.noBranch, "muted", { small: true }) : h("span", { class: "wt-branch", attrs: { title: `\u5206\u652F ${row.branch}` } }, h("span", { class: "mono", text: row.branch })),
      h("button", {
        class: "icon-btn wt-current-copy",
        attrs: {
          type: "button",
          title: COPY.worktrees.copyPath,
          "aria-label": `\u590D\u5236\u5F53\u524D\u5DE5\u4F5C\u6811\u8DEF\u5F84\uFF1A${row.path}`,
          "data-focus-key": `wt-copy:${row.path}`
        },
        dataset: { action: "worktree-copy", path: row.path }
      }, icon("copy", 14))
    );
    return h(
      "section",
      { class: "wt-current" },
      head,
      h("div", { class: "wt-current-path mono", text: row.path, title: row.path })
    );
  }
  function renderHead2(model, options, noticeOpen) {
    const head = h(
      "div",
      { class: "wt-head" },
      h("span", { class: "wt-head-title", text: "\u5176\u4ED6\u5DE5\u4F5C\u6811" }),
      h("span", { class: "wt-head-count", text: String(model.othersCount) }),
      h("span", { class: "wt-head-unit", text: COPY.units.worktree }),
      model.abnormalCount > 0 ? h("span", { class: "wt-head-alert", text: `\u5176\u4E2D ${model.abnormalCount} \u68F5\u9700\u8981\u5904\u7406` }) : null
    );
    const filters = h("div", { class: "wt-filters", attrs: { role: "group", "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009\u5DE5\u4F5C\u6811" } });
    filters.append(filterChip(COPY.worktrees.filterAll, String(model.othersCount), options.filter === "all", "all"));
    if (model.abnormalCount > 0) {
      filters.append(filterChip(COPY.worktrees.filterAbnormal, String(model.abnormalCount), options.filter === "abnormal", "abnormal"));
    }
    head.append(filters);
    if (!noticeOpen) {
      head.append(h("button", {
        class: "icon-btn wt-notice-open",
        attrs: {
          type: "button",
          title: COPY.worktrees.noticeOpen,
          "aria-label": COPY.worktrees.noticeOpen,
          "data-focus-key": "wt-note-open"
        },
        dataset: { action: "wt-note-open" }
      }, "?"));
    }
    return head;
  }
  function filterChip(label, count, on, filter) {
    return h(
      "button",
      {
        class: `filter-chip${filter === "abnormal" ? " tone-error" : " tone-ok"}${on ? " is-on" : ""}`,
        attrs: {
          type: "button",
          "aria-pressed": on ? "true" : "false",
          "data-focus-key": `wt-filter-${filter}`
        },
        dataset: { action: "wt-filter", filter }
      },
      h("span", { class: "filter-label", text: label }),
      h("span", { class: "filter-count", text: count })
    );
  }
  function renderRow2(row, expanded, pending) {
    const rowNode = h("div", {
      class: `wt-row${row.abnormal ? " is-abnormal" : ""}${expanded ? " is-open" : ""}`
    });
    const nameRow = h(
      "div",
      { class: "wt-name-row" },
      h("span", { class: "wt-name mono", text: row.name, title: row.path }),
      row.branch === null ? chip(COPY.worktrees.noBranch, "muted", { small: true }) : h("span", { class: "wt-branch", attrs: { title: `\u5206\u652F ${row.branch}` } }, h("span", { class: "mono", text: row.branch })),
      h("span", { class: "wt-oid mono", text: row.oidShort, title: "\u8FD9\u4E2A\u5DE5\u4F5C\u6811\u5F53\u524D\u6307\u5411\u7684\u63D0\u4EA4\u77ED\u53F7" })
    );
    const pathRow = h(
      "div",
      { class: "wt-path" },
      h("span", { class: "wt-path-dir mono", text: row.dir }),
      h("span", { class: "wt-path-name mono", text: row.name })
    );
    const stateRow = h("div", { class: "wt-states" });
    for (const state of row.states) stateRow.append(chip(state.label, state.tone, { small: true, title: state.detail ?? void 0 }));
    const actions = h(
      "div",
      { class: "wt-actions" },
      h("button", {
        class: "icon-btn",
        attrs: {
          type: "button",
          title: COPY.worktrees.copyPath,
          "aria-label": `${COPY.worktrees.copyPath}\uFF1A${row.path}`,
          "data-focus-key": `wt-copy:${row.path}`
        },
        dataset: { action: "worktree-copy", path: row.path }
      }, icon("copy", 14)),
      h("button", {
        class: `icon-btn wt-expander${expanded ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "aria-expanded": expanded ? "true" : "false",
          "aria-label": expanded ? COPY.worktrees.collapse : COPY.worktrees.expand,
          title: expanded ? COPY.worktrees.collapse : COPY.worktrees.expand,
          "data-focus-key": `wt-expand:${row.path}`
        },
        dataset: { action: "wt-expand", path: row.path }
      }, icon("chevron", 12))
    );
    rowNode.append(h("div", { class: "wt-main" }, nameRow, pathRow, stateRow), actions);
    const wrap = h("div", { class: "wt-row-wrap" }, rowNode);
    if (expanded) wrap.append(renderDetail3(row, pending));
    return wrap;
  }
  function renderDetail3(row, pending) {
    const detail = h("div", { class: `wt-detail${row.abnormal ? " is-abnormal" : ""}` });
    const fact = (label, value, mono) => h(
      "div",
      { class: "wt-fact" },
      h("span", { class: "wt-fact-k", text: label }),
      h("span", { class: `wt-fact-v${mono ? " mono" : ""}`, text: value, title: value })
    );
    detail.append(
      fact(COPY.worktrees.detailPath, row.path, true),
      fact(COPY.worktrees.detailBranch, row.branch ?? COPY.worktrees.noBranch, false),
      fact(COPY.worktrees.detailHead, row.oidShort, true)
    );
    const awaiting = pending !== null && pending.path === row.path;
    if (!awaiting) {
      for (const state of row.states) {
        if (state.detail === null) continue;
        detail.append(fact(state.label, state.detail, false));
      }
    }
    if (!awaiting) {
      const actions = h("div", { class: "wt-actions-row" });
      if (row.locked) {
        actions.append(button({
          label: COPY.worktrees.unlock,
          kind: "secondary",
          size: "sm",
          action: "wt-pending",
          dataset: { kind: "unlock", path: row.path, name: row.name },
          focusKey: `wt-unlock:${row.path}`
        }));
      }
      if (row.prunable) {
        actions.append(button({
          label: COPY.worktrees.pruneRecord,
          kind: "secondary",
          size: "sm",
          action: "wt-pending",
          dataset: { kind: "prune", path: row.path, name: row.name },
          focusKey: `wt-prune:${row.path}`
        }));
      }
      actions.append(button({
        label: COPY.worktrees.remove,
        kind: "danger",
        size: "sm",
        action: "wt-pending",
        dataset: { kind: "remove", path: row.path, name: row.name },
        focusKey: `wt-remove:${row.path}`
      }));
      detail.append(actions);
    }
    if (pending !== null && pending.path === row.path) {
      detail.append(h(
        "div",
        { class: `wt-confirm${pending.kind === "remove" ? " is-danger" : " is-warn"}` },
        h("h4", { class: "wt-confirm-title", text: pendingTitle(pending) }),
        h("p", { class: "wt-confirm-body", text: pendingBody(pending) }),
        h(
          "div",
          { class: "wt-confirm-actions" },
          button({
            label: COPY.worktrees.cancel,
            kind: "ghost",
            size: "sm",
            action: "wt-pending-cancel",
            focusKey: "wt-cancel"
          }),
          button({
            label: pending.kind === "unlock" ? COPY.worktrees.unlockConfirm : pending.kind === "prune" ? COPY.worktrees.pruneConfirm : COPY.worktrees.removeConfirm,
            kind: pending.kind === "remove" ? "danger" : "secondary",
            size: "sm",
            action: "wt-apply",
            dataset: { kind: pending.kind, path: pending.path, name: pending.name },
            focusKey: "wt-confirm"
          })
        )
      ));
    }
    return detail;
  }
  function pendingTitle(pending) {
    if (pending.kind === "unlock") return COPY.worktrees.unlockTitle;
    if (pending.kind === "prune") return COPY.worktrees.pruneTitle;
    return COPY.worktrees.removeTitle(pending.name);
  }
  function pendingBody(pending) {
    if (pending.kind === "unlock") return COPY.worktrees.unlockBody;
    if (pending.kind === "prune") return COPY.worktrees.pruneBody;
    return COPY.worktrees.removeBody;
  }

  // docs/prototype/vc-redesign/src/ui/views/page-shell.ts
  function pageShell(page, title, lede, count, body, options = {}) {
    const head = h("div", { class: "page-head" });
    const titleRow = h("div", { class: "page-title-row" });
    const titleNode = h("h2", { class: "page-title", text: title });
    if (options.focusKey !== void 0) {
      titleNode.setAttribute("tabindex", "-1");
      titleNode.setAttribute("data-focus-key", options.focusKey);
    }
    titleRow.append(
      h("button", {
        class: "page-back",
        attrs: { type: "button", "data-focus-key": "page-back", title: "\u8FD4\u56DE\u4E0A\u4E00\u9875\uFF08Esc \u4E5F\u53EF\u4EE5\uFF09", "aria-label": "\u8FD4\u56DE\u4E0A\u4E00\u9875" },
        dataset: { action: "page-back" }
      }, icon("back", 14), h("span", { class: "page-back-label", text: "\u8FD4\u56DE" })),
      titleNode
    );
    if (count !== null) titleRow.append(chip(count, "muted", { small: true }));
    if (options.danger === true) titleRow.append(chip("\u542B\u4E0D\u53EF\u9006\u52A8\u4F5C", "error", { small: true }));
    if (options.actions !== void 0 && options.actions.length > 0) {
      const actions = h("div", { class: "page-actions" });
      for (const action of options.actions) actions.append(action);
      titleRow.append(actions);
    }
    head.append(titleRow, h("p", { class: "page-lede", text: lede }));
    const scroll = h("div", { class: "page-scroll", attrs: { role: "region", "aria-label": title + "\u9875\u9762\u5185\u5BB9" } });
    scroll.append(body);
    return h("div", { class: "page page-" + page, attrs: { "data-page": page } }, head, scroll);
  }
  function section(title, count, note3, children, options = {}) {
    const node = h("section", { class: "page-section" + (options.danger === true ? " is-danger" : "") });
    if (options.id !== void 0) node.id = options.id;
    const head = h("div", { class: "section-head" });
    head.append(h("h3", { class: "section-title", text: title }));
    if (count !== null) head.append(h("span", { class: "section-count", text: count }));
    if (options.danger === true) head.append(chip("\u5371\u9669\u533A", "error", { small: true }));
    node.append(head);
    if (note3 !== null) node.append(h("p", { class: "section-note", text: note3 }));
    for (const child of children) node.append(child);
    return node;
  }
  function fold(key, title, count, open, children, note3 = null) {
    const node = h("div", { class: "fold" + (open ? " is-open" : "") });
    const head = h("button", {
      class: "fold-head",
      attrs: { type: "button", "aria-expanded": open ? "true" : "false", "data-focus-key": "fold-" + key },
      dataset: { action: "page-fold", key }
    });
    head.append(icon("chevron", 12), h("span", { class: "fold-title", text: title }));
    if (count !== null) head.append(h("span", { class: "fold-count", text: count }));
    node.append(head);
    if (note3 !== null) node.append(h("p", { class: "fold-note", text: note3 }));
    if (open) {
      const body = h("div", { class: "fold-body" });
      for (const child of children) body.append(child);
      node.append(body);
    }
    return node;
  }
  function factGrid(facts) {
    const grid = h("dl", { class: "fact-grid" });
    for (const fact of facts) {
      const valueClass = "fact-value" + (fact.mono === true ? " mono" : "") + (fact.tone === void 0 || fact.tone === "muted" ? "" : " is-" + fact.tone);
      grid.append(
        h(
          "div",
          { class: "fact-cell" },
          h("dt", { class: "fact-key", text: fact.key }),
          h("dd", { class: valueClass, text: fact.value })
        )
      );
    }
    return grid;
  }
  function objectRow(main, side, options = {}) {
    const row = h("div", { class: "obj-row" + (options.danger === true ? " is-danger" : "") });
    const body = h("div", { class: "obj-main" });
    for (const node of main) body.append(node);
    row.append(body);
    if (side !== null && side.length > 0) {
      const actions = h("div", { class: "obj-side" });
      for (const node of side) actions.append(node);
      row.append(actions);
    }
    return row;
  }
  function actionButton(label, action, options = {}) {
    const classes = ["btn", "btn-" + (options.kind ?? "secondary"), "btn-sm"];
    if (options.disabled === true) classes.push("is-disabled");
    return h("button", {
      class: classes.join(" "),
      attrs: {
        type: "button",
        title: options.title ?? null,
        disabled: options.disabled === true,
        ...options.focusKey === void 0 ? {} : { "data-focus-key": options.focusKey }
      },
      dataset: { action, ...options.dataset ?? {} }
    }, label);
  }
  function capabilitiesSection(page, state, skips = []) {
    const caps = capabilitiesOf(page);
    const skipped = caps.filter((cap) => skips.includes(cap.id));
    const rows = caps.filter((cap) => skips.includes(cap.id) === false).map((cap) => capabilityRow(cap, state));
    const note3 = skipped.length === 0 ? "\u8FD9\u6761\u9875\u9762\u4E0A\u6BCF\u4E00\u4EF6\u80FD\u505A\u7684\u4E8B\u90FD\u5728\u8FD9\u4EFD\u6E05\u5355\u91CC\u3002\u5E26\u300C\u6F14\u793A\u300D\u7684\u4F1A\u8D70\u4E00\u904D\u786E\u8BA4\u6D41\u7A0B\uFF0C\u53EA\u6539\u754C\u9762\u72B6\u6001\uFF0C\u4E0D\u78B0\u4ED3\u5E93\u3002" : "\u8FD9\u6761\u9875\u9762\u4E0A\u6BCF\u4E00\u4EF6\u80FD\u505A\u7684\u4E8B\u90FD\u5728\u8FD9\u4EFD\u6E05\u5355\u91CC\u3002\u5E26\u300C\u6F14\u793A\u300D\u7684\u4F1A\u8D70\u4E00\u904D\u786E\u8BA4\u6D41\u7A0B\uFF0C\u53EA\u6539\u754C\u9762\u72B6\u6001\uFF0C\u4E0D\u78B0\u4ED3\u5E93\u3002\u4E0A\u65B9\u5DF2\u6309\u52A8\u4F5C\u5217\u51FA\u7684 " + skipped.length + " \u6761\uFF08" + skipped.map((cap) => cap.id).join("\u3001") + "\uFF09\u4E0D\u5728\u8FD9\u91CC\u91CD\u590D\u3002";
    return section("\u672C\u9875\u8D1F\u8D23\u7684\u80FD\u529B", caps.length + " \u6761", note3, rows, { id: "cap-list" });
  }
  function capabilityRow(cap, state) {
    const open = state.capOpen === cap.id;
    const openDanger = state.dangerId === cap.id;
    const result = state.capResult !== null && state.capResult.id === cap.id ? state.capResult : null;
    const highlighted = state.highlight === cap.id;
    const article = h("article", {
      class: "cap-row" + (open || openDanger ? " is-open" : "") + (highlighted ? " is-flash" : ""),
      attrs: { "data-cap-id": cap.id }
    });
    const head = h("div", { class: "cap-head" });
    head.append(
      h("span", { class: "cap-id mono", text: cap.id }),
      h("span", { class: "cap-name", text: cap.name }),
      chip(LEVEL_LABEL[cap.level] ?? cap.level, levelTone(cap.level), { small: true }),
      chip(PLACEMENT_LABEL[cap.placement] ?? cap.placement, "muted", { small: true, title: PLACEMENT_HINT[cap.placement] })
    );
    article.append(head);
    article.append(h("p", { class: "cap-command mono", text: cap.command }));
    const facts = h("dl", { class: "cap-facts" });
    const pairs = [["\u5165\u53E3", cap.entry], ["\u6253\u5F00\u4EC0\u4E48", cap.opens], ["\u7ED3\u679C\u843D\u5728\u54EA", cap.result]];
    for (const pair of pairs) facts.append(h("div", { class: "cap-fact" }, h("dt", { text: pair[0] }), h("dd", { text: pair[1] })));
    article.append(facts);
    const foot = h("div", { class: "cap-foot" });
    if (cap.readOnly) {
      foot.append(chip("\u53EA\u8BFB", "muted", { small: true }), h("span", { class: "cap-readonly-note", text: "\u539F\u578B\u53EA\u5C55\u793A\u8FD9\u6761\u80FD\u529B\u8BFB\u5230\u7684\u5F62\u72B6\uFF0C\u4E0D\u63D0\u4F9B\u6267\u884C\u6309\u94AE\uFF0C\u4E5F\u4E0D\u5047\u88C5\u80FD\u5199\u3002" }));
    } else {
      foot.append(
        h("button", {
          class: "cap-demo-btn" + (cap.level === "\u6BC1" ? " is-danger" : ""),
          attrs: { type: "button", "data-focus-key": "cap-" + cap.id, title: "\u5728\u539F\u578B\u91CC\u8D70\u4E00\u904D\u8FD9\u6761\u6D41\u7A0B\uFF0C\u53EA\u6539\u754C\u9762\u72B6\u6001" },
          dataset: { action: open ? "cap-close" : "cap-open", id: cap.id }
        }, open ? "\u6536\u8D77\u6F14\u793A" : "\u6F14\u793A\u8FD9\u6761\u6D41\u7A0B")
      );
    }
    article.append(foot);
    if (open && !cap.readOnly) article.append(capConfirmCard(cap));
    if (openDanger && needsSecondConfirm(cap)) article.append(capConfirmCard(cap, true));
    if (result !== null) article.append(capabilityResult(cap.id, result.text));
    return article;
  }
  function inlineConfirmCard(cap, state) {
    if (cap.readOnly || state.capOpen !== cap.id) return null;
    return capConfirmCard(cap);
  }
  function inlineCapabilityResult(cap, state) {
    if (state.capResult === null || state.capResult.id !== cap.id) return null;
    return capabilityResult(cap.id, state.capResult.text);
  }
  function capabilityResult(_id, text) {
    return h(
      "div",
      { class: "cap-result", attrs: { role: "status" } },
      h("span", { class: "cap-result-tag", text: "\u7ED3\u679C" }),
      h("span", { class: "cap-result-text", text })
    );
  }
  function capConfirmCard(cap, secondStage = false) {
    const dangerous = cap.level === "\u6BC1";
    const reversibility = dangerous ? "\u8FD9\u6B21\u4F1A\u91CD\u5199\u5DF2\u6709\u63D0\u4EA4\u4E0E\u5F15\u7528\uFF0C\u5199\u51FA\u6765\u7684\u65B0\u5386\u53F2\u4E0D\u80FD\u64A4\u56DE\u3002" : cap.level === "\u6539\u5199" ? "\u4F1A\u6539\u5199\u5386\u53F2\u3002\u9762\u677F\u91CC\u4FDD\u7559\u65E7\u63D0\u4EA4\u7684\u5F15\u7528\u65E5\u5FD7\uFF0C\u8BEF\u64CD\u4F5C\u8FD8\u80FD\u7167 reflog \u627E\u56DE\u6765\u3002" : "\u4F1A\u5148\u5199\u5DE5\u4F5C\u533A\u6216\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u7684\u6E05\u5355\u3002\u7ED3\u679C\u53EF\u4EE5\u518D\u64A4\u9500\u3002";
    const card = h("div", { class: "cap-confirm" + (dangerous ? " is-danger" : "") + (secondStage ? " is-stage2" : ""), attrs: { role: "group", "aria-label": "\u786E\u8BA4\u8FD9\u6761\u80FD\u529B\u4F1A\u52A8\u4EC0\u4E48" } });
    const rows = [
      ["\u4F1A\u52A8\u4EC0\u4E48", cap.opens + "\u3002\u5B8C\u6210\u540E" + cap.result],
      ["\u4E0D\u4F1A\u52A8\u4EC0\u4E48", dangerous ? "\u4E0D\u4F1A\u66FF\u4F60\u5411\u8FDC\u7AEF\u63A8\u9001\uFF0C\u4E5F\u4E0D\u4F1A\u5220\u9664\u672C\u673A\u4E4B\u5916\u7684\u4ED3\u5E93\u3002\u4F46\u8FD9\u4E9B\u90FD\u4E0D\u6539\u53D8\u300C\u672C\u5730\u5386\u53F2\u5DF2\u88AB\u6539\u5199\u300D\u8FD9\u4EF6\u4E8B\u3002" : CAP_SAFE_NOTE],
      ["\u53EF\u9006\u6027\u4E0E\u6062\u590D\u8DEF\u5F84", reversibility]
    ];
    for (const pair of rows) {
      card.append(h(
        "div",
        { class: "confirm-row" + (pair[0] === "\u53EF\u9006\u6027\u4E0E\u6062\u590D\u8DEF\u5F84" ? " is-emphasis" : "") },
        h("span", { class: "confirm-key", text: pair[0] }),
        h("span", { class: "confirm-value", text: pair[1] })
      ));
    }
    if (secondStage) {
      card.append(h(
        "div",
        { class: "confirm-row" },
        h("span", { class: "confirm-key", text: "\u9010\u6761\u6838\u5BF9" }),
        h("span", { class: "confirm-value", text: "\u8FD9\u6761\u52A8\u4F5C\u4F1A\u91CD\u5199\u5168\u5E93\u3002\u8BF7\u5148\u56DE\u7EF4\u62A4\u9875\u6838\u5BF9\u5BF9\u8C61\u6570\u91CF\u4E0E\u5907\u4EFD\u4F4D\u7F6E\uFF0C\u518D\u5728\u5371\u9669\u533A\u7684\u4E8C\u7EA7\u786E\u8BA4\u9875\u91CC\u5B8C\u6210\u3002" })
      ));
    }
    const actions = h("div", { class: "confirm-actions" });
    actions.append(
      h("button", {
        class: "btn btn-secondary btn-sm",
        attrs: { type: "button", "data-focus-key": "cap-cancel-" + cap.id },
        dataset: { action: dangerous ? "danger-close" : "cap-close" }
      }, "\u53D6\u6D88")
    );
    if (dangerous) {
      actions.append(h("button", {
        class: "btn btn-danger btn-sm",
        attrs: { type: "button", "data-focus-key": "cap-danger-" + cap.id },
        dataset: { action: "danger-open", id: cap.id }
      }, "\u5148\u6838\u5BF9\u540E\u679C\u2026"));
    } else {
      actions.append(h("button", {
        class: "btn btn-primary btn-sm",
        attrs: { type: "button", "data-focus-key": "cap-run-" + cap.id },
        dataset: { action: "cap-run", id: cap.id }
      }, cap.level === "\u6539\u5199" ? "\u6539\u5199\u5386\u53F2\uFF08\u539F\u578B\u6A21\u62DF\uFF09" : "\u6267\u884C\uFF08\u539F\u578B\u6A21\u62DF\uFF09"));
    }
    card.append(actions);
    return card;
  }
  function coverageNote() {
    const count = (placement) => CAPABILITIES.filter((cap) => cap.placement === placement).length;
    return h(
      "p",
      { class: "coverage-note" },
      chip("\u8986\u76D6\u53E3\u5F84", "info", { small: true }),
      h("span", { text: "162 \u6761\u80FD\u529B\u5168\u90E8\u6709\u843D\u70B9\uFF1A\u547D\u4EE4\u9762\u677F\u53EF\u6309\u540D\u79F0\u4E0E\u4F4D\u7F6E\u641C\u7D22\uFF0C\u6BCF\u4E2A\u9875\u9762\u5E95\u90E8\u6309 #1588 \u7684\u7F16\u53F7\u9010\u6761\u5217\u51FA\u3002\u516D\u6761\u6CA1\u6709\u9762\u677F\u5165\u53E3\u7684\uFF08\u53D1\u8865\u4E01\u90AE\u4EF6\u4E0E\u5E73\u53F0\u4E94\u6761\uFF09\u5728\u300C\u5E73\u53F0\u4E0E\u8FB9\u754C\u300D\u91CC\u9010\u6761\u53EA\u8BFB\u8BF4\u660E\u3002" }),
      h("span", { class: "coverage-count mono", text: "\u76F4 " + count("\u76F4") + " \xB7 \u6298 " + count("\u6298") + " \xB7 \u8BCA " + count("\u8BCA") + " \xB7 \u5916 " + count("\u5916") })
    );
  }

  // docs/prototype/vc-redesign/src/ui/views/pages-manage.ts
  function renderManageIndex(_ctx) {
    const cards = h("div", { class: "manage-grid" });
    for (const page of MANAGE_CARD_ORDER) {
      const meta = PAGE_META[page];
      const count = manageCountOf(page);
      const caps = CAPABILITIES.filter((cap) => cap.target === page).length;
      const card = h(
        "button",
        {
          class: "manage-card" + (meta.danger === true ? " is-danger" : ""),
          attrs: { type: "button", "data-focus-key": "manage-" + page, title: meta.card },
          dataset: { action: "page-open", page }
        },
        h(
          "span",
          { class: "manage-card-head" },
          h("span", { class: "manage-card-title", text: meta.title }),
          meta.danger === true ? chip("\u5371\u9669\u533A", "error", { small: true }) : null,
          h("span", { class: "manage-card-count", text: count })
        ),
        h("span", { class: "manage-card-text", text: meta.card }),
        h(
          "span",
          { class: "manage-card-foot" },
          h("span", { class: "manage-card-caps", text: caps + " \u6761\u80FD\u529B" }),
          h("span", { class: "manage-card-go", text: "\u6253\u5F00" }, icon("chevron", 11))
        )
      );
      cards.append(card);
    }
    const shortcuts = h(
      "div",
      { class: "manage-shortcuts" },
      h("button", {
        class: "manage-shortcut",
        attrs: { type: "button", "data-focus-key": "manage-palette" },
        dataset: { action: "palette-open" }
      }, icon("chevron", 12), h("span", { text: "\u547D\u4EE4\u9762\u677F\uFF1A\u6309\u80FD\u529B\u540D\u6216\u4F4D\u7F6E\u641C\u7D22 162 \u6761\u80FD\u529B" })),
      h("button", {
        class: "manage-shortcut",
        attrs: { type: "button", "data-focus-key": "manage-search" },
        dataset: { action: "page-open", page: "search" }
      }, icon("chevron", 12), h("span", { text: "\u5168\u5E93\u641C\u7D22\uFF1A\u4E00\u6B21\u641C\u63D0\u4EA4\u3001\u5206\u652F\u4E0E\u6807\u7B7E" }))
    );
    const body = h(
      "div",
      { class: "page-stack" },
      h("p", { class: "page-note" }, h("span", { text: "\u7D22\u5F15\u4E0D\u76F4\u63A5\u5199\u4ED3\u5E93\u3002\u4E5D\u4E2A\u5206\u533A\u7684\u987A\u5E8F\u6309\u300C\u8D8A\u5F80\u4E0B\u8D8A\u4E0D\u5E38\u7528\u3001\u8D8A\u4E0D\u53EF\u9006\u300D\u6392\uFF0C\u7EF4\u62A4\u4E0E\u8FC1\u79FB\u5728\u6700\u540E\u3002" })),
      cards,
      shortcuts,
      coverageNote()
    );
    return pageShell("manage", PAGE_META.manage.title, PAGE_META.manage.lede, null, body);
  }
  function manageCountOf(page) {
    switch (page) {
      case "branch-tags":
        return capturedLocalBranches + " \u6761\u5206\u652F \xB7 " + capturedTags.length + " \u4E2A\u6807\u7B7E";
      case "remote":
        return capturedRemotes.length + " \u4E2A\u8FDC\u7AEF";
      case "submodules":
        return submoduleNames().length + " \u4E2A\u5B50\u6A21\u5757";
      case "maintenance":
        return "\u677E\u6563\u5BF9\u8C61 " + capturedCounts.loose + " \xB7 \u5305 " + capturedCounts.packs;
      case "migrate":
        return "6 \u6761\u80FD\u529B \xB7 3 \u7C7B\u4EA7\u51FA";
      case "config":
        return "8 \u6761\u76F8\u5173\u952E \xB7 2 \u5C42\u4F5C\u7528\u57DF";
      case "hooks":
        return hookCounts().enabled + " \u4E2A\u5DF2\u542F\u7528 \xB7 " + hookCounts().samples + " \u4E2A\u793A\u4F8B";
      case "diagnostics":
        return "14 \u6761\u8C03\u8BD5\u80FD\u529B \xB7 23 \u6761\u53EA\u8BFB";
      case "platform":
        return "6 \u6761\u80FD\u529B \xB7 6 \u6761\u65E0\u64CD\u4F5C\u5165\u53E3";
      default:
        return "";
    }
  }
  function submoduleNames() {
    return capturedSubmodules.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  }
  function hookCounts() {
    const records = hooksOf();
    return { enabled: records.filter((hook) => !hook.sample).length, samples: records.filter((hook) => hook.sample).length };
  }
  function hooksOf() {
    return capturedHooks;
  }
  function renderBranchTags(ctx) {
    const { data, model, state } = ctx;
    const rows = model.branches.rows;
    const filtered = rows.filter((row) => {
      if (state.query !== "" && !row.name.toLowerCase().includes(state.query.trim().toLowerCase())) return false;
      if (state.filter === "current") return row.current;
      if (state.filter === "unmerged") return !row.merged;
      return true;
    });
    const filters = h(
      "div",
      { class: "page-filters" },
      filterButton("\u5168\u90E8", "all", state.filter),
      filterButton("\u5F53\u524D\u5206\u652F", "current", state.filter),
      filterButton("\u672A\u5E76\u5165\u5F53\u524D\u5206\u652F", "unmerged", state.filter)
    );
    const search = h(
      "label",
      { class: "page-search" },
      h("span", { class: "sr-only", text: "\u6309\u5206\u652F\u540D\u641C\u7D22" }),
      h("input", {
        class: "page-search-input",
        attrs: { type: "search", placeholder: "\u6309\u5206\u652F\u540D\u641C\u7D22", value: state.draft, "data-focus-key": "page-query" },
        dataset: { field: "page-query" }
      })
    );
    const branchRows = [];
    for (const row of filtered) {
      const facts = h(
        "span",
        { class: "obj-meta" },
        h("span", { class: "mono", text: row.upstream === null ? "\u6CA1\u6709\u4E0A\u6E38" : row.upstream }),
        h("span", { text: row.ahead === 0 ? "\u4E0E\u4E0A\u6E38\u9F50\u5E73" : "\u9886\u5148 " + row.ahead }),
        h("span", { text: row.behind === 0 ? "" : "\u843D\u540E " + row.behind }),
        h("span", { text: row.merged ? "\u5DF2\u5E76\u5165\u5F53\u524D\u5206\u652F" : "\u672A\u5E76\u5165\u5F53\u524D\u5206\u652F" })
      );
      branchRows.push(objectRow([
        h(
          "span",
          { class: "obj-title" },
          h("span", { class: "mono", text: row.name }),
          row.current ? chip("\u5F53\u524D", "info", { small: true }) : null,
          h("span", { class: "obj-oid mono", text: row.oidShort })
        ),
        facts,
        h("span", { class: "obj-sub", text: row.when + " \xB7 " + row.subject })
      ], [
        actionButton("\u5728\u6D6E\u5C42\u91CC\u770B", "branch-tags-view", { focusKey: "branch-tags-view-" + row.name, dataset: { name: row.name }, title: "\u6253\u5F00\u9876\u90E8\u5206\u652F\u6D6E\u5C42\u5E76\u9009\u4E2D\u8FD9\u6761\u5206\u652F" })
      ]));
    }
    if (filtered.length === 0) branchRows.push(emptyState("\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u5206\u652F", "\u6E05\u7A7A\u641C\u7D22\u6216\u6362\u4E00\u4E2A\u7B5B\u9009\u518D\u8BD5\u3002"));
    const shown = new Set(rows.map((row) => row.name));
    const rest = capturedLocalBranchNames.filter((name) => !shown.has(name));
    const restList = rest.map((name) => objectRow([
      h("span", { class: "obj-title mono", text: name }),
      h("span", { class: "obj-sub", text: "\u91C7\u96C6\u5230\u8FD9\u6761\u672C\u5730\u5206\u652F\u3002\u539F\u578B\u6CA1\u6709\u4E3A\u5B83\u5355\u72EC\u9020\u4E0A\u6E38\u4E0E\u9886\u5148\u843D\u540E\u6837\u672C\u3002" })
    ], null));
    const tagRows = capturedTags.map((tag) => objectRow([
      h(
        "span",
        { class: "obj-title" },
        h("span", { class: "mono", text: tag.name }),
        h("span", { class: "obj-oid mono", text: tag.shortOid })
      ),
      h("span", { class: "obj-sub", text: whenText2(data.nowMs, tag.createdAtMs) })
    ], [
      actionButton("\u68C0\u51FA", "page-demo", { focusKey: "tag-checkout-" + tag.name, dataset: { note: "\u5DF2\u57FA\u4E8E\u6807\u7B7E " + tag.name + " \u5207\u51FA\u65B0\u5206\u652F\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u4E0D\u4F1A\u79FB\u52A8\u5DF2\u6709\u5206\u652F\u3002" } })
    ]));
    const tracking = factGrid([
      { key: "\u5F53\u524D\u5206\u652F", value: model.rail.branch ?? capturedBranch, mono: true },
      { key: "\u4E0A\u6E38", value: capturedRemotes.find((remote) => remote.name === "origin") === void 0 ? "origin/" + capturedBranch : "origin/" + capturedBranch, mono: true },
      { key: "\u9886\u5148 / \u843D\u540E", value: model.rail.syncChips.map((chip2) => chip2.label + " " + chip2.value).join(" \xB7 ") },
      { key: "\u4E0A\u6E38\u4F9D\u636E", value: model.rail.basisText }
    ]);
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u5206\u652F", capturedLocalBranches + " \u6761\u672C\u5730\u5206\u652F", "\u5217\u8868\u5148\u7ED9\u4E0E\u5F53\u524D\u5DE5\u4F5C\u76F8\u5173\u7684\u516D\u6761\uFF08\u542B\u4E0A\u6E38\u4E0E\u9886\u5148\u843D\u540E\uFF09\u3002\u5168\u90E8 62 \u6761\u5728\u4E0B\u9762\u7684\u6298\u53E0\u533A\u91CC\u9010\u6761\u5217\u540D\uFF0C\u6570\u91CF\u4E0E\u91C7\u96C6\u4E00\u81F4\u3002", [
        filters,
        search,
        h("div", { class: "obj-list" }, ...branchRows),
        fold("branch-rest", "\u5168\u90E8\u672C\u5730\u5206\u652F", rest.length + " \u6761", state.expanded.includes("branch-rest"), restList, "\u8FD9\u91CC\u53EA\u5217\u540D\u5B57\u3002\u8981\u770B\u4E0A\u6E38\u4E0E\u9886\u5148\u843D\u540E\uFF0C\u9700\u8981\u771F\u5B9E\u8BFB\u53D6\u6BCF\u6761\u5206\u652F\u7684\u8DDF\u8E2A\u914D\u7F6E\uFF0C\u539F\u578B\u4E0D\u5047\u88C5\u6709\u8FD9\u4E2A\u6570\u636E\u3002")
      ]),
      section("\u6807\u7B7E", capturedTags.length + " \u4E2A\u6807\u7B7E", "\u6807\u7B7E\u6765\u81EA\u672C\u5730 refs\u3002\u6CA1\u6709\u8FDC\u7AEF\u6807\u7B7E\u4E0E\u7B7E\u540D\u4FE1\u606F\uFF0C\u754C\u9762\u4E0D\u5047\u9020\u3002", [
        h("div", { class: "obj-list" }, ...tagRows)
      ]),
      section("\u4E0A\u6E38\u8DDF\u8E2A", null, "\u8BBE\u7F6E\u4E0A\u6E38\u4E0E\u53D6\u6D88\u8DDF\u8E2A\u662F\u6574\u7406\u52A8\u4F5C\uFF0C\u653E\u5728\u80FD\u529B\u6E05\u5355\u91CC\u6F14\u793A\u3002\u8FD9\u4E00\u5C4F\u53EA\u628A\u5F53\u524D\u72B6\u6001\u8BF4\u6E05\u3002", [tracking]),
      capabilitiesSection("branch-tags", state)
    );
    return pageShell("branch-tags", PAGE_META["branch-tags"].title, PAGE_META["branch-tags"].lede, null, body, {
      actions: [actionButton("\u5728\u5206\u652F\u6D6E\u5C42\u91CC\u7BA1\u7406", "branch-open-from-page", { kind: "secondary", title: "\u5207\u5206\u652F\u3001\u5408\u5E76\u3001\u53D8\u57FA\u4ECD\u8D70\u9876\u90E8\u5206\u652F\u6D6E\u5C42" })]
    });
  }
  function filterButton(label, filter, active) {
    return h("button", {
      class: "filter-chip" + (active === filter ? " is-on" : ""),
      attrs: { type: "button", "aria-pressed": active === filter ? "true" : "false", "data-focus-key": "page-filter-" + filter },
      dataset: { action: "page-filter", filter }
    }, label);
  }
  function renderRemote(ctx) {
    const { model, state } = ctx;
    const remoteRows = capturedRemotes.map((remote) => objectRow([
      h("span", { class: "obj-title" }, h("span", { class: "mono", text: remote.name }), remote.name === "origin" ? chip("\u9ED8\u8BA4", "info", { small: true }) : null),
      h("span", { class: "obj-meta mono", text: remote.fetchUrl }),
      ...remote.pushUrl !== remote.fetchUrl ? [h("span", { class: "obj-sub mono", text: "\u63A8\u9001\u5730\u5740\uFF1A" + remote.pushUrl })] : []
    ], [
      actionButton("\u6539\u5730\u5740", "page-demo", { focusKey: "remote-edit-" + remote.name, dataset: { note: "\u5DF2\u6253\u5F00 " + remote.name + " \u7684\u5730\u5740\u7F16\u8F91\u8868\u5355\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u6539\u5730\u5740\u4E0D\u4F1A\u7ACB\u523B\u91CD\u5199\u63D0\u4EA4\u3002" } }),
      actionButton("\u5220\u9664", "page-demo", { kind: "danger", focusKey: "remote-remove-" + remote.name, dataset: { note: "\u5220\u9664\u8FDC\u7AEF\u53EA\u4F1A\u5220\u914D\u7F6E\uFF0C\u4E0D\u4F1A\u5220\u8FDC\u7AEF\u4ED3\u5E93\u91CC\u7684\u4EFB\u4F55\u4E1C\u897F\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002" } })
    ]));
    const syncButtons = h(
      "div",
      { class: "page-actions-row" },
      actionButton(model.rail.pull.label, "pull", { focusKey: "remote-pull", title: model.rail.pull.reason ?? void 0 }),
      actionButton(model.rail.fetch.label, "fetch", { focusKey: "remote-fetch", title: model.rail.fetch.reason ?? void 0 }),
      actionButton(model.rail.push.label, "push", { focusKey: "remote-push", title: model.rail.push.reason ?? void 0 }),
      actionButton("\u6293\u53D6\u6240\u6709\u8FDC\u7AEF", "page-demo", { focusKey: "remote-fetch-all", dataset: { note: "\u5DF2\u6293\u53D6\u5168\u90E8\u8FDC\u7AEF\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u53EA\u66F4\u65B0\u8FDC\u7AEF\u8DDF\u8E2A\u5F15\u7528\uFF0C\u4E0D\u52A8\u5DE5\u4F5C\u533A\u3002" } }),
      actionButton("\u4FEE\u526A\u5DF2\u5220\u9664\u7684\u8FDC\u7AEF\u5206\u652F", "page-demo", { focusKey: "remote-prune", dataset: { note: "\u5DF2\u4FEE\u526A\u8FDC\u7AEF\u5DF2\u5220\u9664\u7684\u8DDF\u8E2A\u5206\u652F\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u672C\u5730\u5206\u652F\u4E0D\u53D7\u5F71\u54CD\u3002" } })
    );
    const syncFacts = factGrid([
      { key: "\u5F53\u524D\u5206\u652F", value: model.rail.branch ?? capturedBranch, mono: true },
      { key: "\u540C\u6B65\u72B6\u6001", value: model.rail.sync.kind === "text" ? model.rail.sync.text : "\u9886\u5148 " + (model.rail.syncChips[0]?.value ?? 0) + " \xB7 \u843D\u540E " + (model.rail.syncChips[1]?.value ?? 0) },
      { key: "\u8BFB\u53D6\u4E8E", value: model.rail.readAtText },
      { key: "\u8FDC\u7AEF\u4F9D\u636E", value: model.rail.basisText },
      { key: "\u5DE5\u4F5C\u533A\u6539\u52A8", value: model.changes.stagedCount + " \u4E2A\u5DF2\u52A0\u5165 \xB7 " + model.changes.unstagedCount + " \u4E2A\u672A\u52A0\u5165 \xB7 " + model.changes.conflictCount + " \u4E2A\u51B2\u7A81" }
    ]);
    const addForm = h(
      "div",
      { class: "inline-form" },
      h(
        "label",
        { class: "inline-field" },
        h("span", { class: "inline-label", text: "\u65B0\u8FDC\u7AEF\u540D\u5B57" }),
        h("input", { class: "inline-input", attrs: { type: "text", placeholder: "\u4F8B\u5982 upstream", value: state.draft }, dataset: { field: "page-query" } })
      ),
      actionButton("\u6DFB\u52A0\u8FDC\u7AEF", "page-form-submit", { kind: "primary", focusKey: "remote-add", dataset: { kind: "remote-add" } })
    );
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u8FDC\u7AEF\u6E05\u5355", capturedRemotes.length + " \u4E2A", "\u540D\u5B57\u3001\u6293\u53D6\u5730\u5740\u3001\u63A8\u9001\u5730\u5740\u5206\u5F00\u5199\uFF1A\u4E09\u8005\u7684\u7528\u9014\u4E0D\u4E00\u6837\uFF0C\u5408\u6210\u4E00\u53E5\u4F1A\u8BA9\u300C\u63A8\u5230\u54EA\u91CC\u300D\u770B\u4E0D\u51FA\u6765\u3002", [...remoteRows, addForm]),
      section("\u540C\u6B65", null, "\u4E09\u9897\u540C\u6B65\u6309\u94AE\u6CBF\u7528\u9876\u90E8\u540C\u6B65\u5E26\u7684\u5224\u5B9A\uFF1A\u7981\u7528\u7684\u539F\u56E0\u5199\u5728\u6309\u94AE title \u91CC\uFF0C\u62C9\u53D6\u4E0E\u63A8\u9001\u7684\u7ED3\u679C\u51FA\u73B0\u5728\u9876\u90E8\u540C\u6B65\u5E26\uFF0C\u4E0D\u4F1A\u8DD1\u5230\u9875\u9762\u5E95\u90E8\u3002", [syncFacts, syncButtons]),
      section("\u8FDC\u7AEF\u4F9D\u636E", null, "\u300C\u8FDC\u7AEF\u4F9D\u636E\u300D\u4E0D\u518D\u662F\u53EA\u8BFB\u7684\u65F6\u95F4\u4E8B\u5B9E\uFF0C\u5B83\u672C\u8EAB\u662F\u6253\u5F00\u8FD9\u4E00\u9875\u7684\u5165\u53E3\u4E4B\u4E00\u3002\u8FD9\u4E00\u9875\u89E3\u91CA\u4E86\u6570\u5B57\u6765\u81EA\u54EA\u4E00\u6B21\u8BFB\u53D6\u3002", [
        h("p", { class: "page-note" }, h("span", { text: "\u9876\u90E8\u540C\u6B65\u5E26\u5199\u300C\u8FDC\u7AEF\u4F9D\u636E origin \xB7 12 \u5206\u949F\u524D\u300D\uFF0C\u70B9\u5B83\u5C31\u662F\u6253\u5F00\u672C\u9875\u3002\u6570\u5B57\u4E0E\u65F6\u95F4\u6765\u81EA\u540C\u4E00\u6B21\u8BFB\u53D6\u3002\u8BFB\u53D6\u5931\u8D25\u65F6\u5199\u300C\u8BFB\u4E0D\u5230\u300D\uFF0C\u4E0D\u5199 0\u3002" }))
      ]),
      capabilitiesSection("remote", state)
    );
    return pageShell("remote", PAGE_META.remote.title, PAGE_META.remote.lede, null, body);
  }
  function renderSubmodules(ctx) {
    const { state } = ctx;
    const names = submoduleNames();
    const rows = names.map((name) => objectRow([
      h("span", { class: "obj-title mono", text: name }),
      h("span", { class: "obj-sub", text: "\u5B50\u6A21\u5757\u8DEF\u5F84\u4E0E\u5F53\u524D\u6307\u5411\u7684\u63D0\u4EA4\u9700\u8981\u771F\u5B9E\u8BFB\u53D6 .gitmodules \u4E0E\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u7684\u6E05\u5355\u3002\u539F\u578B\u6CA1\u6709\u9020\u3002" })
    ], [actionButton("\u66F4\u65B0", "page-demo", { focusKey: "sub-update-" + name, dataset: { note: "\u5DF2\u66F4\u65B0\u5B50\u6A21\u5757 " + name + " \u5230\u767B\u8BB0\u63D0\u4EA4\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002" } })]));
    const installForm = h(
      "div",
      { class: "inline-form" },
      h(
        "label",
        { class: "inline-field" },
        h("span", { class: "inline-label", text: "\u5B50\u6A21\u5757\u5730\u5740" }),
        h("input", { class: "inline-input", attrs: { type: "text", placeholder: "https://\u2026 \u6216 ../\u4ED3\u5E93\u8DEF\u5F84", value: state.draft }, dataset: { field: "page-query" } })
      ),
      actionButton("\u6DFB\u52A0\u5B50\u6A21\u5757", "page-form-submit", { kind: "primary", focusKey: "sub-add", dataset: { kind: "sub-add" } })
    );
    const empty = h(
      "div",
      { class: "empty-block" },
      emptyState("\u8FD9\u4E2A\u4ED3\u5E93\u6CA1\u6709\u5B50\u6A21\u5757", ".gitmodules \u4E0D\u5B58\u5728\u3002\u7A7A\u6001\u4E5F\u8981\u80FD\u8BC4\u5BA1\uFF0C\u6240\u4EE5\u8FD9\u91CC\u7167\u5B9E\u753B\uFF0C\u4E0D\u62FF\u6F14\u793A\u884C\u586B\u6EE1\u3002"),
      installForm
    );
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u5B50\u6A21\u5757\u6E05\u5355", names.length + " \u4E2A", "\u6BCF\u4E00\u884C\u53EA\u56DE\u7B54\u4E09\u4EF6\u4E8B\uFF1A\u8DEF\u5F84\u3001\u6307\u5411\u54EA\u6761\u63D0\u4EA4\u3001\u73B0\u5728\u662F\u4E0D\u662F\u767B\u8BB0\u7684\u6837\u5B50\u3002\u6279\u91CF\u52A8\u4F5C\u6536\u5728\u80FD\u529B\u6E05\u5355\u91CC\u3002", names.length === 0 ? [empty] : [...rows, installForm]),
      section("\u6279\u91CF\u52A8\u4F5C", null, "\u6279\u91CF\u66F4\u65B0\u4E0E\u6279\u91CF\u6267\u884C\u4F1A\u4E00\u6B21\u6539\u52A8\u591A\u4E2A\u4ED3\u5E93\u3002\u8D85\u8FC7\u4E09\u4E2A\u5BF9\u8C61\u65F6\u7528\u4E8C\u7EA7\u786E\u8BA4\u9875\u9010\u6761\u6838\u5BF9\uFF0C\u4E0D\u5728\u884C\u5185\u5F39\u786E\u8BA4\u5361\u3002", [
        h("p", { class: "page-note" }, h("span", { text: "\u771F\u5B9E\u5B9E\u73B0\u91CC\u6BCF\u4E2A\u5B50\u6A21\u5757\u662F\u72EC\u7ACB\u4ED3\u5E93\uFF1A\u9762\u677F\u80FD\u53D1\u8D77\u6279\u91CF\u547D\u4EE4\u5E76\u5C55\u793A\u9010\u4E2A\u5B50\u6A21\u5757\u7684\u7ED3\u679C\uFF0C\u4F46\u4E0D\u4F1A\u66FF\u4F60\u89E3\u51B3\u5B50\u6A21\u5757\u5185\u90E8\u7684\u5206\u652F\u51B2\u7A81\u3002" }))
      ]),
      capabilitiesSection("submodules", state)
    );
    return pageShell("submodules", PAGE_META.submodules.title, PAGE_META.submodules.lede, null, body);
  }
  function whenText2(nowMs, ms) {
    const minutes = Math.max(0, Math.floor((nowMs - ms) / 6e4));
    if (minutes < 1) return "\u521A\u521A";
    if (minutes < 60) return minutes + " \u5206\u949F\u524D";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " \u5C0F\u65F6\u524D";
    return Math.floor(hours / 24) + " \u5929\u524D";
  }

  // docs/prototype/vc-redesign/src/ui/views/pages-system.ts
  function capOf(id) {
    const cap = CAPABILITIES.find((item) => item.id === id);
    if (cap === void 0) throw new Error("\u80FD\u529B\u7F16\u53F7\u4E0D\u5B58\u5728\uFF1A" + id);
    return cap;
  }
  function capabilitySummary(cap) {
    return h(
      "span",
      { class: "obj-title" },
      h("span", { class: "mono obj-cap-id", text: cap.id }),
      h("span", { text: cap.name }),
      chip(cap.level, cap.level === "\u6BC1" ? "error" : cap.level === "\u6539\u5199" ? "warn" : cap.level === "\u8BFB" ? "muted" : "info", { small: true })
    );
  }
  function capabilityAction(cap) {
    if (cap.readOnly) return chip("\u53EA\u8BFB", "muted", { small: true });
    const dangerous = cap.level === "\u6BC1" && (cap.target === "maintenance" || cap.target === "migrate");
    return actionButton(dangerous ? "\u6838\u5BF9\u540E\u679C\u2026" : "\u6F14\u793A", dangerous ? "danger-open" : "cap-open", {
      kind: dangerous ? "danger" : "secondary",
      focusKey: "act-" + cap.id,
      dataset: dangerous ? { id: cap.id } : { id: cap.id }
    });
  }
  function capWrap(cap, node, state) {
    return h("div", {
      class: "cap-block" + (state.highlight === cap.id ? " is-flash" : ""),
      attrs: { "data-cap-id": cap.id }
    }, node);
  }
  function capabilityBlock(cap, body, state, options = {}) {
    const block = h("div", {
      class: "cap-block" + (state.highlight === cap.id ? " is-flash" : "") + (state.capOpen === cap.id ? " is-open" : ""),
      attrs: { "data-cap-id": cap.id }
    }, objectRow(body, [capabilityAction(cap)], { danger: options.danger === true }));
    const card = inlineConfirmCard(cap, state);
    if (card !== null) block.append(card);
    const result = inlineCapabilityResult(cap, state);
    if (result !== null) block.append(result);
    return block;
  }
  function renderMaintenance(ctx) {
    const { data, state } = ctx;
    const looseMiB = (capturedCounts.sizeKiB / 1024).toFixed(2);
    const packMiB = (capturedCounts.sizePackKiB / 1024).toFixed(2);
    const facts = factGrid([
      { key: "\u677E\u6563\u5BF9\u8C61", value: capturedCounts.loose + " \u4E2A \xB7 " + looseMiB + " MiB" },
      { key: "\u5305\u5185\u5BF9\u8C61", value: capturedCounts.inPack + " \u4E2A \xB7 " + capturedCounts.packs + " \u4E2A\u5305 \xB7 " + packMiB + " MiB" },
      { key: "\u53EF\u56DE\u6536\u5BF9\u8C61", value: capturedCounts.prunePackable + " \u4E2A", tone: capturedCounts.prunePackable > 0 ? "warn" : "muted" },
      { key: "\u5783\u573E\u6587\u4EF6", value: String(capturedCounts.garbage) },
      { key: "\u5DE5\u4F5C\u6811", value: capturedWorktrees.length + " \u68F5" },
      { key: "\u5F15\u7528\u603B\u6570", value: capturedRefsTotal + " \u6761 \xB7 \u672C\u5730\u5206\u652F " + capturedLocalBranches + " \u6761" }
    ]);
    const lines = ["11.5", "11.7", "11.8", "11.9", "11.10", "11.11", "11.15"];
    const actionRows = lines.map((id) => {
      const cap = capOf(id);
      return capabilityBlock(cap, [
        capabilitySummary(cap),
        h("span", { class: "obj-meta mono", text: cap.command }),
        h("span", { class: "obj-sub", text: cap.opens + "\u3002" + cap.result })
      ], state);
    });
    const dangerRows = [];
    for (const id of ["5.11", "11.6", "5.13", "11.14"]) {
      const cap = capOf(id);
      const body2 = h(
        "div",
        { class: "danger-card-body" },
        capabilitySummary(cap),
        h("p", { class: "danger-consequence", text: cap.opens + "\u3002" + cap.result }),
        h("p", { class: "danger-recovery", text: id === "11.6" ? "\u6E05\u7406\u4E4B\u540E\u4E0D\u53EF\u8FBE\u5BF9\u8C61\u4ECE\u672C\u5730\u6D88\u5931\uFF0C\u53EA\u6709\u91CD\u65B0\u4ECE\u8FDC\u7AEF\u6293\u53D6\u6216\u4ECE\u5907\u4EFD\u6062\u590D\u624D\u80FD\u627E\u56DE\u3002\u6267\u884C\u524D\u5148\u786E\u8BA4\u6CA1\u6709\u5176\u4ED6\u5DE5\u4F5C\u6811\u8FD8\u5F15\u7528\u5B83\u4EEC\u3002" : "\u8FD9\u4E00\u6B65\u4F1A\u91CD\u5199\u5168\u5E93\u5386\u53F2\u6216\u5F15\u7528\u683C\u5F0F\uFF0C\u5199\u51FA\u6765\u7684\u7ED3\u679C\u4E0D\u80FD\u64A4\u56DE\u3002\u9762\u677F\u53EA\u5C55\u793A\u540E\u679C\u4E0E\u5907\u4EFD\u4F4D\u7F6E\uFF0C\u771F\u5B9E\u6267\u884C\u4EA4\u7ED9\u4E13\u95E8\u7684\u5DE5\u5177\uFF0C\u5E76\u5148\u5728\u526F\u672C\u4E0A\u6F14\u7EC3\u3002" }),
        h("p", { class: "danger-meta", text: id === "11.6" ? "\u5BF9\u8C61\u6570\u91CF\uFF1A" + capturedCounts.prunePackable + " \u4E2A\u53EF\u56DE\u6536\u5BF9\u8C61 \xB7 " + capturedCounts.garbage + " \u4E2A\u5783\u573E\u6587\u4EF6" : "\u4ED3\u5E93\uFF1A" + capturedRepoRoot + " \xB7 \u5206\u652F\uFF1A" + capturedBranch })
      );
      dangerRows.push(capabilityBlock(cap, [body2], state, { danger: true }));
    }
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u4ED3\u5E93\u4F53\u91CF", null, "\u8FD9\u91CC\u6BCF\u4E00\u9879\u90FD\u662F git \u81EA\u5DF1\u7684\u8BFB\u6570\uFF08git count-objects -v\uFF09\u3002\u6570\u5B57\u968F\u771F\u5B9E\u4ED3\u5E93\u53D8\u5316\uFF0C\u4E0D\u662F\u793A\u4F8B\u503C\u3002", [facts]),
      section("\u6574\u7406\u52A8\u4F5C", lines.length + " \u6761", "\u53EF\u64A4\u9500\u7684\u6574\u7406\u52A8\u4F5C\u96C6\u4E2D\u5728\u8FD9\u91CC\uFF1A\u5B83\u4EEC\u53EA\u6539\u5BF9\u8C61\u5B58\u50A8\u4E0E\u5F15\u7528\u6253\u5305\u65B9\u5F0F\uFF0C\u4E0D\u6539\u63D0\u4EA4\u5185\u5BB9\u3002\u5E26\u300C\u53EA\u8BFB\u300D\u7684\u51E0\u6761\u53EA\u5C55\u793A\u8BFB\u5230\u7684\u5F62\u72B6\u3002", actionRows),
      section("\u5371\u9669\u533A", "4 \u6761", "\u6574\u4ED3\u4E0D\u53EF\u9006\u7684\u52A8\u4F5C\u4E0D\u653E\u5728\u884C\u5185\u786E\u8BA4\u5361\u91CC\uFF1A\u8981\u5148\u8FDB\u4E8C\u7EA7\u6838\u5BF9\u9875\uFF0C\u770B\u8FC7\u540E\u679C\u3001\u5907\u4EFD\u4F4D\u7F6E\u4E0E\u6062\u590D\u8DEF\u5F84\uFF0C\u624D\u80FD\u8D70\u5230\u6700\u540E\u4E00\u6B65\u3002", dangerRows, { danger: true, id: "danger-zone" }),
      capabilitiesSection("maintenance", state, [...lines, "5.11", "11.6", "5.13", "11.14"])
    );
    return pageShell("maintenance", PAGE_META.maintenance.title, PAGE_META.maintenance.lede, null, body, { danger: true });
  }
  function renderMigrate(ctx) {
    const { state } = ctx;
    const rows = [];
    for (const id of ["11.1", "14.1"]) {
      const cap = capOf(id);
      rows.push(capabilityBlock(cap, [
        capabilitySummary(cap),
        h("span", { class: "obj-meta mono", text: cap.command }),
        h("span", { class: "obj-sub", text: cap.opens + "\u3002" + cap.result })
      ], state));
    }
    const cloneEntry = capWrap(capOf("8.16"), objectRow([
      h("span", { class: "obj-title", text: "\u514B\u9686\u4E00\u4E2A\u4ED3\u5E93\u5230\u672C\u673A" }),
      h("span", { class: "obj-sub", text: "\u514B\u9686\u662F\u957F\u4EFB\u52A1\uFF1A\u5148\u9009\u76EE\u5F55\uFF0C\u518D\u770B\u5230\u5BF9\u8C61\u63A5\u6536\u4E0E\u68C0\u51FA\u8FDB\u5EA6\u3002\u4E2D\u9014\u53D6\u6D88\u8981\u5199\u6E05\u7559\u4E0B\u4E86\u54EA\u4E9B\u6587\u4EF6\u3002" })
    ], [actionButton("\u6253\u5F00\u514B\u9686\u5411\u5BFC", "page-open", { kind: "primary", focusKey: "migrate-clone", dataset: { page: "task" } })]), state);
    const archiveEntry = objectRow([
      h("span", { class: "obj-title", text: "\u751F\u6210\u4E00\u4EFD\u5F52\u6863\u6216\u79BB\u7EBF\u5305" }),
      h("span", { class: "obj-sub", text: "\u5F52\u6863\u53EA\u542B\u67D0\u6761\u63D0\u4EA4\u7684\u6587\u4EF6\u5FEB\u7167\u3002\u79BB\u7EBF\u5305\u5E26\u5B8C\u6574\u5386\u53F2\uFF0C\u53EF\u5728\u6CA1\u6709\u7F51\u7EDC\u65F6\u514B\u9686\u56DE\u6765\u3002" })
    ], [actionButton("\u6253\u5F00\u5BFC\u51FA\u5411\u5BFC", "page-open", { focusKey: "migrate-archive", dataset: { page: "task" } })]);
    const backup = h(
      "div",
      { class: "note-block" },
      note("\u5907\u4EFD\u5EFA\u8BAE\uFF1A\u628A\u6574\u4E2A\u4ED3\u5E93\u76EE\u5F55\uFF08\u542B .git \u4E0E\u5DE5\u4F5C\u533A\uFF09\u590D\u5236\u5230\u53E6\u4E00\u5757\u78C1\u76D8\u5C31\u591F\u6062\u590D\u5168\u90E8\u5386\u53F2\u3002\u4E0D\u8981\u5728\u4ED3\u5E93\u91CC\u7528\u786C\u94FE\u63A5\u505A\u5907\u4EFD\u3002", "warn"),
      note("\u6062\u590D\u8DEF\u5F84\uFF1A\u79BB\u7EBF\u5305\u7528 git clone <\u5305\u6587\u4EF6>\u3002\u5F52\u6863\u7528\u89E3\u538B\u3002\u5386\u53F2\u5BFC\u51FA/\u5BFC\u5165\u5C5E\u4E8E\u6574\u4ED3\u4E0D\u53EF\u9006\u52A8\u4F5C\uFF0C\u5148\u8FDB\u7EF4\u62A4\u9875\u5371\u9669\u533A\u6838\u5BF9\u3002", "muted")
    );
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u514B\u9686\u4E0E\u521D\u59CB\u5316", "2 \u6761\u80FD\u529B", "\u4E24\u4E2A\u52A8\u4F5C\u90FD\u4F1A\u65B0\u5EFA\u76EE\u5F55\uFF0C\u4E0D\u4F1A\u6539\u52A8\u5F53\u524D\u4ED3\u5E93\u3002\u9996\u6B21\u6253\u5F00\u65F6\u5148\u95EE\u6E05\u76EE\u6807\u8DEF\u5F84\u4E0E\u662F\u5426\u8981\u5B8C\u6574\u5386\u53F2\u3002", [cloneEntry, rows[0]]),
      section("\u5F52\u6863\u4E0E\u79BB\u7EBF\u5305", "2 \u6761\u80FD\u529B", "\u4EA7\u51FA\u662F\u4E00\u4EFD\u6587\u4EF6\uFF1A\u754C\u9762\u8981\u5199\u6E05\u653E\u54EA\u3001\u591A\u5927\u3001\u662F\u5426\u542B\u5DE5\u4F5C\u533A\u3002\u751F\u6210\u65F6\u95F4\u957F\u7684\u8D70\u4EFB\u52A1\u8FDB\u5EA6\u9875\u3002", [archiveEntry]),
      section("\u5386\u53F2\u4E0E\u90AE\u4EF6", "2 \u6761\u80FD\u529B", "\u5BFC\u51FA/\u5BFC\u5165\u5386\u53F2\u4E0E\u751F\u6210\u8865\u4E01\u90AE\u4EF6\u90FD\u4EA7\u51FA\u4E00\u4EFD\u6587\u4EF6\u3002\u524D\u8005\u6574\u4ED3\u4E0D\u53EF\u9006\uFF0C\u540E\u8005\u53EA\u5BFC\u51FA\u63D0\u4EA4\u3002", [rows[1]]),
      section("\u5907\u4EFD\u4E0E\u6062\u590D", null, "\u5907\u4EFD\u4E0D\u662F git \u547D\u4EE4\uFF0C\u4F46\u5B83\u662F\u6240\u6709\u4E0D\u53EF\u9006\u52A8\u4F5C\u7684\u6700\u540E\u4E00\u9053\u4FDD\u9669\uFF0C\u6240\u4EE5\u5199\u5728\u8FD9\u4E00\u9875\u3002", [backup]),
      capabilitiesSection("migrate", state, ["8.16", "11.1", "14.1"])
    );
    return pageShell("migrate", PAGE_META.migrate.title, PAGE_META.migrate.lede, null, body, { danger: true });
  }
  var CONFIG_GROUP = {
    identity: { title: "\u8EAB\u4EFD", note: "\u63D0\u4EA4\u91CC\u663E\u793A\u7684\u59D3\u540D\u4E0E\u90AE\u7BB1\u3002\u53EA\u5F71\u54CD\u65B0\u63D0\u4EA4\uFF0C\u4E0D\u6539\u5DF2\u6709\u5386\u53F2\u3002" },
    lineEndings: { title: "\u884C\u5C3E\u4E0E\u5927\u5C0F\u5199", note: "\u6362\u884C\u7B26\u4E0E\u6587\u4EF6\u540D\u5927\u5C0F\u5199\u7684\u53E3\u5F84\u3002\u4ED3\u5E93\u8DE8 Windows \u4E0E macOS \u65F6\u6700\u5BB9\u6613\u51FA\u95EE\u9898\u3002" },
    hooks: { title: "\u94A9\u5B50\u8DEF\u5F84", note: "\u94A9\u5B50\u9ED8\u8BA4\u5728\u4ED3\u5E93\u7684 .git/hooks\u3002\u914D\u4E86 core.hooksPath \u5C31\u6539\u5230\u522B\u5904\u3002" },
    credentials: { title: "\u51ED\u636E", note: "\u53EA\u5C55\u793A\u51ED\u636E\u6765\u6E90\u7C7B\u578B\uFF0C\u6C38\u8FDC\u4E0D\u5C55\u793A\u51ED\u636E\u539F\u6587\u3002" }
  };
  function renderConfig(ctx) {
    const { state } = ctx;
    const lookup = (key, scope) => {
      const hit = capturedConfig.find((entry) => entry.key === key && entry.scope === scope);
      return hit === void 0 ? null : hit.value;
    };
    const cell = (key, scope) => {
      const value = lookup(key, scope);
      return { key: key + (scope === "global" ? "\uFF08\u5168\u5C40\uFF09" : ""), value: value ?? "\u672A\u914D\u7F6E", mono: value !== null, tone: value === null ? "muted" : "muted" };
    };
    const groups = [];
    const groupOf = (groupKey, facts, actionLabel, actionNote) => {
      const meta = CONFIG_GROUP[groupKey];
      groups.push(fold(groupKey, meta.title, null, state.expanded.includes(groupKey), [
        factGrid(facts),
        h("p", { class: "fold-actions" }, actionButton(actionLabel, "page-demo", { focusKey: "config-" + groupKey, dataset: { note: actionNote } }))
      ], meta.note));
    };
    groupOf("identity", [
      cell("user.name", "local"),
      cell("user.email", "local"),
      cell("user.name", "global"),
      cell("user.email", "global")
    ], "\u6539\u8EAB\u4EFD", "\u5DF2\u6253\u5F00\u8EAB\u4EFD\u7F16\u8F91\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u53EA\u5F71\u54CD\u4E4B\u540E\u7684\u65B0\u63D0\u4EA4\u3002");
    groupOf("lineEndings", [
      cell("core.eol", "local"),
      cell("core.autocrlf", "local"),
      cell("core.ignorecase", "local")
    ], "\u6539\u884C\u5C3E\u89C4\u5219", "\u5DF2\u6253\u5F00\u884C\u5C3E\u7F16\u8F91\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u6539\u89C4\u5219\u53EF\u80FD\u8BA9\u5DE5\u4F5C\u533A\u6587\u4EF6\u663E\u793A\u4E3A\u5DF2\u4FEE\u6539\uFF0C\u5148\u770B\u5F71\u54CD\u518D\u4FDD\u5B58\u3002");
    groupOf("hooks", [
      cell("core.hooksPath", "local"),
      { key: "\u9ED8\u8BA4\u94A9\u5B50\u76EE\u5F55", value: ".git/hooks\uFF08\u672A\u914D\u7F6E hooksPath \u65F6\uFF09", mono: true }
    ], "\u6539\u94A9\u5B50\u8DEF\u5F84", "\u5DF2\u6253\u5F00\u94A9\u5B50\u8DEF\u5F84\u7F16\u8F91\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u6539\u8DEF\u5F84\u540E\u539F\u76EE\u5F55\u91CC\u7684\u94A9\u5B50\u4E0D\u518D\u751F\u6548\u3002");
    groupOf("credentials", [
      { key: "credential.helper\uFF08\u5168\u5C40\uFF09", value: lookup("credential.helper", "global") ?? "\u672A\u914D\u7F6E", mono: true },
      { key: "credential.helper\uFF08\u672C\u5730\uFF09", value: lookup("credential.helper", "local") ?? "\u672A\u914D\u7F6E", mono: true },
      { key: "\u9762\u677F\u6301\u6709\u7684\u51ED\u636E", value: "\u4E0D\u6301\u6709\uFF1A\u63A8\u9001\u4E0E\u62C9\u53D6\u7531\u5BBF\u4E3B\u8FDB\u7A0B\u8C03\u7528 git \u51ED\u636E\u52A9\u624B", tone: "warn" }
    ], "\u6253\u5F00\u51ED\u636E\u8BF4\u660E", "\u51ED\u636E\u539F\u6587\u6C38\u8FDC\u4E0D\u4F1A\u663E\u793A\u5728\u9762\u677F\u91CC\u3002\u8FD9\u91CC\u53EA\u80FD\u770B\u5230\u6765\u6E90\u7C7B\u578B\u4E0E\u7531\u8C01\u63D0\u4F9B\u3002");
    const readOnlyRows = ["12.1", "12.7", "12.8"].map((id) => {
      const cap = capOf(id);
      return capWrap(cap, objectRow([capabilitySummary(cap), h("span", { class: "obj-sub", text: cap.opens })], [capabilityAction(cap)]), state);
    });
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u76F8\u5173\u914D\u7F6E", "8 \u6761\u952E", "\u53EA\u5217\u4E0E\u7248\u672C\u7BA1\u7406\u754C\u9762\u76F4\u63A5\u76F8\u5173\u7684\u952E\u3002\u503C\u6765\u81EA\u672C\u4ED3\u5E93\u7684\u771F\u5B9E\u914D\u7F6E\uFF0C\u6CA1\u914D\u7684\u5199\u300C\u672A\u914D\u7F6E\u300D\u3002", groups),
      section("\u53EA\u8BFB\u8BFB\u53D6", "3 \u6761", "\u5C5E\u6027\u89C4\u5219\u4E0E\u90AE\u4EF6\u6620\u5C04\u53EA\u5C55\u793A\u8BFB\u5230\u7684\u5185\u5BB9\uFF0C\u4E0D\u5728\u9762\u677F\u91CC\u7F16\u8F91\u3002\u8BFB\u53D6\u7ED3\u679C\u8D34\u5728\u884C\u5185\u3002", readOnlyRows),
      capabilitiesSection("config", state, ["12.1", "12.7", "12.8"])
    );
    return pageShell("config", PAGE_META.config.title, PAGE_META.config.lede, null, body);
  }
  function renderHooks(ctx) {
    const { state } = ctx;
    const enabled = capturedHooks.filter((hook) => !hook.sample);
    const samples = capturedHooks.filter((hook) => hook.sample);
    const rows = capturedHooks.map((hook) => objectRow([
      h("span", { class: "obj-title" }, h("span", { class: "mono", text: hook.name }), hook.sample ? chip("\u793A\u4F8B", "muted", { small: true }) : chip("\u5DF2\u542F\u7528", "ok", { small: true })),
      h("span", { class: "obj-sub", text: hook.sample ? "git \u521D\u59CB\u5316\u81EA\u5E26\u7684\u793A\u4F8B\uFF0C\u6CA1\u6709\u88AB\u542F\u7528\u3002\u6539\u540D\u53BB\u6389 .sample \u624D\u4F1A\u751F\u6548\u3002" : "\u8FD9\u4E2A\u94A9\u5B50\u4F1A\u5728\u5BF9\u5E94 git \u52A8\u4F5C\u524D\u540E\u88AB\u6267\u884C\u3002" })
    ], hook.sample ? [actionButton("\u542F\u7528", "page-demo", { focusKey: "hook-enable-" + hook.name, dataset: { note: "\u5DF2\u628A " + hook.name + " \u7684\u793A\u4F8B\u590D\u5236\u4E3A\u53EF\u6267\u884C\u94A9\u5B50\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u771F\u5B9E\u6267\u884C\u524D\u8BF7\u5148\u8BFB\u4E00\u904D\u811A\u672C\u5185\u5BB9\u3002" } })] : [actionButton("\u505C\u7528", "page-demo", { focusKey: "hook-disable-" + hook.name, dataset: { note: "\u5DF2\u505C\u7528\u94A9\u5B50 " + hook.name + "\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u4E0D\u4F1A\u5220\u9664\u811A\u672C\uFF0C\u53EA\u6539\u6587\u4EF6\u540D\u3002" } })]));
    const facts = factGrid([
      { key: "\u94A9\u5B50\u76EE\u5F55", value: capturedRepoRoot + "/.git/hooks", mono: true },
      { key: "core.hooksPath", value: "\u672A\u914D\u7F6E\uFF08\u7528\u9ED8\u8BA4\u76EE\u5F55\uFF09" },
      { key: "\u5DF2\u542F\u7528", value: enabled.length + " \u4E2A" },
      { key: "\u793A\u4F8B", value: samples.length + " \u4E2A" },
      { key: "\u7F16\u8F91\u65B9\u5F0F", value: "\u4EA4\u7ED9\u5916\u90E8\u7F16\u8F91\u5668\u3002\u9762\u677F\u4E0D\u5185\u5D4C\u7F16\u8F91\u5668" }
    ]);
    const runCap = capOf("12.6");
    const runRow = capabilityBlock(runCap, [
      capabilitySummary(runCap),
      h("span", { class: "obj-sub", text: "\u624B\u52A8\u8DD1\u4E00\u4E2A\u94A9\u5B50\u53EA\u5F71\u54CD\u672C\u6B21\u52A8\u4F5C\u3002\u6267\u884C\u524D\u63D0\u793A\u8FD9\u4E2A\u94A9\u5B50\u4F1A\u8BFB\u5199\u54EA\u4E9B\u8DEF\u5F84\u3002" })
    ], state);
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u94A9\u5B50\u76EE\u5F55", null, "\u6E05\u5355\u6765\u81EA .git/hooks \u7684\u771F\u5B9E\u6587\u4EF6\u3002\u793A\u4F8B\u4E0D\u7B97\u5DF2\u542F\u7528\u3002", [facts]),
      section("\u94A9\u5B50\u6E05\u5355", capturedHooks.length + " \u4E2A\u6587\u4EF6", "\u6309\u6587\u4EF6\u540D\u6392\u5E8F\u3002\u6BCF\u4E2A\u6587\u4EF6\u90FD\u80FD\u770B\u5230\u5B83\u662F\u4E0D\u662F\u793A\u4F8B\u3001\u4F1A\u4E0D\u4F1A\u88AB\u6267\u884C\u3002", rows),
      section("\u624B\u52A8\u8FD0\u884C", "1 \u6761", null, [runRow]),
      capabilitiesSection("hooks", state, ["12.6"])
    );
    return pageShell("hooks", PAGE_META.hooks.title, PAGE_META.hooks.lede, null, body);
  }
  function renderDiagnostics(ctx) {
    const { state } = ctx;
    const statusLines = capturedStatusRaw.split("\n").filter((line) => line.trim() !== "");
    const facts = factGrid([
      { key: "git \u7248\u672C", value: capturedGitVersion },
      { key: "describe", value: capturedDescribe, mono: true },
      { key: "HEAD", value: capturedHead.slice(0, 7) + "\uFF08" + capturedBranch + "\uFF09", mono: true },
      { key: "\u5F15\u7528\u603B\u6570", value: capturedRefsTotal + " \u6761 \xB7 \u672C\u5730\u5206\u652F " + capturedLocalBranches + " \u6761" },
      { key: "\u5DE5\u4F5C\u6811", value: capturedWorktrees.length + " \u68F5" },
      { key: "\u5DE5\u4F5C\u533A\u72B6\u6001\u884C", value: statusLines.length + " \u884C" },
      { key: "\u4ED3\u5E93\u6839", value: capturedRepoRoot, mono: true }
    ]);
    const readShapes = [
      { id: "13.5", value: capturedHead.slice(0, 7) + " \u7684\u5BF9\u8C61\u7C7B\u578B\uFF1Acommit\u3002\u5927\u5C0F\u4E0E\u6B63\u6587\u7531 cat-file \u8BFB\u53D6", hint: "\u53EA\u8BFB\u5BF9\u8C61\u5185\u5BB9\u3002\u4E8C\u8FDB\u5236\u4E0E\u8D85\u5927\u5BF9\u8C61\u6539\u7ED9\u300C\u5728\u5916\u90E8\u67E5\u770B\u300D\u3002" },
      { id: "13.6", value: "\u9876\u5C42\uFF1A" + statusLines.length + " \u6761\u72B6\u6001\u884C\uFF0C\u6811\u6761\u76EE\u7531 ls-tree \u9012\u5F52\u8BFB\u53D6", hint: "\u770B\u6811\u53EA\u8BFB\u8DEF\u5F84\u4E0E\u6A21\u5F0F\uFF0C\u4E0D\u5C55\u5F00\u6587\u4EF6\u5185\u5BB9\u3002" },
      { id: "13.7", value: capturedBranch + " \u2192 " + capturedHead.slice(0, 7), hint: "\u628A\u5206\u652F\u540D\u3001\u5F15\u7528\u3001\u8DEF\u5F84\u89E3\u6790\u6210\u63D0\u4EA4\u53F7\u3002" },
      { id: "13.8", value: capturedRefsTotal + " \u6761\u5F15\u7528\uFF08\u5206\u652F\u3001\u6807\u7B7E\u3001\u8FDC\u7AEF\u8DDF\u8E2A\uFF09", hint: "\u679A\u4E3E\u5F15\u7528\u5E76\u6807\u51FA\u6307\u5411\u540C\u4E00\u63D0\u4EA4\u7684\u5F15\u7528\u7EC4\u3002" },
      { id: "13.9", value: capturedBranch + " \u4E0E origin/" + capturedBranch + " \u7684\u5305\u542B\u5173\u7CFB\uFF1A\u9886\u5148 2 \u6761", hint: "\u5305\u542B\u5173\u7CFB\u5C31\u662F pre-push \u7684\u5224\u5B9A\u4F9D\u636E\u3002" },
      { id: "13.11", value: "HEAD \u4E0E origin/" + capturedBranch + "\uFF1A2 \u6761\u63D0\u4EA4\u5DE6\u53F3\u5DEE", hint: "\u8BA1\u6570\u4E0E\u5DE6\u53F3\u5DEE\u53EA\u8BFB\uFF0C\u4E0D\u6539\u5199\u5386\u53F2\u3002" }
    ];
    const shapeRows = readShapes.map((item) => {
      const cap = capOf(item.id);
      return capWrap(cap, objectRow([
        capabilitySummary(cap),
        h("span", { class: "obj-meta mono", text: item.value }),
        h("span", { class: "obj-sub", text: item.hint })
      ], [chip("\u53EA\u8BFB", "muted", { small: true })]), state);
    });
    const fsckCap = capOf("11.2");
    const fsckRow = capWrap(fsckCap, objectRow([
      capabilitySummary(fsckCap),
      h("span", { class: "obj-sub", text: "\u5B8C\u6574\u6027\u68C0\u67E5\u5728\u539F\u578B\u91CC\u6CA1\u6709\u8FD0\u884C\uFF1A\u5B83\u4F1A\u8BFB\u5168\u5E93\u5BF9\u8C61\uFF0C\u771F\u5B9E\u5B9E\u73B0\u91CC\u663E\u793A\u8FDB\u5EA6\u4E0E\u300C\u53D1\u73B0\u51E0\u4E2A\u95EE\u9898\u300D\uFF0C\u4E0D\u5199\u4ED3\u5E93\u3002" })
    ], [actionButton("\u6F14\u793A\u4E00\u6B21\u68C0\u67E5", "page-demo", { focusKey: "diag-fsck", dataset: { note: "\u5B8C\u6574\u6027\u68C0\u67E5\u5DF2\u8DD1\u5B8C\uFF08\u539F\u578B\u6A21\u62DF\uFF09\uFF1A0 \u4E2A\u635F\u574F\u5BF9\u8C61\uFF0C0 \u4E2A\u7F3A\u5931\u5BF9\u8C61\u3002" } })]), state);
    const bisectCap = capOf("13.1");
    const bisectRow = capabilityBlock(bisectCap, [
      capabilitySummary(bisectCap),
      h("span", { class: "obj-sub", text: "\u4E8C\u5206\u5B9A\u4F4D\u8981\u9009\u4E00\u6BB5\u63D0\u4EA4\u8303\u56F4\u4E0E\u4E00\u4E2A\u597D/\u574F\u5224\u5B9A\u3002\u5B83\u4F1A\u68C0\u51FA\u4E2D\u95F4\u63D0\u4EA4\uFF0C\u7ED3\u675F\u540E\u8981\u56DE\u5230\u539F\u5206\u652F\u3002" })
    ], state);
    const logCap = capOf("3.11");
    const logRow = capWrap(logCap, objectRow([
      capabilitySummary(logCap),
      h("span", { class: "obj-sub", text: "\u5F15\u7528\u65E5\u5FD7\u6309\u65F6\u95F4\u5012\u5E8F\u5217\u51FA HEAD \u4E0E\u5206\u652F\u7684\u79FB\u52A8\u8BB0\u5F55\u3002\u5B83\u662F\u8BEF\u64CD\u4F5C\u540E\u7684\u7B2C\u4E00\u9053\u627E\u56DE\u5165\u53E3\u3002" })
    ], [actionButton("\u770B\u5F15\u7528\u65E5\u5FD7\u5F62\u72B6", "page-demo", { focusKey: "diag-reflog", dataset: { note: "\u5F15\u7528\u65E5\u5FD7\u793A\u4F8B\uFF1AHEAD@{0} \u503C\uFF1A" + capturedHead.slice(0, 7) + "\uFF0810 \u5206\u949F\u524D\uFF09\u3002HEAD@{1} \u503C\uFF1A\u4E0A\u4E00\u63D0\u4EA4\uFF0812 \u5206\u949F\u524D\uFF09\u3002" } })]), state);
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u7248\u672C\u4E0E\u8BA1\u6570", null, "\u8FD9\u4E9B\u6570\u5B57\u5168\u90E8\u6765\u81EA\u672C\u4ED3\u5E93\u6B64\u523B\u7684 git \u8BFB\u6570\u3002\u8BFB\u4E0D\u5230\u65F6\u754C\u9762\u5199\u300C\u8BFB\u4E0D\u5230\u300D\uFF0C\u4E0D\u5199 0\u3002", [facts]),
      section("\u53EA\u8BFB\u5BF9\u8C61\u67E5\u770B", "6 \u6761", "\u5E95\u5C42\u6392\u67E5\u53EA\u5C55\u793A\u8BFB\u5230\u7684\u5F62\u72B6\uFF0C\u4E0D\u63D0\u4F9B\u53EF\u64CD\u4F5C\u6309\u94AE\u3002\u9700\u8981\u6267\u884C\u65F6\u4EA4\u7ED9\u7EC8\u7AEF\u6216\u8BCA\u65AD\u5DE5\u5177\u3002", shapeRows),
      section("\u68C0\u67E5\u4E0E\u5B9A\u4F4D", "4 \u6761", "\u5B8C\u6574\u6027\u68C0\u67E5\u3001\u53EF\u56DE\u6536\u5BF9\u8C61\u3001\u4E8C\u5206\u5B9A\u4F4D\u4E0E\u5F15\u7528\u65E5\u5FD7\uFF1A\u90FD\u80FD\u5728\u9762\u677F\u91CC\u53D1\u8D77\u5E76\u770B\u5230\u7ED3\u679C\uFF0C\u4F46\u90FD\u4E0D\u5199\u63D0\u4EA4\u3002", [fsckRow, bisectRow, logRow]),
      capabilitiesSection("diagnostics", state, [...readShapes.map((item) => item.id), "11.2", "13.1", "3.11"])
    );
    return pageShell("diagnostics", PAGE_META.diagnostics.title, PAGE_META.diagnostics.lede, null, body);
  }
  function renderPlatform(ctx) {
    const { state } = ctx;
    const origin = capturedRemotes.find((remote) => remote.name === "origin");
    const webUrl = origin === void 0 ? "" : origin.fetchUrl.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/");
    const platformCaps = CAPABILITIES.filter((cap) => cap.target === "platform");
    const whereOf = (id) => {
      switch (id) {
        case "14.2":
          return { where: "\u5728\u7EC8\u7AEF\u7528 git format-patch \u751F\u6210\u8865\u4E01\u6587\u4EF6\uFF0C\u518D\u4EA4\u7ED9\u90AE\u4EF6\u5BA2\u6237\u7AEF\u3002\u9762\u677F\u4E0D\u4EE3\u53D1\u90AE\u4EF6\u3002", url: null };
        case "14.4":
          return { where: "\u5728\u6258\u7BA1\u5E73\u53F0\u7684\u7F51\u9875\u4E0A\u5904\u7406 PR\u3001Issue \u4E0E Release\u3002", url: webUrl };
        case "14.5":
          return { where: "Actions \u4E0E CI \u72B6\u6001\u5728\u5E73\u53F0\u7F51\u9875\u770B\u3002\u672C\u4ED3\u5E93\u5DF2\u4E8E 2026-10-26 \u4E0B\u7EBF\u8FDC\u7AEF\u9A8C\u8BC1\u5DE5\u4F5C\u6D41\uFF08#1542\uFF09\uFF0C\u672C\u5730 npm run verify:parallel \u662F\u552F\u4E00\u88C1\u51B3\u5165\u53E3\u3002", url: webUrl + "/actions" };
        case "14.6":
          return { where: "\u8D26\u53F7\u3001\u4EE4\u724C\u4E0E\u6743\u9650\u5728\u5E73\u53F0\u8BBE\u7F6E\u9875\u7BA1\u7406\u3002\u9762\u677F\u4E0D\u6301\u6709\u5E73\u53F0\u4EE4\u724C\u3002", url: webUrl + "/settings" };
        case "14.7":
          return { where: "\u5206\u652F\u4FDD\u62A4\u4E0E\u7981\u6B62\u5F3A\u63A8\u662F\u670D\u52A1\u7AEF\u89C4\u5219\uFF0C\u5728\u5E73\u53F0\u8BBE\u7F6E\u9875\u914D\u7F6E\u3002", url: webUrl + "/settings/branches" };
        case "14.8":
          return { where: "\u4ED3\u5E93\u8F6C\u79FB\u4E0E\u5F52\u6863\u5728\u5E73\u53F0\u8BBE\u7F6E\u9875\u5B8C\u6210\uFF0C\u6210\u529F\u540E\u672C\u5730\u8FDC\u7AEF\u5730\u5740\u8981\u8DDF\u7740\u6539\u3002", url: webUrl + "/settings" };
        default:
          return { where: "\u9762\u677F\u4E0D\u4EE3\u505A\u8FD9\u4E00\u6B65\u3002", url: null };
      }
    };
    const rows = platformCaps.map((cap) => {
      const where = whereOf(cap.id);
      const side = [chip("\u53EA\u8BFB", "muted", { small: true })];
      if (where.url !== null && where.url !== "") {
        side.push(h("a", {
          class: "btn btn-secondary btn-sm ext-link",
          attrs: { href: where.url, target: "_blank", rel: "noreferrer", "data-focus-key": "ext-" + cap.id }
        }, "\u5728\u7F51\u9875\u6253\u5F00"));
      }
      return capWrap(cap, objectRow([
        capabilitySummary(cap),
        h("span", { class: "obj-meta", text: where.where }),
        h("span", { class: "obj-sub", text: cap.command })
      ], side), state);
    });
    const boundaries = [
      ["\u4E0D\u5185\u5D4C\u7F16\u8F91\u5668", "\u63D0\u4EA4\u8BF4\u660E\u3001\u5408\u5E76\u8BF4\u660E\u3001\u94A9\u5B50\u6B63\u6587\u90FD\u53EF\u4EE5\u4EA4\u7ED9 AI \u8D77\u8349\uFF0C\u4F46\u300C\u7528\u7F16\u8F91\u5668\u5199\u5B8C\u6574\u8BF4\u660E\u300D\u8FD9\u7C7B\u80FD\u529B\u56DE\u5916\u90E8\u7F16\u8F91\u5668\u5B8C\u6210\uFF08#1588 \u7B2C 4 \u8282\uFF09\u3002"],
      ["\u4E0D\u6301\u6709\u5E73\u53F0\u4EE4\u724C", "PR\u3001Issue\u3001Actions\u3001\u5206\u652F\u4FDD\u62A4\u8FD9\u4E9B\u7F51\u9875\u7AEF\u80FD\u529B\uFF0C\u9762\u677F\u53EA\u7ED9\u5165\u53E3\u4E0E\u89E3\u91CA\uFF0C\u4E0D\u4EE3\u505A\u3001\u4E0D\u4FDD\u5B58\u4EE4\u724C\u3002"],
      ["\u4E0D\u9690\u85CF\u957F\u4EFB\u52A1", "\u514B\u9686\u3001\u8FC1\u79FB\u3001\u5F52\u6863\u8FD9\u4E9B\u8017\u65F6\u52A8\u4F5C\u4F1A\u663E\u793A\u8FDB\u5EA6\u4E0E\u53D6\u6D88\u540E\u679C\uFF0C\u4E0D\u5728\u9762\u677F\u91CC\u5047\u88C5\u77AC\u65F6\u5B8C\u6210\u3002"],
      ["\u4E0D\u66FF\u4EBA\u505A\u6574\u4ED3\u91CD\u5199", "filter-repo \u5168\u5E93\u91CD\u5199\u3001fast-import \u8986\u76D6\u5BFC\u5165\u3001\u5F15\u7528\u683C\u5F0F\u8FC1\u79FB\u90FD\u653E\u7EF4\u62A4\u9875\u5371\u9669\u533A\uFF0C\u5148\u6838\u5BF9\u518D\u4EA4\u7ED9\u4E13\u95E8\u5DE5\u5177\u3002"]
    ];
    const boundaryRows = boundaries.map((item) => objectRow([
      h("span", { class: "obj-title", text: item[0] }),
      h("span", { class: "obj-sub", text: item[1] })
    ], null));
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u4EA4\u51FA\u53BB\u7684\u516D\u6761\u80FD\u529B", platformCaps.length + " \u6761", "\u8FD9\u4E9B\u80FD\u529B\u6CA1\u6709\u9762\u677F\u5165\u53E3\uFF1A\u4E0D\u662F\u4E0D\u505A\uFF0C\u800C\u662F\u505A\u5728\u9762\u677F\u91CC\u4F1A\u8D8A\u8FC7\u6743\u9650\u8FB9\u754C\u6216\u66FF\u7528\u6237\u9690\u7792\u540E\u679C\u3002", rows),
      section("\u56DB\u6761\u8FB9\u754C", null, "\u8FB9\u754C\u5199\u5728\u8FD9\u91CC\uFF0C\u662F\u4E3A\u4E86\u8BA9\u4E0B\u6E38\u5199\u89C4\u683C\u65F6\u77E5\u9053\u300C\u4E0D\u8981\u5B9E\u73B0\u4EC0\u4E48\u300D\u3002", boundaryRows),
      capabilitiesSection("platform", state, platformCaps.map((cap) => cap.id))
    );
    return pageShell("platform", PAGE_META.platform.title, PAGE_META.platform.lede, null, body);
  }

  // docs/prototype/vc-redesign/src/ui/views/pages-flow.ts
  var REBASE_STAGES = [
    {
      title: "\u51BB\u7ED3\u5DE5\u4F5C\u533A",
      detail: "\u5148\u628A\u672A\u63D0\u4EA4\u7684\u6539\u52A8\u6536\u8D77\u6765\u6216\u63D0\u793A\u5148\u63D0\u4EA4\u3002\u53D8\u57FA\u8FC7\u7A0B\u4E2D\u5DE5\u4F5C\u533A\u5FC5\u987B\u662F\u5E72\u51C0\u7684\uFF0C\u5426\u5219\u6BCF\u4E00\u6B65\u7684\u51B2\u7A81\u90FD\u5206\u4E0D\u6E05\u6765\u81EA\u8C01\u3002",
      command: "git stash push --keep-index",
      tone: "ok"
    },
    {
      title: "\u9009\u65B0\u57FA\u5EA7",
      detail: "\u65B0\u57FA\u5EA7\u662F\u4E00\u6761\u5DF2\u7ECF\u5B58\u5728\u7684\u63D0\u4EA4\u3002\u9009\u62E9\u65F6\u663E\u793A\u5B83\u4E0E\u5F53\u524D\u5206\u652F\u7684\u5171\u540C\u7956\u5148\uFF0C\u8BA9\u4EBA\u770B\u6E05\u8981\u642C\u7684\u662F\u54EA\u51E0\u6761\u63D0\u4EA4\u3002",
      command: "git rebase --onto <\u65B0\u57FA\u5EA7> <\u65E7\u57FA\u5EA7>",
      tone: "ok"
    },
    {
      title: "\u6574\u7406\u5F85\u529E\u6E05\u5355",
      detail: "\u4E09\u6761\u63D0\u4EA4\u53EF\u4EE5\u4FDD\u6301\u539F\u6837\uFF0C\u4E5F\u53EF\u4EE5\u538B\u7F29\u3001\u6539\u5199\u8BF4\u660E\u6216\u8C03\u6574\u987A\u5E8F\u3002\u6E05\u5355\u53EA\u5728\u672C\u9875\u5185\u5B58\u91CC\uFF0C\u4E0D\u5199\u4ED3\u5E93\u3002",
      command: "git rebase -i <\u65B0\u57FA\u5EA7>",
      tone: "ok"
    },
    {
      title: "\u9010\u6B65\u5E94\u7528",
      detail: "\u6BCF\u5E94\u7528\u4E00\u6761\u63D0\u4EA4\u5C31\u505C\u4E00\u4E0B\uFF1A\u6210\u529F\u5C31\u7EE7\u7EED\uFF0C\u51B2\u7A81\u5C31\u8DF3\u5230\u300C\u51B2\u7A81\u5904\u7F6E\u300D\u9875\u3002\u8FD9\u4E00\u6B65\u53EF\u4EE5\u968F\u65F6\u4E2D\u6B62\u5E76\u56DE\u5230\u5F00\u59CB\u524D\u7684\u63D0\u4EA4\u3002",
      command: "git rebase --continue / --abort",
      tone: "warn"
    },
    {
      title: "\u6821\u9A8C\u7ED3\u679C",
      detail: "\u91CD\u65B0\u8DD1\u4E00\u904D\u672C\u5730\u68C0\u67E5\uFF0C\u786E\u8BA4\u6811\u5185\u5BB9\u4E0E\u9884\u671F\u4E00\u81F4\u3001\u6CA1\u6709\u4E22\u63D0\u4EA4\u3002\u6821\u9A8C\u901A\u8FC7\u624D\u5141\u8BB8\u79FB\u52A8\u5206\u652F\u6307\u9488\u3002",
      command: "git range-diff <\u65E7\u5206\u652F> <\u65B0\u5206\u652F>",
      tone: "ok"
    },
    {
      title: "\u5B8C\u6210\u6216\u56DE\u6EDA",
      detail: "\u5B8C\u6210\u65F6\u53EA\u79FB\u52A8\u5F53\u524D\u5206\u652F\u6307\u9488\uFF0C\u5176\u4ED6\u5206\u652F\u4E0D\u52A8\u3002\u56DE\u6EDA\u7528\u53D8\u57FA\u5F00\u59CB\u524D\u8BB0\u4E0B\u7684\u63D0\u4EA4\u53F7\uFF0C\u4E0D\u4F9D\u8D56\u5F15\u7528\u65E5\u5FD7\u3002",
      command: "git reset --hard <\u5F00\u59CB\u524D\u63D0\u4EA4\u53F7>",
      tone: "ok"
    }
  ];
  function renderRebase(ctx) {
    const { state } = ctx;
    const todo = capturedCommits.slice(0, 3);
    const intro = objectRow([
      h("span", { class: "obj-title", text: "\u628A\u5F53\u524D\u5206\u652F\u7684\u4E09\u6761\u63D0\u4EA4\u642C\u5230\u65B0\u57FA\u5EA7\u4E0A\uFF08\u6F14\u793A\uFF09" }),
      h("span", { class: "obj-sub", text: "\u53D8\u57FA\u4F1A\u91CD\u5199\u8FD9\u4E09\u6761\u63D0\u4EA4\u7684\u63D0\u4EA4\u53F7\u3002\u6F14\u793A\u53EA\u6539\u9875\u9762\u72B6\u6001\uFF0C\u4E0D\u52A8\u672C\u5730\u4ED3\u5E93\u3002\u5F00\u59CB\u524D\u5148\u8BB0\u4E0B\u5F53\u524D\u63D0\u4EA4\u53F7\uFF0C\u4E2D\u6B62\u65F6\u7528\u5B83\u56DE\u53BB\u3002" }),
      h("span", { class: "obj-meta mono", text: capturedBranch + " @ " + capturedHead.slice(0, 7) })
    ], [actionButton(state.rebaseDemo ? "\u6F14\u793A\u8FDB\u884C\u4E2D" : "\u5F00\u59CB\u6F14\u793A", "rebase-demo", { kind: "primary", focusKey: "rebase-start", disabled: state.rebaseDemo })]);
    const steps = [];
    const current = Math.min(state.rebaseStep, REBASE_STAGES.length);
    REBASE_STAGES.forEach((stage, index) => {
      const status = index < current ? "\u5DF2\u5B8C\u6210" : index === current ? "\u8FDB\u884C\u4E2D" : "\u5F85\u5904\u7406";
      const tone = index < current ? "ok" : index === current ? "warn" : "muted";
      const row = objectRow([
        h("span", { class: "obj-title" }, h("span", { class: "mono", text: String(index + 1) }), h("span", { text: " " + stage.title })),
        h("span", { class: "obj-sub", text: stage.detail }),
        h("span", { class: "obj-meta mono", text: stage.command })
      ], [chip(status, tone, { small: true })]);
      steps.push(row);
      if (index === current && index === 3) {
        steps.push(h(
          "div",
          { class: "inline-hint" },
          note("\u8FD9\u4E00\u6B65\u53EF\u80FD\u51FA\u73B0\u51B2\u7A81\uFF1A\u53BB\u300C\u51B2\u7A81\u5904\u7F6E\u300D\u9875\u9010\u6587\u4EF6\u9009\u8FB9\u3001\u6807\u8BB0\u5DF2\u89E3\u51B3\uFF0C\u518D\u56DE\u6765\u7EE7\u7EED\u3002", "warn"),
          actionButton("\u53BB\u51B2\u7A81\u5904\u7F6E\u9875", "page-open", { focusKey: "rebase-to-conflicts", dataset: { page: "conflicts" } })
        ));
      }
    });
    const demoBody = [];
    if (!state.rebaseDemo) {
      demoBody.push(note("\u6F14\u793A\u8FD8\u6CA1\u5F00\u59CB\uFF1A\u70B9\u4E0A\u9762\u7684\u300C\u5F00\u59CB\u6F14\u793A\u300D\u8FDB\u5165\u516D\u6B65\u5F85\u529E\u3002\u6BCF\u4E00\u6B65\u90FD\u53EF\u4EE5\u505C\u5728\u8FD9\u91CC\uFF0C\u4E0D\u4F1A\u5F71\u54CD\u4ED3\u5E93\u3002", "muted"));
    } else if (state.rebaseStep >= 6) {
      demoBody.push(h(
        "div",
        { class: "flow-done" },
        chip("\u6F14\u793A\u5B8C\u6210", "ok"),
        h("p", { text: "\u516D\u6B65\u8D70\u5B8C\uFF1A\u4E09\u6761\u63D0\u4EA4\u5DF2\u7ECF\u6362\u5230\u65B0\u57FA\u5EA7\u4E0A\uFF08\u6F14\u793A\u6570\u636E\uFF09\u3002\u771F\u5B9E\u5B9E\u73B0\u91CC\u8FD9\u4E00\u6B65\u4E4B\u540E\u8981\u91CD\u65B0\u8DD1\u672C\u5730\u68C0\u67E5\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u63A8\u9001\u3002" }),
        actionButton("\u56DE\u5230\u7BA1\u7406\u7D22\u5F15", "page-open", { focusKey: "rebase-done", dataset: { page: "manage" } })
      ));
    } else {
      demoBody.push(h(
        "div",
        { class: "flow-controls" },
        actionButton("\u4E0B\u4E00\u6B65", "rebase-step", { kind: "primary", focusKey: "rebase-next", dataset: {} }),
        actionButton("\u4E2D\u6B62\u5E76\u56DE\u5230\u5F00\u59CB\u524D", "rebase-abort", { kind: "danger", focusKey: "rebase-abort" })
      ));
    }
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u672C\u6B21\u53D8\u57FA", null, null, [intro, ...demoBody]),
      section("\u516D\u6B65\u5F85\u529E", state.rebaseDemo ? "\u7B2C " + Math.min(state.rebaseStep + 1, 6) + " / 6 \u6B65" : null, "\u987A\u5E8F\u56FA\u5B9A\uFF0C\u4F46\u6BCF\u4E00\u6B65\u90FD\u53EF\u4EE5\u505C\u4E0B\u6765\u770B\u3002\u6F14\u793A\u4E0D\u4F1A\u8DF3\u8FC7\u300C\u5DE5\u4F5C\u533A\u662F\u5426\u5E72\u51C0\u300D\u8FD9\u4E00\u5173\u3002", steps),
      section("\u4F1A\u52A8\u4E0E\u4E0D\u4F1A\u52A8", null, null, [factGrid([
        { key: "\u4F1A\u52A8", value: "\u5F53\u524D\u5206\u652F\u7684\u63D0\u4EA4\u53F7\u4E0E\u8FD9\u9875\u7684\u6F14\u793A\u72B6\u6001" },
        { key: "\u4E0D\u4F1A\u52A8", value: "\u5176\u4ED6\u5206\u652F\u3001\u8FDC\u7AEF\u3001\u6536\u8D77\u7684\u6539\u52A8" },
        { key: "\u53EF\u6309\u64A4\u9500", value: "\u4E2D\u6B62\u540E\u5206\u652F\u56DE\u5230\u5F00\u59CB\u524D\u8BB0\u4E0B\u7684\u63D0\u4EA4\u53F7" },
        { key: "\u4E0D\u53EF\u6309\u64A4\u9500", value: "\u5DF2\u7ECF\u63A8\u9001\u8FC7\u7684\u91CD\u5199\u9700\u8981\u5F3A\u63A8\uFF0C\u5C5E\u4E8E\u670D\u52A1\u7AEF\u534F\u4F5C\u95EE\u9898" }
      ])]),
      capabilitiesSection("rebase", state)
    );
    return pageShell("rebase", PAGE_META.rebase.title, PAGE_META.rebase.lede, null, body, { danger: true });
  }
  var CONFLICT_FILES = [
    "src/ui/views/history.ts",
    "src/ui/views/branches.ts",
    "styles/app.css"
  ];
  function renderConflicts(ctx) {
    const { state } = ctx;
    const resolved = CONFLICT_FILES.filter((path) => state.conflictResolved.includes(path));
    const intro = objectRow([
      h("span", { class: "obj-title", text: "\u5408\u5E76 " + capturedBranch + " \u4E0E feature/version-control-redesign\uFF08\u6F14\u793A\uFF09" }),
      h("span", { class: "obj-sub", text: "\u4E09\u4E2A\u6587\u4EF6\u540C\u65F6\u88AB\u4E24\u8FB9\u6539\u8FC7\uFF1A\u9010\u6587\u4EF6\u9009\u5F53\u524D\u5206\u652F\u3001\u5BF9\u65B9\uFF0C\u6216\u6253\u5F00\u5916\u90E8\u7F16\u8F91\u5668\u624B\u6539\u3002\u5168\u90E8\u6807\u8BB0\u89E3\u51B3\u540E\u624D\u80FD\u7EE7\u7EED\u3002" }),
      h("span", { class: "obj-meta mono", text: "git merge --no-ff feature/version-control-redesign" })
    ], [actionButton(state.conflictDemo ? "\u6F14\u793A\u8FDB\u884C\u4E2D" : "\u5F00\u59CB\u6F14\u793A", "conflict-demo", { kind: "primary", focusKey: "conflict-start", disabled: state.conflictDemo })]);
    const rows = [];
    for (const path of CONFLICT_FILES) {
      const isResolved = state.conflictResolved.includes(path);
      const chosen = state.conflictChoice;
      const side = [];
      if (isResolved) {
        side.push(chip("\u5DF2\u89E3\u51B3", "ok", { small: true }), actionButton("\u64A4\u9500\u6807\u8BB0", "conflict-resolve", { focusKey: "conflict-undo:" + path, dataset: { path } }));
      } else {
        side.push(
          actionButton("\u9009\u5F53\u524D\u5206\u652F", "conflict-choice", { kind: chosen === "ours" ? "primary" : "secondary", focusKey: "conflict-ours:" + path, dataset: { choice: "ours" } }),
          actionButton("\u9009\u5BF9\u65B9", "conflict-choice", { kind: chosen === "theirs" ? "primary" : "secondary", focusKey: "conflict-theirs:" + path, dataset: { choice: "theirs" } }),
          actionButton("\u6253\u5F00\u5916\u90E8\u7F16\u8F91\u5668", "page-demo", { focusKey: "conflict-edit:" + path, dataset: { note: "\u5DF2\u628A " + path + " \u4EA4\u7ED9\u5916\u90E8\u7F16\u8F91\u5668\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002\u624B\u6539\u4E4B\u540E\u56DE\u6765\u70B9\u300C\u6807\u8BB0\u5DF2\u89E3\u51B3\u300D\u3002" } }),
          actionButton("\u6807\u8BB0\u5DF2\u89E3\u51B3", "conflict-resolve", { kind: "primary", focusKey: "conflict-resolve:" + path, dataset: { path }, disabled: chosen === null })
        );
      }
      rows.push(objectRow([
        h("span", { class: "obj-title" }, h("span", { class: "mono", text: path }), chosen === null ? null : chip("\u5DF2\u9009\uFF1A" + (chosen === "ours" ? "\u5F53\u524D\u5206\u652F" : "\u5BF9\u65B9"), "info", { small: true })),
        h("span", { class: "obj-sub", text: isResolved ? "\u8FD9\u4E2A\u6587\u4EF6\u5DF2\u6807\u8BB0\u89E3\u51B3\u3002\u7EE7\u7EED\u4E4B\u524D\u4ECD\u53EF\u4EE5\u64A4\u9500\u6807\u8BB0\u518D\u9009\u4E00\u6B21\u3002" : "\u4E24\u8FB9\u90FD\u6539\u8FC7\u540C\u4E00\u6BB5\u3002\u9009\u8FB9\u53EA\u5F71\u54CD\u8FD9\u4E2A\u6587\u4EF6\uFF0C\u4E0D\u5F71\u54CD\u5176\u4ED6\u51B2\u7A81\u6587\u4EF6\u3002" })
      ], side));
    }
    const summary = objectRow([
      h("span", { class: "obj-title", text: "\u5DF2\u89E3\u51B3 " + resolved.length + " / " + CONFLICT_FILES.length + " \u4E2A\u6587\u4EF6" }),
      h("span", { class: "obj-sub", text: "\u5168\u90E8\u89E3\u51B3\u540E\u300C\u7EE7\u7EED\u5408\u5E76\u300D\u624D\u53EF\u70B9\u3002\u7EE7\u7EED\u4F1A\u751F\u6210\u4E00\u4E2A\u5408\u5E76\u63D0\u4EA4\uFF0C\u4E2D\u6B62\u4F1A\u56DE\u5230\u5408\u5E76\u5F00\u59CB\u524D\u7684\u72B6\u6001\u3002" })
    ], [
      actionButton("\u7EE7\u7EED\u5408\u5E76", "page-demo", { kind: "primary", focusKey: "conflict-continue", dataset: { note: "\u5408\u5E76\u5DF2\u63D0\u4EA4\uFF08\u539F\u578B\u6A21\u62DF\uFF09\uFF1A\u751F\u6210\u4E00\u4E2A\u5408\u5E76\u63D0\u4EA4\uFF0C\u5DE5\u4F5C\u533A\u6E05\u7A7A\u3002" }, disabled: resolved.length !== CONFLICT_FILES.length }),
      actionButton("\u4E2D\u6B62\u5408\u5E76", "conflict-abort", { kind: "danger", focusKey: "conflict-abort" })
    ]);
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u672C\u6B21\u5408\u5E76", null, null, [intro]),
      section("\u51B2\u7A81\u6587\u4EF6", CONFLICT_FILES.length + " \u4E2A\u6587\u4EF6", "\u6BCF\u4E00\u884C\u53EA\u505A\u4E09\u4EF6\u4E8B\uFF1A\u9009\u8FB9\u3001\u624B\u6539\u3001\u6807\u8BB0\u5DF2\u89E3\u51B3\u3002\u9009\u8FB9\u6309\u94AE\u7684\u72B6\u6001\u8DDF\u7740\u672C\u9875\u5185\u5B58\u8D70\uFF0C\u4E0D\u5199\u4ED3\u5E93\u3002", [...state.conflictDemo ? rows : [note("\u6F14\u793A\u8FD8\u6CA1\u5F00\u59CB\uFF1A\u70B9\u300C\u5F00\u59CB\u6F14\u793A\u300D\u624D\u4F1A\u51FA\u73B0\u4E09\u4E2A\u51B2\u7A81\u6587\u4EF6\u3002", "muted")], ...state.conflictDemo ? [summary] : []]),
      section("\u4F1A\u52A8\u4E0E\u4E0D\u4F1A\u52A8", null, null, [factGrid([
        { key: "\u4F1A\u52A8", value: state.conflictDemo ? "\u4E09\u4E2A\u51B2\u7A81\u6587\u4EF6\u7684\u89E3\u51B3\u6807\u8BB0\u4E0E\u672C\u9875\u7ED3\u679C" : "\u5F53\u524D\u4EC0\u4E48\u90FD\u4E0D\u4F1A\u52A8" },
        { key: "\u4E0D\u4F1A\u52A8", value: "\u5DE5\u4F5C\u533A\u6587\u4EF6\u3001\u300C\u5DF2\u52A0\u5165\u8FD9\u6B21\u63D0\u4EA4\u300D\u7684\u6E05\u5355\u3001\u5DF2\u6709\u63D0\u4EA4" },
        { key: "\u6062\u590D\u8DEF\u5F84", value: "\u4E2D\u6B62\u5408\u5E76\u56DE\u5230\u5F00\u59CB\u524D\u7684\u63D0\u4EA4\u4E0E\u5DE5\u4F5C\u533A" },
        { key: "\u5916\u90E8\u7F16\u8F91\u5668", value: "\u9762\u677F\u4E0D\u5185\u5D4C\u7F16\u8F91\u5668\uFF0C\u53EA\u628A\u6587\u4EF6\u4EA4\u7ED9\u5B83" }
      ])]),
      capabilitiesSection("conflicts", state)
    );
    return pageShell("conflicts", PAGE_META.conflicts.title, PAGE_META.conflicts.lede, null, body, { danger: true });
  }
  var TASK_STAGES = [
    { title: "\u51C6\u5907\u76EE\u6807\u76EE\u5F55", detail: "\u68C0\u67E5\u76EE\u5F55\u662F\u5426\u4E3A\u7A7A\u3001\u78C1\u76D8\u7A7A\u95F4\u591F\u4E0D\u591F\u3002\u514B\u9686\u4F1A\u5148\u5199\u4E00\u4E2A\u4E34\u65F6\u76EE\u5F55\uFF0C\u6210\u529F\u540E\u518D\u6539\u540D\u3002", at: 0 },
    { title: "\u63A5\u6536\u5BF9\u8C61", detail: "\u6309\u5BF9\u8C61\u6570\u91CF\u4E0E\u4F53\u79EF\u663E\u793A\u8FDB\u5EA6\u3002\u7F51\u7EDC\u4E2D\u65AD\u65F6\u53EF\u4EE5\u4ECE\u5DF2\u6536\u5230\u7684\u90E8\u5206\u7EE7\u7EED\uFF0C\u4E0D\u9700\u8981\u4ECE\u5934\u518D\u6765\u3002", at: 20 },
    { title: "\u68C0\u51FA\u6587\u4EF6", detail: "\u628A\u5F53\u524D\u5206\u652F\u7684\u6587\u4EF6\u5199\u5230\u76EE\u6807\u76EE\u5F55\u3002\u8FD9\u4E00\u6B65\u53D7\u78C1\u76D8\u901F\u5EA6\u5F71\u54CD\u6700\u5927\u3002", at: 85 },
    { title: "\u5B8C\u6210\u6821\u9A8C", detail: "\u6838\u5BF9 HEAD \u4E0E\u8FDC\u7AEF\u4E00\u81F4\u3001\u6587\u4EF6\u6570\u91CF\u4E0E\u6743\u9650\u6B63\u786E\u3002\u6821\u9A8C\u901A\u8FC7\u624D\u628A\u4E34\u65F6\u76EE\u5F55\u6539\u540D\u4E3A\u6B63\u5F0F\u76EE\u5F55\u3002", at: 100 }
  ];
  function renderTask(ctx) {
    const { state } = ctx;
    const modes = [
      { key: "clone", title: "\u514B\u9686\u4ED3\u5E93", detail: "\u4ECE\u4E00\u4E2A\u8FDC\u7AEF\u5730\u5740\u62C9\u4E00\u4EFD\u5B8C\u6574\u5386\u53F2\u5230\u672C\u673A\u76EE\u5F55\u3002", command: "git clone <\u5730\u5740> <\u76EE\u5F55>" },
      { key: "archive", title: "\u5BFC\u51FA\u5F52\u6863", detail: "\u53EA\u5BFC\u51FA\u67D0\u6761\u63D0\u4EA4\u7684\u6587\u4EF6\u5FEB\u7167\uFF0C\u4E0D\u542B\u5386\u53F2\u3002\u4EA7\u51FA\u662F\u4E00\u4E2A\u538B\u7F29\u5305\u3002", command: "git archive -o <\u6587\u4EF6> <\u63D0\u4EA4>" },
      { key: "bundle", title: "\u751F\u6210\u79BB\u7EBF\u5305", detail: "\u628A\u5B8C\u6574\u5386\u53F2\u6253\u8FDB\u4E00\u4E2A\u6587\u4EF6\uFF0C\u6CA1\u6709\u7F51\u7EDC\u65F6\u4E5F\u80FD\u514B\u9686\u56DE\u6765\u3002", command: "git bundle create <\u6587\u4EF6> --all" }
    ];
    const chooser = modes.map((mode) => objectRow([
      h("span", { class: "obj-title", text: mode.title }),
      h("span", { class: "obj-sub", text: mode.detail }),
      h("span", { class: "obj-meta mono", text: mode.command })
    ], [actionButton("\u6253\u5F00\u5411\u5BFC", "task-demo", { kind: "primary", focusKey: "task-start-" + mode.key, dataset: {} })]));
    const progress = state.taskDemo ? state.taskProgress : 0;
    const currentStage = TASK_STAGES.findIndex((stage) => progress < stage.at);
    const activeStage = currentStage === -1 ? TASK_STAGES.length - 1 : Math.max(0, currentStage - 1);
    const stageRows = TASK_STAGES.map((stage, index) => objectRow([
      h("span", { class: "obj-title", text: stage.title }),
      h("span", { class: "obj-sub", text: stage.detail })
    ], [chip(progress >= stage.at ? "\u5DF2\u5B8C\u6210" : index === activeStage ? "\u8FDB\u884C\u4E2D" : "\u7B49\u5F85", progress >= stage.at ? "ok" : index === activeStage ? "warn" : "muted", { small: true })]));
    const meter = h(
      "div",
      { class: "task-meter" },
      h("div", { class: "task-meter-bar", attrs: { style: "width: " + progress + "%" } }),
      h("span", { class: "task-meter-label mono", text: progress + "%" })
    );
    const controls = state.taskDemo ? h(
      "div",
      { class: "flow-controls" },
      actionButton("\u63A8\u8FDB\u8FDB\u5EA6", "task-tick", { kind: "primary", focusKey: "task-tick", dataset: {}, disabled: progress >= 100 }),
      actionButton("\u53D6\u6D88\u4EFB\u52A1", "page-demo", { kind: "danger", focusKey: "task-cancel", dataset: { note: "\u4EFB\u52A1\u5DF2\u53D6\u6D88\uFF08\u539F\u578B\u6A21\u62DF\uFF09\uFF1A\u5DF2\u5199\u5165\u7684\u4E34\u65F6\u6587\u4EF6\u5217\u5728\u7ED3\u679C\u91CC\uFF0C\u53EF\u4EE5\u4E00\u952E\u6E05\u7406\uFF0C\u4E0D\u4F1A\u7559\u4E0B\u534A\u4E2A\u4ED3\u5E93\u3002" } })
    ) : note("\u6F14\u793A\u8FD8\u6CA1\u5F00\u59CB\uFF1A\u9009\u4E00\u79CD\u4EFB\u52A1\u6253\u5F00\u5411\u5BFC\uFF0C\u8FDB\u5EA6\u6761\u4F1A\u4ECE 62% \u7EE7\u7EED\u8D70\u5230 100%\u3002", "muted");
    const done = state.taskDemo && progress >= 100 ? h(
      "div",
      { class: "flow-done" },
      chip("\u4EFB\u52A1\u5B8C\u6210", "ok"),
      h("p", { text: "\u4EFB\u52A1\u8D70\u5B8C\u4E86\u56DB\u6B65\uFF08\u6F14\u793A\u6570\u636E\uFF09\u3002\u771F\u5B9E\u5B9E\u73B0\u91CC\u8FD9\u91CC\u7ED9\u51FA\u76EE\u6807\u76EE\u5F55\u3001\u5BF9\u8C61\u6570\u91CF\u3001\u68C0\u51FA\u6587\u4EF6\u6570\u4E0E\u8017\u65F6\u3002" }),
      actionButton("\u56DE\u5230\u7BA1\u7406\u7D22\u5F15", "page-open", { focusKey: "task-done", dataset: { page: "manage" } })
    ) : null;
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u9009\u4E00\u79CD\u957F\u4EFB\u52A1", "3 \u79CD", "\u4E09\u79CD\u4EFB\u52A1\u5171\u7528\u540C\u4E00\u4E2A\u8FDB\u5EA6\u9875\uFF1A\u90FD\u4F1A\u5148\u628A\u76EE\u6807\u5199\u6E05\u695A\uFF0C\u518D\u5F00\u59CB\u3002\u53D6\u6D88\u540E\u5FC5\u987B\u80FD\u8BF4\u6E05\u7559\u4E0B\u4E86\u4EC0\u4E48\u3002", chooser),
      section("\u8FDB\u5EA6", state.taskDemo ? progress + "%" : null, "\u8FDB\u5EA6\u6765\u81EA git \u7684\u8F93\u51FA\uFF08\u771F\u5B9E\u5B9E\u73B0\u91CC\u662F --progress \u7684\u8BFB\u6570\uFF09\uFF0C\u4E0D\u662F\u5047\u52A8\u753B\u3002", [meter, ...stageRows, ...state.taskDemo ? [controls] : [controls], ...done === null ? [] : [done]]),
      section("\u53D6\u6D88\u4E4B\u540E", null, null, [note("\u53D6\u6D88\u957F\u4EFB\u52A1\u4E0D\u7559\u534A\u4E2A\u4ED3\u5E93\uFF1A\u5199\u8FDB\u4E34\u65F6\u76EE\u5F55\u7684\u5185\u5BB9\u8981\u4E48\u6E05\u7406\u6389\uFF0C\u8981\u4E48\u539F\u6837\u5217\u51FA\u8BA9\u4EBA\u81EA\u5DF1\u5220\u3002\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u6709\u7684\u6587\u4EF6\u4E00\u5F8B\u4E0D\u52A8\u3002", "muted")]),
      capabilitiesSection("task", state)
    );
    return pageShell("task", PAGE_META.task.title, PAGE_META.task.lede, null, body);
  }
  function renderSearch(ctx) {
    const { state } = ctx;
    const query = state.query.trim();
    const lower = query.toLocaleLowerCase();
    const filters = [
      { key: "all", label: "\u5168\u90E8" },
      { key: "commit", label: "\u63D0\u4EA4" },
      { key: "branch", label: "\u5206\u652F" },
      { key: "tag", label: "\u6807\u7B7E" },
      { key: "cap", label: "\u80FD\u529B" }
    ];
    const filterRow = h("div", { class: "filter-row" }, ...filters.map((item) => actionButton(item.label, "page-filter", { kind: state.filter === item.key ? "primary" : "ghost", focusKey: "search-filter-" + item.key, dataset: { filter: item.key } })));
    const input = h("input", {
      class: "search-input",
      attrs: { type: "text", value: state.query, placeholder: "\u641C\u63D0\u4EA4\u4E3B\u9898\u3001\u5206\u652F\u540D\u3001\u6807\u7B7E\u540D\u6216\u80FD\u529B\u540D", "data-field": "page-query", "data-focus-key": "search-input", autocomplete: "off" }
    });
    const hits = [];
    if (lower !== "") {
      for (const commit of capturedCommits) {
        if (commit.subject.toLocaleLowerCase().includes(lower) || commit.short.includes(lower) || commit.author.toLocaleLowerCase().includes(lower)) {
          hits.push({ kind: "commit", title: commit.subject, sub: commit.author + " \xB7 " + new Date(commit.authorDateMs).toLocaleString("zh-CN"), meta: commit.short, action: "search-jump", dataset: { kind: "commit", oid: commit.oid } });
        }
      }
      for (const name of capturedLocalBranchNames) {
        if (name.toLocaleLowerCase().includes(lower)) hits.push({ kind: "branch", title: name, sub: "\u672C\u5730\u5206\u652F", meta: "\u5206\u652F", action: "search-jump", dataset: { kind: "branch", name } });
      }
      for (const tag of capturedTags) {
        if (tag.name.toLocaleLowerCase().includes(lower)) hits.push({ kind: "tag", title: tag.name, sub: "\u6807\u7B7E \xB7 \u6307\u5411 " + tag.shortOid, meta: tag.shortOid, action: "search-jump", dataset: { kind: "tag", name: tag.name } });
      }
      for (const cap of CAPABILITIES) {
        if (cap.name.toLocaleLowerCase().includes(lower) || cap.command.toLocaleLowerCase().includes(lower) || cap.entry.toLocaleLowerCase().includes(lower)) {
          hits.push({ kind: "cap", title: cap.id + " " + cap.name, sub: cap.entry, meta: cap.level + " \xB7 " + cap.placement, action: "search-jump", dataset: { kind: "cap", id: cap.id } });
        }
      }
    }
    const visible = hits.filter((hit) => state.filter === "all" || hit.kind === state.filter);
    const hitRows = visible.slice(0, 40).map((hit) => objectRow([
      h("span", { class: "obj-title" }, chip(hit.kind === "commit" ? "\u63D0\u4EA4" : hit.kind === "branch" ? "\u5206\u652F" : hit.kind === "tag" ? "\u6807\u7B7E" : "\u80FD\u529B", "info", { small: true }), h("span", { text: hit.title })),
      h("span", { class: "obj-sub", text: hit.sub }),
      h("span", { class: "obj-meta mono", text: hit.meta })
    ], [actionButton("\u6253\u5F00", hit.action, { focusKey: "search-hit:" + hit.meta + ":" + hit.title.slice(0, 12), dataset: hit.dataset })]));
    const counts = h(
      "p",
      { class: "search-counts" },
      chip("\u63D0\u4EA4 " + hits.filter((hit) => hit.kind === "commit").length, "muted", { small: true }),
      chip("\u5206\u652F " + hits.filter((hit) => hit.kind === "branch").length, "muted", { small: true }),
      chip("\u6807\u7B7E " + hits.filter((hit) => hit.kind === "tag").length, "muted", { small: true }),
      chip("\u80FD\u529B " + hits.filter((hit) => hit.kind === "cap").length, "muted", { small: true })
    );
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u641C\u7D22", null, "\u641C\u7D22\u8303\u56F4\u662F\u672C\u9875\u9876\u90E8\u7684\u91C7\u96C6\u6570\u636E\uFF1A50 \u6761\u63D0\u4EA4\u3001" + capturedLocalBranchNames.length + " \u6761\u672C\u5730\u5206\u652F\u3001" + capturedTags.length + " \u4E2A\u6807\u7B7E\uFF0C\u52A0\u4E0A 162 \u6761\u80FD\u529B\u7684\u540D\u79F0\u3001\u547D\u4EE4\u4E0E\u5165\u53E3\u3002\u6587\u4EF6\u5185\u5BB9\u641C\u7D22\u662F\u4E00\u6761\u53EA\u8BFB\u80FD\u529B\uFF0813.3\uFF09\uFF0C\u8FD9\u91CC\u53EA\u5C55\u793A\u5B83\u8BFB\u5230\u7684\u5F62\u72B6\u3002", [input, filterRow, counts, ...lower === "" ? [note("\u8F93\u5165\u5173\u952E\u5B57\u5F00\u59CB\u641C\u7D22\u3002\u4F8B\u5982\u8F93\u5165 CSS \u4F1A\u547D\u4E2D\u6837\u5F0F\u76F8\u5173\u63D0\u4EA4\uFF0C\u8F93\u5165 remote \u4F1A\u547D\u4E2D\u8FDC\u7AEF\u80FD\u529B\u3002", "muted")] : visible.length === 0 ? [note("\u6CA1\u6709\u547D\u4E2D\uFF1A\u6362\u4E00\u4E2A\u66F4\u77ED\u7684\u5173\u952E\u5B57\uFF0C\u6216\u5207\u6362\u4E0A\u9762\u7684\u7C7B\u522B\u3002", "muted")] : hitRows]),
      capabilitiesSection("search", state)
    );
    return pageShell("search", PAGE_META.search.title, PAGE_META.search.lede, null, body);
  }

  // docs/prototype/vc-redesign/src/ui/views/page-host.ts
  var DANGER_WORD = "\u786E\u8BA4\u6E05\u7406";
  function dangerCopyOf(cap, prunePackable) {
    switch (cap.id) {
      case "11.6":
        return {
          moves: "\u5220\u9664\u672C\u5730\u4E0D\u53EF\u8FBE\u7684\u5BF9\u8C61\uFF08\u5F53\u524D " + prunePackable + " \u4E2A\u53EF\u56DE\u6536\u5BF9\u8C61\uFF09\u4E0E\u5783\u573E\u6587\u4EF6\u3002\u8FD9\u4E9B\u5BF9\u8C61\u4ECE\u672C\u5730\u6D88\u5931\uFF0C\u5F15\u7528\u65E5\u5FD7\u91CC\u7684\u65E7\u8BB0\u5F55\u4E5F\u4E0D\u518D\u80FD\u627E\u56DE\u5B83\u4EEC\u3002",
          keeps: "\u53EF\u8FBE\u7684\u63D0\u4EA4\u3001\u6807\u7B7E\u3001\u8FDC\u7AEF\u5F15\u7528\u4E0E\u5DE5\u4F5C\u533A\u6587\u4EF6\u4E00\u4E2A\u90FD\u4E0D\u4F1A\u52A8\u3002\u5176\u4ED6\u5DE5\u4F5C\u6811\u5F15\u7528\u7684\u5BF9\u8C61\u4ECD\u7136\u53EF\u8FBE\uFF0C\u4E0D\u4F1A\u88AB\u5220\u3002",
          recovery: "\u6267\u884C\u524D\u628A\u6574\u4E2A\u4ED3\u5E93\u76EE\u5F55\uFF08\u542B .git\uFF09\u590D\u5236\u4E00\u4EFD\u5C31\u662F\u6700\u7A33\u7684\u6062\u590D\u8DEF\u5F84\u3002\u6267\u884C\u540E\u53EA\u80FD\u4ECE\u8FDC\u7AEF\u91CD\u65B0\u6293\u53D6\uFF0C\u6216\u4ECE\u5907\u4EFD\u6062\u590D\u3002"
        };
      default:
        return {
          moves: cap.opens + "\u3002" + cap.result,
          keeps: "\u9762\u677F\u4E0D\u6267\u884C\u8FD9\u4E00\u6B65\uFF0C\u771F\u5B9E\u52A8\u4F5C\u7531\u7EF4\u62A4\u8005\u5728\u7EC8\u7AEF\u5B8C\u6210\u3002",
          recovery: "\u5148\u5728\u526F\u672C\u4E0A\u6F14\u7EC3\uFF0C\u518D\u5BF9\u6B63\u5F0F\u4ED3\u5E93\u6267\u884C\u3002"
        };
    }
  }
  function findCap(id) {
    if (id === null) return void 0;
    return CAPABILITIES.find((cap) => cap.id === id);
  }
  function renderPageHost(ctx) {
    if (ctx.state.dangerId !== null) {
      const cap = findCap(ctx.state.dangerId);
      if (cap !== void 0) return renderDangerConfirm(ctx, cap);
    }
    const page = activePage(ctx.state);
    if (page === null) return null;
    switch (page) {
      case "manage":
        return renderManageIndex(ctx);
      case "branch-tags":
        return renderBranchTags(ctx);
      case "remote":
        return renderRemote(ctx);
      case "submodules":
        return renderSubmodules(ctx);
      case "maintenance":
        return renderMaintenance(ctx);
      case "migrate":
        return renderMigrate(ctx);
      case "config":
        return renderConfig(ctx);
      case "hooks":
        return renderHooks(ctx);
      case "diagnostics":
        return renderDiagnostics(ctx);
      case "platform":
        return renderPlatform(ctx);
      case "rebase":
        return renderRebase(ctx);
      case "conflicts":
        return renderConflicts(ctx);
      case "task":
        return renderTask(ctx);
      case "search":
        return renderSearch(ctx);
      default:
        return null;
    }
  }
  function renderDangerConfirm(ctx, cap) {
    const copy = dangerCopyOf(cap, capturedCounts.prunePackable);
    const meta = PAGE_META.maintenance;
    const typedOk = ctx.state.confirmText.trim() === DANGER_WORD;
    const todo = [
      "\u786E\u8BA4\u6CA1\u6709\u522B\u7684\u5DE5\u4F5C\u6811\u8FD8\u5728\u5F15\u7528\u8FD9\u4E9B\u5BF9\u8C61\uFF1A\u5DE5\u4F5C\u6811\u6E05\u5355\u91CC \u6BCF\u4E00\u68F5\u90FD\u80FD\u770B\u5230\u81EA\u5DF1\u7684 HEAD \u4E0E\u5206\u652F\u3002",
      "\u786E\u8BA4\u6700\u8FD1\u7684\u5F15\u7528\u65E5\u5FD7\u5DF2\u7ECF\u4E0D\u9700\u8981\uFF1A\u6E05\u7406\u4E4B\u540E\u65E7\u8BB0\u5F55\u6307\u5411\u7684\u5BF9\u8C61\u4E0D\u518D\u80FD\u627E\u56DE\u3002",
      "\u786E\u8BA4\u5DF2\u7ECF\u6709\u4E00\u4EFD\u53EF\u7528\u7684\u5907\u4EFD\uFF1A\u6574\u4E2A\u4ED3\u5E93\u76EE\u5F55\u590D\u5236\u5230\u53E6\u4E00\u5757\u78C1\u76D8\u5373\u53EF\u3002",
      "\u786E\u8BA4\u6267\u884C\u7A97\u53E3\uFF1A\u6267\u884C\u671F\u95F4\u4E0D\u8981\u540C\u65F6\u8DD1\u5176\u4ED6\u4F1A\u5199\u4ED3\u5E93\u7684\u547D\u4EE4\uFF08\u6216\u5176\u4ED6\u4F1A\u8BDD\u7684\u6821\u9A8C\uFF09\u3002"
    ];
    const checklist = todo.map((item, index) => objectRow([
      h("span", { class: "obj-title" }, h("span", { class: "mono", text: "\u7B2C " + (index + 1) + " \u9879" })),
      h("span", { class: "obj-sub", text: item })
    ], [chip("\u5DF2\u6838\u5BF9", "muted", { small: true })]));
    const input = h("input", {
      class: "confirm-input",
      attrs: { type: "text", value: ctx.state.confirmText, placeholder: "\u7167\u7740\u6572\uFF1A" + DANGER_WORD, "data-field": "confirm-text", "data-focus-key": "danger-input", autocomplete: "off" }
    });
    const confirmBox = h(
      "div",
      { class: "danger-confirm-box" },
      h("p", { class: "danger-confirm-q", text: "\u786E\u8BA4\u8BCD\uFF1A" + DANGER_WORD + "\u3002\u6572\u5BF9\u4E4B\u540E\u6700\u540E\u4E00\u6B65\u624D\u53EF\u7528\u3002" }),
      input,
      h(
        "div",
        { class: "danger-confirm-actions" },
        actionButton("\u8FD4\u56DE", "danger-close", { focusKey: "danger-cancel" }),
        actionButton("\u6211\u77E5\u9053\u540E\u679C\uFF0C\u6267\u884C", "danger-run", { kind: "danger", focusKey: "danger-run", disabled: !typedOk })
      )
    );
    const facts = factGrid([
      { key: "\u52A8\u4F5C", value: cap.id + " " + cap.name },
      { key: "\u547D\u4EE4", value: cap.command, mono: true },
      { key: "\u5BF9\u8C61\u6570\u91CF", value: capturedCounts.prunePackable + " \u4E2A\u53EF\u56DE\u6536 \xB7 " + capturedCounts.garbage + " \u4E2A\u5783\u573E\u6587\u4EF6", tone: "warn" },
      { key: "\u4ED3\u5E93", value: capturedRepoRoot, mono: true },
      { key: "\u5F53\u524D\u5206\u652F", value: capturedBranch + " @ " + capturedHead.slice(0, 7), mono: true },
      { key: "\u5907\u4EFD\u5EFA\u8BAE", value: "\u590D\u5236\u6574\u4E2A\u4ED3\u5E93\u76EE\u5F55\uFF08\u542B .git\uFF09", tone: "warn" }
    ]);
    const body = h(
      "div",
      { class: "page-stack" },
      section("\u4F1A\u52A8\u4EC0\u4E48", null, null, [
        h("p", { class: "danger-consequence", text: copy.moves }),
        h("p", { class: "danger-recovery", text: copy.keeps })
      ]),
      section("\u53EF\u9006\u6027\u4E0E\u6062\u590D\u8DEF\u5F84", null, null, [note(copy.recovery, "warn")]),
      section("\u62FF\u4EC0\u4E48\u6838\u5BF9", "4 \u9879", "\u8FD9\u56DB\u9879\u5FC5\u987B\u9010\u6761\u8FC7\u4E00\u904D\u3002\u6838\u5BF9\u9875\u4E0D\u66FF\u4F60\u5224\u65AD\uFF0C\u53EA\u628A\u8981\u770B\u7684\u8BFB\u6570\u644A\u5F00\u3002", [facts, ...checklist]),
      section("\u6700\u540E\u4E00\u6B65", null, "\u8FD9\u4E00\u6B65\u5728\u539F\u578B\u91CC\u4E5F\u53EA\u5199\u6F14\u793A\u7ED3\u679C\uFF0C\u4E0D\u4F1A\u771F\u7684\u6E05\u7406\u4ED3\u5E93\u3002\u771F\u5B9E\u6267\u884C\u7531\u7EF4\u62A4\u8005\u5728\u7EC8\u7AEF\u5B8C\u6210\uFF0C\u590D\u6838\u4EBA FeatherHunter\u3002", [confirmBox])
    );
    return pageShell("maintenance", meta.title + " \u203A \u5371\u9669\u52A8\u4F5C\u6838\u5BF9", "\u8FD9\u662F " + cap.id + " " + cap.name + " \u7684\u4E8C\u7EA7\u6838\u5BF9\u9875\uFF1A\u5148\u770B\u540E\u679C\uFF0C\u518D\u770B\u5907\u4EFD\uFF0C\u6700\u540E\u7167\u6284\u786E\u8BA4\u8BCD\u3002", null, body, { danger: true, focusKey: "danger-top" });
  }

  // docs/prototype/vc-redesign/src/ui/views/palette.ts
  function locationOf(cap) {
    const view = VIEW_LABEL[cap.target];
    if (view !== void 0) return view + " \u203A " + cap.entry;
    const meta = PAGE_META[cap.target];
    return (meta === void 0 ? cap.target : meta.title) + " \u203A " + cap.entry;
  }
  function matches(cap, query) {
    if (query === "") return true;
    const hay = (cap.id + " " + cap.name + " " + cap.command + " " + cap.entry + " " + cap.domain + " " + locationOf(cap)).toLocaleLowerCase();
    return hay.includes(query);
  }
  var MAX_ROWS = 80;
  function renderPalette(state) {
    const query = state.paletteQuery.trim().toLocaleLowerCase();
    const hits = CAPABILITIES.filter((cap) => matches(cap, query));
    const visible = hits.slice(0, MAX_ROWS);
    const rows = visible.map((cap, index) => h(
      "button",
      {
        class: "palette-row" + (state.highlight === cap.id ? " is-highlight" : "") + (index === 0 ? " is-first" : ""),
        attrs: { type: "button", "data-action": "palette-select", "data-id": cap.id, "data-focus-key": "palette:" + cap.id }
      },
      h(
        "span",
        { class: "palette-row-main" },
        h("span", { class: "palette-id mono", text: cap.id }),
        h("span", { class: "palette-name", text: cap.name }),
        chip(cap.level, levelTone(cap.level), { small: true }),
        chip(PLACEMENT_LABEL[cap.placement] ?? cap.placement, "muted", { small: true })
      ),
      h("span", { class: "palette-row-sub", text: locationOf(cap) + " \xB7 " + cap.command })
    ));
    const empty = hits.length === 0 ? h("p", { class: "palette-empty", text: "\u6CA1\u6709\u5339\u914D\u7684\u80FD\u529B\uFF1A\u6362\u4E00\u4E2A\u66F4\u77ED\u7684\u5173\u952E\u5B57\uFF0C\u6216\u76F4\u63A5\u8F93\u5165\u80FD\u529B\u7F16\u53F7\uFF08\u4F8B\u5982 11.6\uFF09\u3002" }) : null;
    const more = hits.length > MAX_ROWS ? h("p", { class: "palette-more", text: "\u8FD8\u6709 " + (hits.length - MAX_ROWS) + " \u6761\u6CA1\u663E\u793A\uFF0C\u518D\u8F93\u5165\u51E0\u4E2A\u5B57\u7F29\u5C0F\u8303\u56F4\u3002" }) : null;
    return h(
      "div",
      { class: "palette-backdrop", attrs: { "data-action": "palette-close" } },
      h(
        "div",
        { class: "palette", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "\u547D\u4EE4\u9762\u677F" } },
        h(
          "div",
          { class: "palette-search" },
          icon("search", 16),
          h("input", {
            class: "palette-input",
            attrs: { type: "text", value: state.paletteQuery, placeholder: "\u641C\u80FD\u529B\uFF1A\u540D\u79F0\u3001\u7F16\u53F7\u3001\u547D\u4EE4\u6216\u4F4D\u7F6E", "data-field": "palette-query", "data-focus-key": "palette-input", autocomplete: "off", spellcheck: "false" }
          })
        ),
        h("div", { class: "palette-list" }, ...rows.length === 0 ? [empty ?? h("span", {})] : rows),
        empty !== null && rows.length > 0 ? empty : null,
        more,
        h(
          "div",
          { class: "palette-foot" },
          h("span", { class: "mono", text: "\u5171 " + CAPABILITIES.length + " \u6761\u80FD\u529B" }),
          h("span", { text: "\u5339\u914D " + hits.length + " \u6761" }),
          h("span", { class: "palette-hint", text: "Enter \u6253\u5F00\u7B2C\u4E00\u6761 \xB7 Esc \u5173\u95ED \xB7 \u9009\u4E2D\u540E\u8DF3\u5230\u5BF9\u5E94\u9875\u9762\u5E76\u9AD8\u4EAE" })
        )
      )
    );
  }

  // docs/prototype/vc-redesign/src/ui/app.ts
  var PANEL_WIDTHS = [300, 380, 460, 520];
  var DEFAULT_WIDTH = 460;
  var DEFAULT_THEME = "dark";
  function mount(root2) {
    const data = buildPrototypeData();
    const base = {
      screen: data.screen,
      commitFiles: data.commitFiles,
      totalCommits: data.commits.length,
      branch: data.branch,
      branches: data.branches.map((row) => ({ ...row, current: row.name === data.branch }))
    };
    let state = createSessionState(base, Date.now());
    let panelWidth = DEFAULT_WIDTH;
    let theme = DEFAULT_THEME;
    let embed = false;
    let lastFocusKey = null;
    let dangerReturnKey = null;
    let paletteReturnKey = null;
    let capReturnKey = null;
    let historyListScroll = 0;
    let resultTimer = null;
    let resultRef = null;
    let opTimer = null;
    let pendingOp = null;
    let wtFilter = "all";
    let wtNoteOpen = true;
    let expandedWorktree = null;
    let handoffKind = null;
    let handoffFocus = "";
    let handoffCopied = false;
    let commitMenuOid = null;
    let commitConfirmOid = null;
    let pages = createPageState();
    const pageScrolls = /* @__PURE__ */ new Map();
    const liveRegion = h("div", { class: "sr-only", attrs: { "aria-live": "polite", role: "status" } });
    root2.append(liveRegion);
    function snapshotFocus() {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const key = active.dataset.focusKey;
      if (key === void 0) return null;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return { key, start: active.selectionStart, end: active.selectionEnd };
      }
      return { key, start: null, end: null };
    }
    function restoreFocus(key, caret) {
      const targetKey = key ?? lastFocusKey;
      if (targetKey === null) return;
      const el = root2.querySelector(`[data-focus-key="${cssEscape(targetKey)}"]`);
      if (el === null) return;
      el.focus({ preventScroll: true });
      if (caret !== null && caret.key === targetKey && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        const start = caret.start ?? el.value.length;
        const end = caret.end ?? start;
        el.setSelectionRange(start, end);
      }
    }
    function captureScroll() {
      const selector = ".changes-scroll, .history-scroll, .detail-scroll, .branch-scroll, .page-scroll";
      const el = root2.querySelector(selector);
      if (el === null) return null;
      const scrollSelector = el.classList.contains("changes-scroll") ? ".changes-scroll" : el.classList.contains("history-scroll") ? ".history-scroll" : el.classList.contains("branch-scroll") ? ".branch-scroll" : el.classList.contains("page-scroll") ? ".page-scroll" : ".detail-scroll";
      return { selector: scrollSelector, top: el.scrollTop };
    }
    function restoreScroll(snapshot) {
      if (snapshot === null) return;
      const el = root2.querySelector(snapshot.selector);
      if (el !== null) el.scrollTop = snapshot.top;
    }
    function dispatch(action, options = {}) {
      const focus = snapshotFocus();
      const scroll = captureScroll();
      const next = reduce(state, action, base);
      if (next === state) return;
      state = next;
      render({
        focusKey: options.focusKey ?? focus?.key ?? null,
        focusCaret: focus,
        scroll: options.scroll === void 0 ? scroll : options.scroll,
        post: options.post
      });
    }
    function dispatchPage(action, options = {}) {
      const focus = snapshotFocus();
      const before = scrollKeyOf();
      const scrollEl = root2.querySelector(".page-scroll");
      if (before !== null && scrollEl !== null) pageScrolls.set(before, scrollEl.scrollTop);
      const next = reducePage(pages, action);
      if (next === pages) return;
      pages = next;
      const after = scrollKeyOf();
      const moved = before !== after;
      render({
        focusKey: options.focusKey ?? focus?.key ?? null,
        focusCaret: focus,
        scroll: options.scroll !== void 0 ? options.scroll : moved ? { selector: ".page-scroll", top: after === null ? 0 : pageScrolls.get(after) ?? 0 } : captureScroll(),
        post: options.post
      });
    }
    function activePageOf() {
      return pages.stack.length === 0 ? null : pages.stack[pages.stack.length - 1];
    }
    function scrollKeyOf() {
      if (pages.dangerId !== null) return "danger:" + pages.dangerId;
      return activePageOf();
    }
    function asPageId(value) {
      if (value === void 0 || value === "") return null;
      return value in PAGE_META ? value : null;
    }
    function jumpToCapability(id) {
      const cap = CAPABILITIES.find((item) => item.id === id);
      if (cap === void 0) return;
      const target = targetOfCapability(cap);
      let nextPages = reducePage(pages, { type: "palette-close" });
      if (target === "view") {
        nextPages = reducePage(nextPages, { type: "page-close-all" });
        state = reduce(state, { type: "view", view: cap.target }, base);
        nextPages = reducePage(nextPages, { type: "palette-highlight", id: cap.id });
        pages = nextPages;
        render({ focusKey: "tab-" + cap.target, scroll: null });
        return;
      }
      nextPages = reducePage(nextPages, { type: "page-open", page: target });
      nextPages = reducePage(nextPages, { type: "palette-highlight", id: cap.id });
      pages = nextPages;
      render({ focusKey: "page-back", scroll: null });
    }
    function jumpFromSearch(kind, key) {
      if (kind === "cap") {
        jumpToCapability(key);
        return;
      }
      let nextPages = reducePage(pages, { type: "page-close-all" });
      if (kind === "commit") {
        state = reduce(state, { type: "view", view: "commits" }, base);
        state = reduce(state, { type: "history-open", oid: key }, base);
        pages = nextPages;
        render({ focusKey: "history-back", scroll: null });
        return;
      }
      if (kind === "branch") {
        state = reduce(state, { type: "branch-open" }, base);
        state = reduce(state, { type: "branch-select", name: key }, base);
        pages = nextPages;
        render({ focusKey: "branch-back", scroll: null });
        return;
      }
      if (kind === "tag") {
        nextPages = reducePage(nextPages, { type: "page-open", page: "branch-tags" });
        nextPages = reducePage(nextPages, { type: "page-query", value: key });
        pages = nextPages;
        render({ focusKey: "page-query", scroll: null });
      }
    }
    function repaint(options = {}) {
      render({ ...options, scroll: options.scroll !== void 0 ? options.scroll : captureScroll() });
    }
    function render(options = {}) {
      const model = panelModelOf(base, state, Date.now());
      const frame = buildFrame(model);
      clear(root2);
      root2.append(liveRegion, frame);
      restoreScroll(options.scroll ?? null);
      const pendingCard = root2.querySelector(".wt-confirm, .branch-confirm, .changes-confirm, .commit-confirm, .stash-confirm");
      if (pendingCard !== null) pendingCard.scrollIntoView({ block: "nearest" });
      const highlighted = root2.querySelector(".cap-row.is-flash, .cap-block.is-flash, .palette-row.is-highlight");
      if (highlighted !== null) highlighted.scrollIntoView({ block: "nearest" });
      if (pages.highlight !== null) pages = reducePage(pages, { type: "highlight-clear" });
      positionPopconfirm();
      positionBranchPop();
      positionHandoff();
      restoreFocus(options.focusKey ?? null, options.focusCaret ?? null);
      scheduleResultDismiss();
      liveRegion.textContent = state.result === null ? "" : state.result.text;
      options.post?.();
    }
    function scheduleResultDismiss() {
      if (state.result === null) {
        resultRef = null;
        if (resultTimer !== null) {
          window.clearTimeout(resultTimer);
          resultTimer = null;
        }
        return;
      }
      if (state.result === resultRef) return;
      resultRef = state.result;
      if (resultTimer !== null) window.clearTimeout(resultTimer);
      resultTimer = window.setTimeout(() => {
        resultTimer = null;
        if (state.result === resultRef) dispatch({ type: "result-clear" }, { focusKey: lastFocusKey });
      }, 9e3);
    }
    function segmented(labelText, items) {
      const group = h("div", { class: "seg", attrs: { role: "group", "aria-label": labelText } });
      for (const item of items) {
        group.append(h("button", {
          class: `seg-btn${item.on ? " is-on" : ""}`,
          attrs: {
            type: "button",
            "aria-pressed": item.on ? "true" : "false",
            "data-focus-key": item.key
          },
          dataset: { action: item.action, ...item.dataset }
        }, item.label));
      }
      return h("div", { class: "ctl" }, h("span", { class: "ctl-label", text: labelText }), group);
    }
    function buildFrame(model) {
      const head = h(
        "header",
        { class: "proto-head" },
        h("p", { class: "proto-kicker", text: COPY.frame.kicker }),
        h("h1", { class: "proto-title", text: COPY.frame.title }),
        h("p", { class: "proto-lede", text: COPY.frame.lede }),
        h(
          "div",
          { class: "proto-meta" },
          h("span", { class: "proto-chip", text: COPY.frame.metaData }),
          h("span", { class: "proto-chip", text: COPY.frame.metaWidth }),
          h("span", { class: "proto-chip", text: COPY.frame.metaSkin })
        )
      );
      const tools = h(
        "div",
        { class: "proto-tools" },
        h(
          "div",
          { class: "proto-controls" },
          segmented(COPY.frame.width, PANEL_WIDTHS.map((width) => ({
            key: `width-${width}`,
            label: String(width),
            on: panelWidth === width,
            action: "width",
            dataset: { width: String(width) }
          }))),
          segmented(COPY.frame.theme, [
            { key: "theme-dark", label: COPY.frame.themeDark, on: theme === "dark", action: "theme", dataset: { theme: "dark" } },
            { key: "theme-light", label: COPY.frame.themeLight, on: theme === "light", action: "theme", dataset: { theme: "light" } }
          ])
        ),
        h("span", { class: "proto-tools-note", text: COPY.frame.toolsNote })
      );
      const stage = h("div", { class: "stage" });
      const panel = h("div", {
        class: "panel",
        attrs: { "data-view": state.view }
      });
      const frame = h("div", { class: "frame", attrs: { style: `width: ${panelWidth + 22}px` } });
      const railResult = model.result !== null && (model.result.source === "sync" || model.result.source === "reload" || model.result.source === "copy") ? model.result : null;
      const pageView = renderPageHost({ data, model, state: pages, nowMs: Date.now() });
      const pageOpen = pageView !== null;
      const manageActive = pages.stack.includes("manage") || pages.stack.some((page) => MANAGE_PAGES.includes(page));
      panel.append(renderRail(model.rail, railResult, { pageOpen, manageActive }));
      if (!pageOpen) panel.append(renderTabs(model));
      const activePage2 = pages.stack.length === 0 ? null : pages.stack[pages.stack.length - 1];
      const main = pageOpen ? h("main", { class: "panel-body is-page", attrs: { id: "view-panel", role: "region", "aria-label": "\u4E8C\u7EA7\u9875\uFF1A" + (PAGE_META[activePage2]?.title ?? "\u7BA1\u7406") } }) : h("main", { class: "panel-body", attrs: { id: "view-panel", role: "tabpanel", "aria-labelledby": `tab-${state.view}` } });
      if (pages.result !== null) {
        main.append(h(
          "div",
          { class: "page-result", attrs: { role: "status" } },
          h("span", { class: "page-result-text", text: pages.result }),
          h("button", { class: "page-result-close", attrs: { type: "button", "aria-label": "\u5173\u6389\u8FD9\u6761\u7ED3\u679C", "data-focus-key": "page-result-close" }, dataset: { action: "page-result-clear" } }, "\xD7")
        ));
      }
      main.append(pageView === null ? renderActiveView(model) : pageView);
      panel.append(main);
      if (state.branchOpen) panel.append(renderBranchPopover(model));
      if (model.confirm !== null) panel.append(renderPopconfirm(model.confirm));
      if (handoffKind !== null) {
        panel.append(renderHandoffSheet({
          draft: buildHandoff(data, handoffKind, Date.now(), handoffFocus),
          copied: handoffCopied
        }));
      }
      if (pages.paletteOpen) panel.append(renderPalette(pages));
      frame.append(panel);
      stage.append(frame);
      const foot = h(
        "footer",
        { class: "proto-foot" },
        h("span", { class: "foot-hint", text: COPY.frame.hint }),
        h("span", { class: "foot-captured", text: COPY.frame.capturedAt(whenText(Date.now(), data.nowMs)) })
      );
      const wrap = h("div", { class: `proto${embed ? " is-embed" : ""}` }, head, tools, stage, foot);
      exitBusyLabel(wrap, model);
      return wrap;
    }
    function renderTabs(model) {
      const nav = h("nav", { class: "views", attrs: { role: "tablist", "aria-label": "\u7248\u672C\u7BA1\u7406\u89C6\u56FE" } });
      model.tabs.forEach((tab, index) => {
        const active = state.view === tab.id;
        const node = h(
          "button",
          {
            class: `tab${active ? " is-on" : ""}`,
            attrs: {
              type: "button",
              role: "tab",
              id: `tab-${tab.id}`,
              "aria-selected": active ? "true" : "false",
              "aria-controls": "view-panel",
              tabindex: active ? 0 : -1,
              "data-focus-key": `tab-${tab.id}`,
              title: `${tab.label}\uFF1A${tab.count} ${tab.unit}${tab.explain === void 0 ? "" : " \xB7 " + tab.explain}`
            },
            dataset: { action: "tab", view: tab.id }
          },
          h("span", { class: "tab-label", text: tab.label }),
          h(
            "span",
            { class: "tab-count" },
            h("span", { class: "count", text: String(tab.count) }),
            h("span", { class: "unit", text: tab.unit })
          )
        );
        if (index > 0) node.dataset.order = String(index);
        nav.append(node);
      });
      return nav;
    }
    function renderActiveView(model) {
      switch (state.view) {
        case "commits":
          return renderHistory(model.history, {
            result: model.result,
            // 最新一条提交在列表最上面；菜单里「撤销这次提交」只对它开放。
            headOid: model.history.rows[0] === void 0 ? null : model.history.rows[0].oid,
            menuOid: commitMenuOid,
            confirmOid: commitConfirmOid
          });
        case "worktrees": {
          const options = {
            filter: wtFilter,
            noticeOpen: wtNoteOpen,
            expandedPath: expandedWorktree
          };
          const result = model.result !== null && (model.result.source === "ai" || model.result.source === "worktree") ? model.result : null;
          return renderWorktrees(model.worktrees, result, options);
        }
        case "stash":
          return renderStash(model.stash, model.result);
        default:
          return renderChanges(model.changes, model.result);
      }
    }
    function renderBranchPopover(model) {
      return h("div", {
        class: "branch-pop",
        attrs: { role: "dialog", "aria-label": COPY.branches.listTitle }
      }, renderBranches(model.branches, model.result !== null && model.result.source === "branch" ? model.result : null));
    }
    function positionBranchPop() {
      const pop = root2.querySelector(".branch-pop");
      if (pop === null) return;
      const anchor = root2.querySelector('[data-action="branch-open"]');
      const panel = root2.querySelector(".panel");
      if (anchor === null || panel === null) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8));
      let top = a.bottom - p.top + 8;
      if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.classList.add("is-placed");
    }
    function positionHandoff() {
      const layer = root2.querySelector(".handoff-layer.is-pop");
      if (layer === null || handoffKind === null) return;
      const sheet = layer.querySelector(".handoff-sheet");
      const panel = root2.querySelector(".panel");
      if (sheet === null || panel === null) return;
      const anchor = root2.querySelector(`[data-action="handoff-open"][data-kind="${handoffKind}"]`);
      const p = panel.getBoundingClientRect();
      const width = sheet.offsetWidth;
      const height = sheet.offsetHeight;
      let left = Math.max(8, (p.width - width) / 2);
      let top = Math.max(8, (p.height - height) / 3);
      if (anchor !== null) {
        const a = anchor.getBoundingClientRect();
        left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8));
        top = a.bottom - p.top + 8;
        if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8);
      }
      sheet.style.left = `${left}px`;
      sheet.style.top = `${top}px`;
      sheet.style.width = `${Math.min(440, p.width - 16)}px`;
      layer.classList.add("is-placed");
    }
    function renderPopconfirm(confirm) {
      return h(
        "div",
        {
          class: "popconfirm",
          attrs: { role: "dialog", "aria-labelledby": "confirm-title", "aria-describedby": "confirm-body" }
        },
        h(
          "div",
          { class: "popconfirm-card" },
          h("h3", { class: "popconfirm-title", id: "confirm-title", text: confirm.title }),
          h("p", { class: "popconfirm-body", id: "confirm-body", text: confirm.lead }),
          // 两种结果并排摆开：读者不用在一句带分号的长句里自己断句，也不用猜哪一半说的是自己。
          h(
            "div",
            { class: "popconfirm-points" },
            ...confirm.points.map((point) => h(
              "div",
              { class: `popconfirm-point is-${point.tone}` },
              h("span", { class: "point-k", text: point.label }),
              h("span", { class: "point-v", text: point.text })
            ))
          ),
          h("p", { class: "popconfirm-meta is-danger", text: COPY.rail.confirmFiles(confirm.files.length) }),
          h(
            "div",
            { class: "popconfirm-actions" },
            h("button", {
              class: "btn btn-md",
              attrs: { type: "button", "data-focus-key": "confirm-cancel" },
              dataset: { action: "confirm-cancel" }
            }, confirm.cancelLabel),
            h("button", {
              class: "btn btn-primary btn-md",
              attrs: { type: "button", "data-focus-key": "confirm-continue" },
              dataset: { action: "confirm-continue" }
            }, confirm.continueLabel)
          )
        )
      );
    }
    function positionPopconfirm() {
      const pop = root2.querySelector(".popconfirm");
      if (pop === null) return;
      const anchor = root2.querySelector('[data-action="pull"]');
      const panel = root2.querySelector(".panel");
      if (anchor === null || panel === null) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8));
      let top = a.bottom - p.top + 8;
      if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.classList.add("is-placed");
    }
    function exitBusyLabel(wrap, model) {
      if (model.busy !== null || model.rail.reloading) wrap.setAttribute("aria-busy", "true");
    }
    function runOp(op) {
      if (state.busy !== null || state.reloading) return;
      if (op === "commit") dispatch({ type: "commit-start" }, { focusKey: "commit" });
      else dispatch({ type: "op-start", op }, { focusKey: op });
      pendingOp = op;
      if (opTimer !== null) window.clearTimeout(opTimer);
      const delay = op === "commit" ? 700 : 850;
      opTimer = window.setTimeout(() => {
        opTimer = null;
        const finished = pendingOp;
        pendingOp = null;
        if (finished === null) return;
        if (finished === "commit") dispatch({ type: "commit-finish" }, { focusKey: "commit-message" });
        else dispatch({ type: "op-finish", op: finished, nowMs: Date.now() }, { focusKey: finished });
      }, delay);
    }
    function runReload() {
      if (state.reloading || state.busy !== null) return;
      dispatch({ type: "reload-start" }, { focusKey: "reload" });
      window.setTimeout(() => {
        dispatch({ type: "reload-finish", readAtMs: Date.now(), basisMs: state.basisMs ?? Date.now() }, { focusKey: "reload" });
      }, 500);
    }
    function dirtyFiles() {
      return [...state.staged, ...state.unstaged];
    }
    function backToHistoryList() {
      const detail = panelModelOf(base, state, Date.now()).history.detail;
      dispatch({ type: "history-back" }, {
        focusKey: detail === null ? "tab-commits" : `commit:${detail.oid}`,
        scroll: null,
        post: () => {
          const list = root2.querySelector(".history-scroll");
          if (list !== null) list.scrollTop = historyListScroll;
        }
      });
    }
    async function copyPath(path) {
      try {
        await navigator.clipboard.writeText(path);
      } catch {
      }
      dispatch({ type: "copy", path }, { focusKey: lastFocusKey });
    }
    function closeTransientPanels() {
      if (state.openMenuPath !== null) state = reduce(state, { type: "changes-open-menu", path: null }, base);
      if (state.changesPending !== null) state = reduce(state, { type: "changes-pending", pending: null }, base);
      if (state.stashPending !== null) state = reduce(state, { type: "stash-pending", pending: null }, base);
      commitMenuOid = null;
      commitConfirmOid = null;
    }
    function focusText(model) {
      if (state.branchOpen) return "\u5206\u652F\u6D6E\u5C42\uFF0C\u6B63\u5728\u672C\u5730\u5206\u652F\u6E05\u5355\u91CC";
      if (state.view === "commits") {
        const detail = model.history.detail;
        return detail === null ? "\u63D0\u4EA4\u5386\u53F2\u89C6\u56FE\u7684\u5217\u8868" : `\u63D0\u4EA4\u5386\u53F2\u89C6\u56FE\uFF0C\u6B63\u5728\u770B\u63D0\u4EA4 ${detail.short} \u7684\u8BE6\u60C5`;
      }
      if (state.view === "worktrees") {
        return `\u5DE5\u4F5C\u6811\u89C6\u56FE\uFF0C\u7B5B\u9009\u662F${wtFilter === "all" ? "\u5168\u90E8" : "\u53EA\u770B\u9700\u8981\u5904\u7406"}`;
      }
      if (state.view === "stash") {
        return `\u6536\u8D77\u6539\u52A8\u89C6\u56FE\uFF0C\u5217\u8868\u91CC\u6709 ${model.stash.total} \u6761\u8BB0\u5F55`;
      }
      const filter = state.changesFilter;
      const filterLabel = filter === "conflict" ? "\u53EA\u770B\u51B2\u7A81" : filter === "staged" ? "\u53EA\u770B\u5DF2\u52A0\u5165" : filter === "unstaged" ? "\u53EA\u770B\u672A\u52A0\u5165" : "\u5168\u90E8";
      return `\u6539\u52A8\u89C6\u56FE\uFF0C\u7B5B\u9009\u662F${filterLabel}`;
    }
    async function copyHandoff(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
      }
      handoffCopied = true;
      liveRegion.textContent = COPY.ai.copied(text.length);
      repaint({ focusKey: "handoff-copy" });
    }
    function onClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("[data-action]");
      if (el === null) return;
      const action = el.dataset.action ?? "";
      const model = panelModelOf(base, state, Date.now());
      switch (action) {
        case "width": {
          const next = Number(el.dataset.width);
          if (next === panelWidth) return;
          panelWidth = next;
          repaint({ focusKey: `width-${next}` });
          return;
        }
        case "theme": {
          const next = el.dataset.theme;
          if (next !== "dark" && next !== "light") return;
          if (next === theme) return;
          theme = next;
          document.documentElement.dataset.theme = next;
          repaint({ focusKey: `theme-${next}` });
          return;
        }
        case "tab": {
          const view = el.dataset.view;
          if (view !== "changes" && view !== "commits" && view !== "worktrees" && view !== "stash") return;
          if (state.branchOpen) {
            state = reduce(state, { type: "branch-close" }, base);
          }
          closeTransientPanels();
          if (pages.stack.length > 0 || pages.paletteOpen) pages = createPageState();
          if (state.view === view) {
            repaint({ focusKey: `tab-${view}`, scroll: null });
            return;
          }
          dispatch({ type: "view", view }, { focusKey: `tab-${view}`, scroll: null });
          return;
        }
        case "reload":
          runReload();
          return;
        case "pull": {
          if (model.rail.pull.disabled) return;
          if (state.confirmPull !== null) {
            dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
            return;
          }
          if (model.rail.pull.warn) {
            dispatch({ type: "pull-confirm-open", files: dirtyFiles(), dirtyCount: dirtyFiles().length }, { focusKey: "confirm-cancel" });
            return;
          }
          runOp("pull");
          return;
        }
        case "fetch":
          runOp("fetch");
          return;
        case "push":
          runOp("push");
          return;
        case "copy-repo":
          void copyPath(model.rail.worktreePath);
          return;
        case "worktree-copy": {
          const path = el.dataset.path ?? "";
          void copyPath(path);
          return;
        }
        case "filter": {
          const filter = el.dataset.filter;
          if (filter !== "conflict" && filter !== "staged" && filter !== "unstaged") return;
          dispatch({ type: "filter", filter: state.changesFilter === filter ? "all" : filter }, { focusKey: `filter-${filter}` });
          return;
        }
        case "toggle-file": {
          const path = el.dataset.path ?? "";
          dispatch({ type: "toggle-file", path }, { focusKey: `row:${path}` });
          return;
        }
        case "stage":
        case "unstage": {
          const path = el.dataset.path ?? "";
          dispatch({ type: action, path }, { focusKey: `row:${path}` });
          return;
        }
        case "stage-all":
          dispatch({ type: "stage-all" }, { focusKey: "stage-all" });
          return;
        case "unstage-all":
          dispatch({ type: "unstage-all" }, { focusKey: "unstage-all" });
          return;
        case "commit": {
          if (model.changes.composer.disabled) return;
          runOp("commit");
          return;
        }
        case "changes-open-menu": {
          const path = el.dataset.path ?? "";
          const open = state.openMenuPath === path;
          dispatch({ type: "changes-open-menu", path: open ? null : path }, { focusKey: `row-more:${path}` });
          return;
        }
        case "changes-pending": {
          const kind = el.dataset.kind;
          if (kind !== "discard" && kind !== "discard-all" && kind !== "ignore" && kind !== "delete-untracked" && kind !== "resolve-ours" && kind !== "resolve-theirs") return;
          const pendingKind = kind;
          const path = el.dataset.path ?? null;
          dispatch({ type: "changes-pending", pending: { kind: pendingKind, path } }, { focusKey: "changes-cancel", scroll: null });
          return;
        }
        case "changes-pending-cancel":
          dispatch({ type: "changes-pending", pending: null }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "changes-apply":
          dispatch({ type: "changes-apply" }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "stash-create":
          dispatch({ type: "stash-create" }, { focusKey: "composer-links", scroll: null });
          return;
        case "stash-apply":
        case "stash-pop": {
          const id = el.dataset.id ?? "";
          dispatch({ type: action, id }, { focusKey: `stash-${action === "stash-apply" ? "apply" : "pop"}:${id}`, scroll: null });
          return;
        }
        case "stash-pending": {
          const pending = { kind: "drop", id: el.dataset.id ?? "" };
          dispatch({ type: "stash-pending", pending }, { focusKey: "stash-cancel", scroll: null });
          return;
        }
        case "stash-pending-cancel":
          dispatch({ type: "stash-pending", pending: null }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "stash-drop":
          dispatch({ type: "stash-drop", id: el.dataset.id ?? "" }, { focusKey: "tab-stash", scroll: null });
          return;
        case "commit-menu": {
          const oid = el.dataset.oid ?? "";
          const open = commitMenuOid === oid && commitConfirmOid === null;
          commitMenuOid = open ? null : oid;
          commitConfirmOid = null;
          repaint({ focusKey: `commit-more:${oid}` });
          return;
        }
        case "commit-menu-close":
          commitMenuOid = null;
          commitConfirmOid = null;
          repaint({ focusKey: lastFocusKey });
          return;
        case "commit-undo-start": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = oid;
          commitConfirmOid = oid;
          repaint({ focusKey: "commit-cancel" });
          return;
        }
        case "commit-undo": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = null;
          commitConfirmOid = null;
          dispatch({ type: "commit-undo", oid }, { focusKey: "tab-commits", scroll: null });
          return;
        }
        case "commit-revert":
        case "commit-cherry-pick": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = null;
          commitConfirmOid = null;
          dispatch({ type: action, oid }, { focusKey: `commit:${oid}`, scroll: null });
          return;
        }
        case "copy-oid": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = null;
          commitConfirmOid = null;
          void copyPath(oid);
          repaint({ focusKey: "tab-commits" });
          return;
        }
        case "history-open": {
          const scrollEl = root2.querySelector(".history-scroll");
          historyListScroll = scrollEl === null ? 0 : scrollEl.scrollTop;
          dispatch({ type: "history-open", oid: el.dataset.oid ?? "" }, { focusKey: "history-back", scroll: null, post: () => {
            const el2 = root2.querySelector(".detail-scroll");
            if (el2 !== null) el2.scrollTop = 0;
          } });
          return;
        }
        case "history-file": {
          const path = el.dataset.path ?? "";
          dispatch({ type: "history-open-file", path }, { focusKey: `history-file:${path}` });
          return;
        }
        case "history-back": {
          backToHistoryList();
          return;
        }
        case "history-merge-only":
          dispatch({ type: "history-merge-only" }, { focusKey: "history-merge" });
          return;
        case "ai-worktrees":
          dispatch({ type: "ai-worktrees" }, { focusKey: "ai-worktrees" });
          return;
        case "handoff-open": {
          const kind = el.dataset.kind;
          if (kind !== "general" && kind !== "changes" && kind !== "worktrees" && kind !== "branches") return;
          handoffKind = kind;
          handoffFocus = focusText(model);
          handoffCopied = false;
          repaint({ focusKey: "handoff-copy" });
          return;
        }
        case "handoff-close": {
          if (handoffKind === null) return;
          const previous = handoffKind;
          handoffKind = null;
          handoffCopied = false;
          repaint({ focusKey: `handoff-${previous}` });
          return;
        }
        case "handoff-copy": {
          if (handoffKind === null) return;
          const draft = buildHandoff(data, handoffKind, Date.now(), handoffFocus);
          void copyHandoff(draft.prompt);
          return;
        }
        case "wt-filter": {
          const filter = el.dataset.filter === "abnormal" ? "abnormal" : "all";
          if (filter === wtFilter) return;
          wtFilter = filter;
          repaint({ focusKey: `wt-filter-${filter}` });
          return;
        }
        case "wt-note-close":
          wtNoteOpen = false;
          repaint({ focusKey: "wt-note-open" });
          return;
        case "wt-note-open":
          wtNoteOpen = true;
          repaint({ focusKey: "wt-note-open" });
          return;
        case "wt-expand": {
          const path = el.dataset.path ?? "";
          expandedWorktree = expandedWorktree === path ? null : path;
          repaint({ focusKey: `wt-expand:${path}` });
          return;
        }
        case "branch-open":
          dispatch({ type: "branch-open" }, { focusKey: "branch-query" });
          return;
        case "branch-close":
          dispatch({ type: "branch-close" }, { focusKey: "branch-open", scroll: null });
          return;
        case "branch-select": {
          const name = el.dataset.name ?? "";
          dispatch({ type: "branch-select", name }, { focusKey: "branch-back", scroll: null });
          return;
        }
        case "branch-sub": {
          const sub = el.dataset.sub;
          if (sub !== "list" && sub !== "detail" && sub !== "create" && sub !== "rename") return;
          const next = sub;
          const focusKey = next === "create" || next === "rename" ? "branch-draft" : "branch-back";
          dispatch({ type: "branch-sub", sub: next }, { focusKey, scroll: null });
          return;
        }
        case "branch-create":
          dispatch({ type: "branch-create" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-rename-confirm":
          dispatch({ type: "branch-rename", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-switch": {
          const name = el.dataset.name ?? "";
          if (model.branches.dirty) {
            dispatch({ type: "branch-pending", pending: { kind: "switch", name } }, { focusKey: "branch-confirm", scroll: null });
            return;
          }
          dispatch({ type: "branch-switch", name }, { focusKey: "branch-back", scroll: null });
          return;
        }
        case "branch-switch-confirm":
          dispatch({ type: "branch-switch", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-merge":
          dispatch({ type: "branch-merge", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-delete-start":
          dispatch({ type: "branch-pending", pending: { kind: "delete", name: el.dataset.name ?? "" } }, { focusKey: "branch-cancel", scroll: null });
          return;
        case "branch-delete-confirm":
          dispatch({ type: "branch-delete", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-rebase-start":
          dispatch({ type: "branch-pending", pending: { kind: "rebase", name: el.dataset.name ?? "" } }, { focusKey: "branch-cancel", scroll: null });
          return;
        case "branch-rebase-confirm":
          dispatch({ type: "branch-rebase", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-pending-cancel":
          dispatch({ type: "branch-pending", pending: null }, { focusKey: "branch-back", scroll: null });
          return;
        case "wt-pending": {
          const kind = el.dataset.kind;
          if (kind !== "unlock" && kind !== "prune" && kind !== "remove") return;
          const pending = { kind, path: el.dataset.path ?? "", name: el.dataset.name ?? "" };
          dispatch({ type: "wt-pending", pending }, { focusKey: "wt-cancel", scroll: null });
          return;
        }
        case "wt-pending-cancel":
          dispatch({ type: "wt-pending", pending: null }, { focusKey: `wt-expand:${el.dataset.path ?? expandedWorktree ?? ""}`, scroll: null });
          return;
        case "wt-apply":
          dispatch({ type: "wt-apply" }, { focusKey: `wt-expand:${expandedWorktree ?? ""}`, scroll: null });
          return;
        case "confirm-cancel":
          dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
          return;
        case "confirm-continue":
          dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
          runOp("pull");
          return;
        case "result-dismiss":
          dispatch({ type: "result-clear" }, { focusKey: lastFocusKey });
          return;
        case "page-open": {
          const page = asPageId(el.dataset.page);
          if (page === null) return;
          dispatchPage({ type: "page-open", page }, { focusKey: "page-back" });
          return;
        }
        case "page-back":
          dispatchPage({ type: "page-back" }, { focusKey: "page-back" });
          return;
        case "page-close-all":
          dispatchPage({ type: "page-close-all" }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "page-fold": {
          const key = el.dataset.key ?? "";
          dispatchPage({ type: "page-fold", key }, { focusKey: "fold:" + key });
          return;
        }
        case "page-filter": {
          const filter = el.dataset.filter ?? "all";
          dispatchPage({ type: "page-filter", filter }, { focusKey: "filter:" + filter });
          return;
        }
        case "page-demo":
          dispatchPage({ type: "page-result", text: el.dataset.note ?? "\u5DF2\u6267\u884C\uFF08\u539F\u578B\u6A21\u62DF\uFF09\u3002" }, { focusKey: lastFocusKey });
          return;
        case "page-result-clear":
          dispatchPage({ type: "page-result-clear" }, { focusKey: lastFocusKey });
          return;
        case "cap-open": {
          const id = el.dataset.id ?? "";
          capReturnKey = el.getAttribute("data-focus-key") ?? lastFocusKey;
          dispatchPage({ type: "cap-open", id }, {
            focusKey: "cap-cancel-" + id,
            // 确认卡长在「本页负责的能力」那一行下面；如果这一行不在视野里，把它滚进来，读者才看得到刚点出来的卡。
            post: () => {
              const card = root2.querySelector('[data-cap-id="' + id + '"] .cap-confirm');
              if (card !== null) card.scrollIntoView({ block: "nearest" });
            }
          });
          return;
        }
        case "cap-close":
          dispatchPage({ type: "cap-close" }, { focusKey: capReturnKey ?? "cap-" + pages.capOpen });
          return;
        case "cap-next":
          dispatchPage({ type: "cap-next" }, { focusKey: "cap-run-" + pages.capOpen });
          return;
        case "cap-run":
          dispatchPage({ type: "cap-run" }, { focusKey: capReturnKey ?? lastFocusKey });
          return;
        case "danger-open": {
          const id = el.dataset.id ?? "";
          dangerReturnKey = el.getAttribute("data-focus-key") ?? lastFocusKey;
          dispatchPage({ type: "danger-open", id }, { focusKey: "danger-top" });
          return;
        }
        case "danger-close":
          dispatchPage({ type: "danger-close" }, { focusKey: dangerReturnKey ?? "page-back" });
          return;
        case "danger-run":
          dispatchPage({ type: "danger-run" }, { focusKey: dangerReturnKey ?? "page-back" });
          return;
        case "rebase-demo":
        case "rebase-step":
        case "rebase-abort":
        case "conflict-demo":
        case "conflict-abort":
        case "task-demo":
        case "task-tick": {
          const focusByAction = {
            "rebase-demo": "rebase-next",
            "rebase-step": "rebase-next",
            "rebase-abort": "rebase-start",
            "conflict-demo": "conflict-start",
            "conflict-abort": "conflict-start",
            "task-demo": "task-tick",
            "task-tick": "task-tick"
          };
          dispatchPage({ type: action }, { focusKey: focusByAction[action] ?? lastFocusKey });
          return;
        }
        case "conflict-choice": {
          const choice = el.dataset.choice === "theirs" ? "theirs" : "ours";
          dispatchPage({ type: "conflict-choice", choice }, { focusKey: lastFocusKey });
          return;
        }
        case "conflict-resolve": {
          const path = el.dataset.path ?? "";
          dispatchPage({ type: "conflict-resolve", path }, { focusKey: "conflict-resolve:" + path });
          return;
        }
        case "palette-open":
          paletteReturnKey = lastFocusKey;
          dispatchPage({ type: "palette-open" }, { focusKey: "palette-input" });
          return;
        case "palette-close": {
          if (target.closest(".palette") !== null) return;
          dispatchPage({ type: "palette-close" }, { focusKey: paletteReturnKey ?? lastFocusKey });
          return;
        }
        case "palette-select": {
          const id = el.dataset.id ?? "";
          jumpToCapability(id);
          return;
        }
        case "search-jump":
          jumpFromSearch(el.dataset.kind ?? "", el.dataset.oid ?? el.dataset.name ?? el.dataset.id ?? "");
          return;
        case "page-form-submit": {
          const kind = el.dataset.kind ?? "";
          const text = kind === "remote-add" ? "\u5DF2\u6DFB\u52A0\u8FDC\u7AEF\uFF08\u539F\u578B\u6A21\u62DF\uFF09\uFF1A\u5217\u8868\u91CC\u4F1A\u591A\u4E00\u884C\uFF0C\u62C9\u53D6\u4E0E\u63A8\u9001\u6309\u94AE\u968F\u5373\u53EF\u7528\u3002" : "\u5DF2\u6DFB\u52A0\u5B50\u6A21\u5757\uFF08\u539F\u578B\u6A21\u62DF\uFF09\uFF1A\u514B\u9686\u5B8C\u6210\u540E\u624D\u51FA\u73B0\u5728\u6E05\u5355\u91CC\u3002";
          dispatchPage({ type: "page-result", text }, { focusKey: lastFocusKey });
          return;
        }
        case "branch-tags-view":
          jumpFromSearch("branch", el.dataset.name ?? "");
          return;
        case "branch-open-from-page": {
          const name = el.dataset.name ?? "";
          state = reduce(state, { type: "branch-open" }, base);
          if (name !== "") state = reduce(state, { type: "branch-select", name }, base);
          pages = reducePage(pages, { type: "page-close-all" });
          render({ focusKey: "branch-back", scroll: null });
          return;
        }
        default:
          return;
      }
    }
    function onChange(event) {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
      if (event instanceof InputEvent && event.isComposing) return;
      const field = target.dataset.field;
      if (field === "message") {
        const next = reduce(state, { type: "message", value: target.value }, base);
        if (next === state) return;
        state = next;
        syncComposer();
      } else if (field === "history-query") {
        dispatch({ type: "history-query", value: target.value }, { focusKey: "history-query" });
      } else if (field === "branch-query") {
        dispatch({ type: "branch-query", value: target.value }, { focusKey: "branch-query" });
      } else if (field === "branch-draft") {
        dispatch({ type: "branch-draft", value: target.value }, { focusKey: "branch-draft" });
      } else if (field === "page-query") {
        dispatchPage({ type: "page-query", value: target.value }, { focusKey: target.dataset.focusKey ?? "page-query" });
      } else if (field === "page-draft") {
        dispatchPage({ type: "page-draft", value: target.value }, { focusKey: target.dataset.focusKey ?? "page-draft" });
      } else if (field === "palette-query") {
        dispatchPage({ type: "palette-query", value: target.value }, { focusKey: "palette-input" });
      } else if (field === "confirm-text") {
        dispatchPage({ type: "confirm-text", value: target.value }, { focusKey: "danger-input" });
      }
    }
    function syncComposer() {
      const composer = root2.querySelector(".composer");
      if (composer === null) return;
      const current = panelModelOf(base, state, Date.now()).changes.composer;
      const buttonEl = composer.querySelector(".btn-primary");
      if (buttonEl !== null) {
        const busy = current.busy;
        buttonEl.disabled = current.disabled || busy;
        buttonEl.classList.toggle("is-disabled", current.disabled && !busy);
        buttonEl.setAttribute("aria-busy", busy ? "true" : "false");
        buttonEl.title = current.disabledReason ?? "";
        const label = buttonEl.querySelector(".btn-label");
        if (label !== null) label.textContent = busy ? COPY.busy.commit : COPY.changes.commitLabel(current.stagedCount);
      }
      const reason = composer.querySelector(".composer-reason");
      const hint = composer.querySelector(".hint-text");
      if (current.disabledReason === null) {
        if (reason !== null) reason.replaceWith(h("span", { class: "hint-text", text: current.hint }));
        return;
      }
      if (reason !== null) {
        const text = reason.querySelector("span");
        if (text !== null) text.textContent = current.disabledReason;
        return;
      }
      if (hint !== null) {
        hint.replaceWith(h("span", { class: "composer-reason", id: "commit-reason" }, icon("alert", 12), h("span", { text: current.disabledReason })));
      }
    }
    function onKeyDown(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        if (!pages.paletteOpen) {
          paletteReturnKey = lastFocusKey;
          dispatchPage({ type: "palette-open" }, { focusKey: "palette-input" });
        }
        return;
      }
      if (event.key === "Escape" && pages.paletteOpen) {
        event.preventDefault();
        dispatchPage({ type: "palette-close" }, { focusKey: paletteReturnKey ?? lastFocusKey });
        return;
      }
      if (event.key === "Escape" && pages.dangerId !== null) {
        event.preventDefault();
        dispatchPage({ type: "danger-close" }, { focusKey: dangerReturnKey ?? "page-back" });
        return;
      }
      if (event.key === "Escape" && pages.capOpen !== "") {
        event.preventDefault();
        dispatchPage({ type: "cap-close" }, { focusKey: capReturnKey ?? "cap-" + pages.capOpen });
        return;
      }
      if (pages.paletteOpen && event.key === "Enter" && target.dataset.field === "palette-query") {
        const first = root2.querySelector('.palette-row[data-action="palette-select"]');
        if (first !== null) {
          event.preventDefault();
          jumpToCapability(first.dataset.id ?? "");
        }
        return;
      }
      if (event.key === "Escape" && handoffKind !== null) {
        event.preventDefault();
        const previous = handoffKind;
        handoffKind = null;
        handoffCopied = false;
        repaint({ focusKey: `handoff-${previous}` });
        return;
      }
      if (event.key === "Escape" && state.changesPending !== null) {
        event.preventDefault();
        dispatch({ type: "changes-pending", pending: null }, { focusKey: lastFocusKey });
        return;
      }
      if (event.key === "Escape" && state.stashPending !== null) {
        event.preventDefault();
        dispatch({ type: "stash-pending", pending: null }, { focusKey: lastFocusKey });
        return;
      }
      if (event.key === "Escape" && (commitMenuOid !== null || commitConfirmOid !== null)) {
        event.preventDefault();
        commitMenuOid = null;
        commitConfirmOid = null;
        repaint({ focusKey: "tab-commits" });
        return;
      }
      if (event.key === "Escape" && state.branchPending !== null) {
        event.preventDefault();
        dispatch({ type: "branch-pending", pending: null }, { focusKey: "branch-back" });
        return;
      }
      if (event.key === "Escape" && state.worktreePending !== null) {
        event.preventDefault();
        dispatch({ type: "wt-pending", pending: null }, { focusKey: `wt-expand:${state.worktreePending.path}` });
        return;
      }
      if (event.key === "Escape" && state.branchOpen) {
        event.preventDefault();
        dispatch({ type: "branch-close" }, { focusKey: "branch-open" });
        return;
      }
      if (event.key === "Escape" && state.confirmPull !== null) {
        event.preventDefault();
        dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
        return;
      }
      if (event.key === "Escape" && pages.stack.length > 0) {
        event.preventDefault();
        dispatchPage({ type: "page-back" }, { focusKey: "page-back" });
        return;
      }
      if (state.confirmPull !== null) return;
      const row = target.closest('[data-action="toggle-file"], [data-action="history-open"], [data-action="history-file"]');
      if (row !== null && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        row.click();
        return;
      }
      if (target.getAttribute("role") === "tab") {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const tabs = Array.from(root2.querySelectorAll('.views [role="tab"]'));
        const index = tabs.indexOf(target);
        if (index < 0) return;
        const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        const nextTab = tabs[nextIndex];
        const view = nextTab.dataset.view;
        if (view === "changes" || view === "commits" || view === "worktrees" || view === "stash") {
          dispatch({ type: "view", view }, { focusKey: `tab-${view}`, scroll: null });
        }
      }
    }
    root2.addEventListener("click", onClick);
    root2.addEventListener("input", onChange);
    root2.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (state.confirmPull !== null && target.closest(".popconfirm") === null && target.closest('[data-action="pull"]') === null) {
        dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
      }
      if (state.branchOpen && target.closest(".branch-pop") === null && target.closest('[data-action="branch-open"]') === null) {
        state = reduce(state, { type: "branch-close" }, base);
        repaint({ focusKey: "branch-open" });
      }
      const insideTransient = target.closest(".row-menu, .row-more, .row-act, .commit-menu, .commit-more, .changes-confirm, .commit-confirm") !== null;
      if (!insideTransient && (commitMenuOid !== null || commitConfirmOid !== null || state.openMenuPath !== null)) {
        commitMenuOid = null;
        commitConfirmOid = null;
        if (state.openMenuPath !== null) state = reduce(state, { type: "changes-open-menu", path: null }, base);
        repaint({ focusKey: lastFocusKey });
      }
    });
    root2.addEventListener("focusin", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.dataset.focusKey !== void 0) lastFocusKey = target.dataset.focusKey;
    });
    function applyDeepLink() {
      const params = new URLSearchParams(window.location.search);
      const widthParam = Number(params.get("width"));
      if (PANEL_WIDTHS.includes(widthParam)) panelWidth = widthParam;
      const themeParam = params.get("theme");
      if (themeParam === "dark" || themeParam === "light") theme = themeParam;
      embed = params.get("embed") === "1";
      const wt = params.get("wt");
      if (wt === "abnormal" || wt === "all") wtFilter = wt;
      if (params.get("wtnote") === "0") wtNoteOpen = false;
      if (params.get("demo") === "1") state = reduce(state, { type: "demo-worktrees" }, base);
      if (params.get("wtexpand") === "1") {
        const first = panelModelOf(base, state, Date.now()).worktrees.others.find((row) => row.abnormal);
        expandedWorktree = first === void 0 ? null : first.path;
      }
      const wtPendingParam = params.get("wtpending");
      if (wtPendingParam === "unlock" || wtPendingParam === "prune" || wtPendingParam === "remove") {
        const path = params.get("wtpath") ?? "";
        const row = panelModelOf(base, state, Date.now()).worktrees.others.find((candidate) => candidate.path === path);
        if (row !== void 0) {
          expandedWorktree = row.path;
          state = reduce(state, { type: "wt-pending", pending: { kind: wtPendingParam, path: row.path, name: row.name } }, base);
        }
      }
      const view = params.get("view");
      if (view === "changes" || view === "commits" || view === "worktrees" || view === "stash") {
        state = reduce(state, { type: "view", view }, base);
      }
      const menuPath = params.get("menu");
      if (menuPath !== null && menuPath !== "") {
        state = reduce(state, { type: "changes-open-menu", path: menuPath }, base);
      }
      const changePending = params.get("cpending");
      if (changePending === "discard" || changePending === "discard-all" || changePending === "ignore" || changePending === "delete-untracked" || changePending === "resolve-ours" || changePending === "resolve-theirs") {
        state = reduce(state, { type: "changes-pending", pending: { kind: changePending, path: params.get("cpath") ?? null } }, base);
      }
      const commitMenu = params.get("commitmenu");
      if (commitMenu !== null && commitMenu !== "") commitMenuOid = commitMenu;
      if (params.get("commitconfirm") === "1" && commitMenuOid !== null) commitConfirmOid = commitMenuOid;
      if (params.get("stashdemo") === "1") state = reduce(state, { type: "stash-create" }, base);
      const stashPending = params.get("stashpending");
      if (stashPending === "drop") {
        const stashId = params.get("stashid") ?? "stash@{0}";
        state = reduce(state, { type: "stash-pending", pending: { kind: "drop", id: stashId } }, base);
      }
      if (params.get("branches") === "1") state = reduce(state, { type: "branch-open" }, base);
      const branchName = params.get("branch");
      if (branchName !== null && branchName !== "") state = reduce(state, { type: "branch-select", name: branchName }, base);
      const branchSubParam = params.get("bsub");
      if (branchSubParam === "list" || branchSubParam === "detail" || branchSubParam === "create" || branchSubParam === "rename") {
        state = reduce(state, { type: "branch-sub", sub: branchSubParam }, base);
      }
      const branchDraft = params.get("bdraft");
      if (branchDraft !== null && branchDraft !== "") state = reduce(state, { type: "branch-draft", value: branchDraft }, base);
      const branchPendingParam = params.get("bpending");
      if (branchPendingParam === "delete" || branchPendingParam === "switch" || branchPendingParam === "rebase") {
        const selected = state.branchSelected;
        if (selected !== null) {
          state = reduce(state, { type: "branch-pending", pending: { kind: branchPendingParam, name: selected } }, base);
        }
      }
      if (params.get("merge") === "1") state = reduce(state, { type: "history-merge-only" }, base);
      const query = params.get("q");
      if (query !== null && query !== "") state = reduce(state, { type: "history-query", value: query }, base);
      const open = params.get("open");
      if (open !== null && open !== "") state = reduce(state, { type: "history-open", oid: open }, base);
      const file = params.get("file");
      if (file !== null && file !== "") state = reduce(state, { type: "history-open-file", path: file }, base);
      const filter = params.get("filter");
      if (filter === "conflict" || filter === "staged" || filter === "unstaged") {
        state = reduce(state, { type: "filter", filter }, base);
      }
      const message = params.get("message");
      if (message !== null && message !== "") state = reduce(state, { type: "message", value: message }, base);
      if (params.get("confirm") === "1") {
        state = reduce(state, { type: "pull-confirm-open", files: dirtyFiles(), dirtyCount: dirtyFiles().length }, base);
      }
      const ai = params.get("ai");
      if (ai === "general" || ai === "changes" || ai === "worktrees" || ai === "branches") {
        handoffKind = ai;
        handoffFocus = focusText(panelModelOf(base, state, Date.now()));
        if (params.get("aicopied") === "1") handoffCopied = true;
      }
      const manageParam = params.get("manage");
      if (manageParam === "1") pages = reducePage(pages, { type: "page-open", page: "manage" });
      const pageParam = asPageId(params.get("page") ?? void 0);
      if (pageParam !== null) pages = reducePage(pages, { type: "page-open", page: pageParam });
      const flowParam = params.get("flow");
      if (flowParam === "rebase" || flowParam === "conflicts" || flowParam === "task") {
        pages = reducePage(pages, { type: "page-open", page: flowParam });
      }
      const pageQuery = params.get("pq");
      if (pageQuery !== null && pageQuery !== "") pages = reducePage(pages, { type: "page-query", value: pageQuery });
      const pageFilter = params.get("pfilter");
      if (pageFilter !== null && pageFilter !== "") pages = reducePage(pages, { type: "page-filter", filter: pageFilter });
      if (params.get("palette") === "1") pages = reducePage(pages, { type: "palette-open" });
      const paletteQuery = params.get("pquery");
      if (paletteQuery !== null && paletteQuery !== "") pages = reducePage(pages, { type: "palette-query", value: paletteQuery });
      const capParam = params.get("cap");
      if (capParam !== null && capParam !== "") {
        const cap = CAPABILITIES.find((item) => item.id === capParam);
        if (cap !== void 0) {
          const target = targetOfCapability(cap);
          if (target !== "view") pages = reducePage(pages, { type: "page-open", page: target });
          pages = reducePage(pages, { type: "palette-highlight", id: cap.id });
        }
      }
      const capOpenParam = params.get("capopen");
      if (capOpenParam !== null && capOpenParam !== "") pages = reducePage(pages, { type: "cap-open", id: capOpenParam });
      if (params.get("rebase") === "1") pages = reducePage(pages, { type: "rebase-demo" });
      const rebaseStepParam = Number(params.get("rebasestep"));
      if (Number.isInteger(rebaseStepParam) && rebaseStepParam > 0) {
        pages = reducePage(pages, { type: "rebase-demo" });
        for (let index = 0; index < rebaseStepParam; index += 1) pages = reducePage(pages, { type: "rebase-step" });
      }
      if (params.get("conflicts") === "1") pages = reducePage(pages, { type: "conflict-demo" });
      if (params.get("task") === "1") pages = reducePage(pages, { type: "task-demo" });
      const taskProgressParam = Number(params.get("taskp"));
      if (Number.isInteger(taskProgressParam) && taskProgressParam > 62) {
        pages = reducePage(pages, { type: "task-demo" });
        while (pages.taskProgress < taskProgressParam && pages.taskProgress < 100) pages = reducePage(pages, { type: "task-tick" });
      }
      const searchParam = params.get("search");
      if (searchParam !== null) {
        pages = reducePage(pages, { type: "page-open", page: "search" });
        if (searchParam !== "") pages = reducePage(pages, { type: "page-query", value: searchParam });
      }
      const dangerParam = params.get("danger");
      if (dangerParam !== null && dangerParam !== "") pages = reducePage(pages, { type: "danger-open", id: dangerParam });
    }
    applyDeepLink();
    document.documentElement.dataset.theme = theme;
    render({ focusKey: null });
    window.setInterval(() => dispatch({ type: "tick" }, { focusKey: lastFocusKey }), 3e4);
  }
  function cssEscape(value) {
    return value.replace(/["\\]/g, "\\$&");
  }

  // docs/prototype/vc-redesign/src/main.ts
  var root = document.getElementById("app");
  if (root === null) throw new Error("\u539F\u578B\u9875\u9762\u7F3A\u5C11 #app \u6302\u8F7D\u70B9\uFF1Aindex.html \u4E0E src/main.ts \u4E0D\u4E00\u81F4\u3002");
  mount(root);
})();
