// AUTO-GENERATED。来源脚本：docs/prototype/vc-redesign/tools/capture-git.ts。
// 采集时间 2026-10-30T18:53:26.750Z；仓库根 D:\dsh-plugin\dsh-mattpocock-skills-deck；分支 main；提交 50 条；工作区 60 个；
// 远端 3 个；标签 40 个；本地分支 112 条；引用 325 条；钩子目录 14 项。
// 不要手改；要刷新就重新跑一次生成脚本。
export interface CapturedFile {
  path: string
  added: number
  deleted: number
}

export interface CapturedCommit {
  oid: string
  short: string
  author: string
  email: string
  authorDateMs: number
  subject: string
  parents: string[]
  files: CapturedFile[]
}

export interface CapturedWorktree {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
}

export interface CapturedRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface CapturedTag {
  name: string
  shortOid: string
  createdAtMs: number
}

export interface CapturedCounts {
  loose: number
  sizeKiB: number
  inPack: number
  packs: number
  sizePackKiB: number
  prunePackable: number
  garbage: number
}

export interface CapturedHook {
  name: string
  sample: boolean
  sizeBytes: number
}

export interface CapturedConfig {
  key: string
  value: string
  scope: 'local' | 'global'
}

export const capturedAtMs = 1793386406751
export const capturedRepoRoot = "D:\\dsh-plugin\\dsh-mattpocock-skills-deck"
export const capturedHead = "e489673f240ed18a2e71bb6de5bfc635b2fed73c"
export const capturedBranch = "main"
export const capturedCommits: CapturedCommit[] = [
  {
    "oid": "e489673f240ed18a2e71bb6de5bfc635b2fed73c",
    "short": "e489673f",
    "author": "FeatherHunter",
    "email": "975559549@qq.com",
    "authorDateMs": 1793384302000,
    "subject": "地图执行入口提示词升到 v23：补开工、推进、关 issue、收尾四节操作约束",
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
    "authorDateMs": 1793377576000,
    "subject": "回填规格票 #1681 到两份 ADR 与迁移计划，修正预算、探针与通知口径",
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
    "authorDateMs": 1793377220000,
    "subject": "新增 #1680 探针笔记：GitLab 工作区夹具与真机工具台缺口",
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
    "authorDateMs": 1793374917000,
    "subject": "定稿面板快照单一数据源与 GitHub 房间分层：新增两份 ADR、迁移计划与术语，并补两份调研笔记",
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
    "authorDateMs": 1793374886000,
    "subject": "补记第二轮 git 边界实测：待办清单覆盖、合并说明与工作树移除",
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
    "authorDateMs": 1793374192000,
    "subject": "加入 GitLab 与 GitHub 真机差异研究笔记（#1679）",
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
    "authorDateMs": 1793373923000,
    "subject": "加入 GitLab 模式用户可见路径研究笔记（#1674）",
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
    "authorDateMs": 1793373488000,
    "subject": "补 #1593 研究笔记：九组 git 边界行为本机实测",
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
    "authorDateMs": 1793369634000,
    "subject": "合并远端主线的最新提交，解决与 #1665、#1671 等改动的交叉（#1667）",
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
    "authorDateMs": 1793357640000,
    "subject": "补 #1671 分诊笔记：查明中文模板首行与第三方后端 id 读不出，给出修法与门禁方案",
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
    "authorDateMs": 1793357607000,
    "subject": "重新生成发布目录里的 README：跟随上游 Star History 日期参数",
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
    "authorDateMs": 1793357426000,
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
    "authorDateMs": 1793357386000,
    "subject": "修复建议气泡在输入框撑高时脱钩状态栏、折叠态飞出屏幕（#1665）",
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
    "authorDateMs": 1793355862000,
    "subject": "详情页顶栏动作按钮的可点性判据补正注释并把门禁模板接到词表真源（#1667）",
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
    "authorDateMs": 1793350587000,
    "subject": "致谢表自动更新：把新编号贡献并进来，中英两表按花数与最后活跃重排",
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
    "authorDateMs": 1793349513000,
    "subject": "每日更新 Star History：追加拉取到的星标数据并重新生成手绘双主题图表",
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
    "authorDateMs": 1793345170000,
    "subject": "详情页顶栏两颗按钮压灰时不再挂点击日志定位串（#1667）",
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
    "authorDateMs": 1793343300000,
    "subject": "补一条详情加载中只剩打开快照的接线门禁用例（#1667）",
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
    "authorDateMs": 1793343156000,
    "subject": "合并远端主线的最新提交（#1670 建议工具理由说明改为写具体依据），并重生成门禁归属表",
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
    "authorDateMs": 1793342858000,
    "subject": "详情页顶栏在票被未完成票阻塞时也置灰动作按钮（#1669）",
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
    "authorDateMs": 1793341965000,
    "subject": "把建议工具的理由说明从两种模板改成写具体依据（#1670）",
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
    "authorDateMs": 1793341486000,
    "subject": "合并远端主线带入 md 目录签修复（#1664），并重生成门禁归属表",
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
    "authorDateMs": 1793341085000,
    "subject": "详情页顶栏在票已关闭或已合并时置灰动作按钮（#1668）",
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
    "authorDateMs": 1793340701000,
    "subject": "修好主列表第一排 md目录签：超 10 个折叠，全关的工作单元不再出现（#1664）",
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
    "authorDateMs": 1793339767000,
    "subject": "把探索地图提示词里的 subissue 改成官方写法 sub-issue",
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
    "authorDateMs": 1793339312000,
    "subject": "给新建探索地图提示词讲清并行串行分工与收尾复查顺序",
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
    "authorDateMs": 1793338451000,
    "subject": "建议工具说明补上「等用户补充」的半句话模板分支（#1666）",
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
    "authorDateMs": 1793338395000,
    "subject": "修复 suggest 气泡层级与锚点：气泡与胶囊同层、锚点跟胶囊走（#1665）",
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
    "authorDateMs": 1793336779000,
    "subject": "给新建探索地图提示词的并行串行节做措辞微调",
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
    "authorDateMs": 1793336172000,
    "subject": "给新建探索地图提示词加上并行串行设计与收尾复查要求",
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
    "authorDateMs": 1793330832000,
    "subject": "把中英文 README 的锁版号从 beta.22 推进到 beta.32 并重生成发布目录说明",
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
    "authorDateMs": 1793329402000,
    "subject": "写清发布失败后不重跑与证据不可变两条规则",
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
    "authorDateMs": 1793328987000,
    "subject": "补齐读票写票的三条省时规则并标记过期工作流文档（retro 落地 1/2/5）",
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
    "authorDateMs": 1793296886000,
    "subject": "补齐 1.9.0-beta.32 发行说明，写进黄条单行与悬停提示宽度两处修复",
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
    "authorDateMs": 1793291541000,
    "subject": "合并 1662 门禁反证修复到主分支：D1 反证跟着黄条新形状走，门禁归属表重生成",
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
    "authorDateMs": 1793291504000,
    "subject": "合并 1660 悬停提示宽度口径修复到主分支：限宽与排位统一按渲染外框宽计算，门禁与 ADR 同步",
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
    "authorDateMs": 1793291141000,
    "subject": "按黄条新形状修复 669 门禁的 D1 反证（#1662）",
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
    "authorDateMs": 1793288680000,
    "subject": "修复悬停提示的宽度口径：限宽与排位统一按渲染外框宽计算（#1660）",
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
    "authorDateMs": 1793283868000,
    "subject": "新增黄条单行自适应的门禁：短句与单行不断言行为，只守形状",
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
    "authorDateMs": 1793283484000,
    "subject": "黄条改成短句单行自适应：文案压短并不换行，宽度跟着内容走",
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
    "authorDateMs": 1793282451000,
    "subject": "真机验证工具预置三款窗口尺寸，设完还要核对插件真的进了那一支布局（#1637）",
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
    "authorDateMs": 1793275865000,
    "subject": "真机验证工具：有头窗口必须真全屏，切不成就判失败",
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
    "authorDateMs": 1793268948000,
    "subject": "发布 1.9.0-beta.32 的发行说明：补上 beta.31 之后的界面修复与真机验证工具链",
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
    "authorDateMs": 1793268948000,
    "subject": "修掉 #1649 门禁在 Windows 上通过后仍被判红的退出竞态",
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
    "authorDateMs": 1793266005000,
    "subject": "每日更新 Star History：README 里图表日期参数推进到 2026-10-29",
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
    "authorDateMs": 1793266005000,
    "subject": "补全界面词条：状态栏、面板顶栏、列表、环境检查、拉取请求、技能、地图详情、票详情、设置等页面元素都补上中文叫法与避免叫法",
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
    "authorDateMs": 1793265261000,
    "subject": "词典新增悬停提示方位一条：方向四种、统一规则定、调用方不得指定（#1651 第11条）",
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
    "authorDateMs": 1793263955000,
    "subject": "致谢表自动更新：把新编号贡献并进来，中英两表按花数与最后活跃重排",
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
    "authorDateMs": 1793263703000,
    "subject": "关闭与展开改走跟随确认：红色叉与展开键先冒浮层，确认才改三处，老全屏框下线（#1655，实施 #1657 #1658）",
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
    "authorDateMs": 1793262490000,
    "subject": "每日更新 Star History：追加拉取到的星标数据并重新生成手绘双主题图表",
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
]
export const capturedWorktrees: CapturedWorktree[] = [
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
]
export const capturedRemotes: CapturedRemote[] = [
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
]
export const capturedTags: CapturedTag[] = [
  {
    "name": "v1.9.0-beta.32",
    "shortOid": "fac909c1",
    "createdAtMs": 1793296886000
  },
  {
    "name": "v1.9.0-beta.18",
    "shortOid": "584127b1",
    "createdAtMs": 1792915479000
  },
  {
    "name": "v1.9.0-beta.17",
    "shortOid": "9f56fcb3",
    "createdAtMs": 1792867061000
  },
  {
    "name": "v1.9.0-beta.16",
    "shortOid": "8f583b88",
    "createdAtMs": 1792852321000
  },
  {
    "name": "v1.9.0-beta.15",
    "shortOid": "08e692d5",
    "createdAtMs": 1792840179000
  },
  {
    "name": "v1.9.0-beta.14",
    "shortOid": "40fbe79b",
    "createdAtMs": 1792839199000
  },
  {
    "name": "v1.9.0-beta.13",
    "shortOid": "13568780",
    "createdAtMs": 1792834845000
  },
  {
    "name": "v1.9.0-beta.12",
    "shortOid": "4590049a",
    "createdAtMs": 1792829259000
  },
  {
    "name": "v1.9.0-beta.11",
    "shortOid": "ed0ad92b",
    "createdAtMs": 1792754912000
  },
  {
    "name": "v1.9.0-beta.10",
    "shortOid": "f8ccc9c4",
    "createdAtMs": 1792734329000
  },
  {
    "name": "v1.9.0-beta.9",
    "shortOid": "788748d1",
    "createdAtMs": 1792671643000
  },
  {
    "name": "v1.9.0-beta.8",
    "shortOid": "6b2782e2",
    "createdAtMs": 1792604622000
  },
  {
    "name": "archive/1279-dual-map-panel",
    "shortOid": "7d5b1a2e",
    "createdAtMs": 1792431686000
  },
  {
    "name": "archive/1086-work-route-release",
    "shortOid": "681b2fc5",
    "createdAtMs": 1792390466000
  },
  {
    "name": "v1.9.0-beta.5",
    "shortOid": "ea0dc073",
    "createdAtMs": 1792321399000
  },
  {
    "name": "v1.9.0-beta.4",
    "shortOid": "fac4dbb8",
    "createdAtMs": 1792256468000
  },
  {
    "name": "v1.9.0-beta.3",
    "shortOid": "65d9da86",
    "createdAtMs": 1792254014000
  },
  {
    "name": "v1.9.0-beta.2",
    "shortOid": "af59dfe6",
    "createdAtMs": 1792215442000
  },
  {
    "name": "v1.7.51",
    "shortOid": "3550b254",
    "createdAtMs": 1791511002000
  },
  {
    "name": "v1.7.45",
    "shortOid": "080bc9b6",
    "createdAtMs": 1791316881000
  },
  {
    "name": "v1.7.38",
    "shortOid": "aabb165a",
    "createdAtMs": 1790830425000
  },
  {
    "name": "v1.7.37",
    "shortOid": "93b6fa47",
    "createdAtMs": 1790828024000
  },
  {
    "name": "v1.7.36",
    "shortOid": "4a373d29",
    "createdAtMs": 1790826198000
  },
  {
    "name": "v1.7.35",
    "shortOid": "9d0afd4f",
    "createdAtMs": 1790824388000
  },
  {
    "name": "v1.7.34",
    "shortOid": "11d35669",
    "createdAtMs": 1790759607000
  },
  {
    "name": "v1.7.33",
    "shortOid": "c767db82",
    "createdAtMs": 1790664432000
  },
  {
    "name": "v1.7.32",
    "shortOid": "4be778d1",
    "createdAtMs": 1790579067000
  },
  {
    "name": "v1.7.30",
    "shortOid": "dac6fb10",
    "createdAtMs": 1790267246000
  },
  {
    "name": "v1.7.29",
    "shortOid": "b9583cbb",
    "createdAtMs": 1790227481000
  },
  {
    "name": "v1.7.26",
    "shortOid": "3c5096d8",
    "createdAtMs": 1789986975000
  },
  {
    "name": "v1.7.25",
    "shortOid": "aeb4b154",
    "createdAtMs": 1789966209000
  },
  {
    "name": "v1.7.24",
    "shortOid": "ced71f95",
    "createdAtMs": 1789916516000
  },
  {
    "name": "v1.7.23",
    "shortOid": "e2926353",
    "createdAtMs": 1789901209000
  },
  {
    "name": "v1.7.22",
    "shortOid": "15321903",
    "createdAtMs": 1789577683000
  },
  {
    "name": "v1.7.21",
    "shortOid": "6d492b1b",
    "createdAtMs": 1789215943000
  },
  {
    "name": "v1.7.20",
    "shortOid": "4ff8bea5",
    "createdAtMs": 1789190429000
  },
  {
    "name": "v1.7.19",
    "shortOid": "f7825d4f",
    "createdAtMs": 1789188880000
  },
  {
    "name": "v1.7.18",
    "shortOid": "651e1759",
    "createdAtMs": 1789027505000
  },
  {
    "name": "v1.7.17",
    "shortOid": "ae9c3233",
    "createdAtMs": 1789002854000
  },
  {
    "name": "v1.7.16",
    "shortOid": "b95e88b1",
    "createdAtMs": 1789001596000
  }
]
export const capturedCounts: CapturedCounts = {
  "loose": 3186,
  "sizeKiB": 72903,
  "inPack": 40361,
  "packs": 2,
  "sizePackKiB": 699150,
  "prunePackable": 60,
  "garbage": 0
}
export const capturedHooks: CapturedHook[] = [
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
]
export const capturedConfig: CapturedConfig[] = [
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
]
export const capturedSubmodules = ""
export const capturedLocalBranchNames: string[] = [
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
]
export const capturedLocalBranches = 112
export const capturedRefsTotal = 325
export const capturedGitVersion = "git version 2.49.0.windows.1"
export const capturedDescribe = "v1.9.0-beta.32-33-ge489673f2-dirty"
export const capturedStatusRaw = "# branch.oid e489673f240ed18a2e71bb6de5bfc635b2fed73c\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n1 .M N... 100644 100644 100644 41977778c4aa7156b3aee4182666d59a80d80c0c 41977778c4aa7156b3aee4182666d59a80d80c0c docs/prototype/vc-redesign/src/data/repo.generated.ts\n1 .M N... 100644 100644 100644 639a517d71b4722bcec020f6eb4087a39467bc7f 639a517d71b4722bcec020f6eb4087a39467bc7f docs/prototype/vc-redesign/tools/capture-git.ts\n? assets/video/中文-spec-implementspec-2.mp4\n? docs/prototype/vc-redesign/src/data/capabilities.generated.ts\n? docs/prototype/vc-redesign/src/data/pages-copy.ts\n? docs/prototype/vc-redesign/src/domain/pages.ts\n? docs/prototype/vc-redesign/src/ui/views/page-shell.ts\n? docs/prototype/vc-redesign/tools/_probe.mjs\n? docs/prototype/vc-redesign/tools/capture-capabilities.ts\n"
