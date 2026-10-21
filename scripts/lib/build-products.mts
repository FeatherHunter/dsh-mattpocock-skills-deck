/**
 * scripts/lib/build-products.mts —— 产物双闸用的「四个入口产物 + 六份构建输入」清单（#1342）
 *
 * 为什么单立这一份：矩阵冒烟（scripts/matrix-smoke.ts）、全矩阵（scripts/matrix-full.ts）、
 * 平台契约门禁（tests/verify-platform-contract.ts）与新鲜度判据回归门禁
 * （tests/verify-1327-freshness-content.ts）原先各手抄一份字面量相同的清单，
 * 改一个产物或一份输入就得四处对齐，漏一处也不会有人发现。现在清单只在这里定义，
 * 各处取用后原样传给 scripts/lib/build-cache.mts 的 judgeProducts()。
 *
 * 改这里要留神：judgeProducts 按产物名找产物、按源码清单算输入摘要；少一个产物就少判一项新鲜度，
 * 多一个不存在的产物会直接判 stale，所以增删前先确认构建真的产出/消费了那个文件。
 */

export const BUILD_PRODUCTS: string[] = ['client.js', 'host.js', 'package/lib/client.js', 'package/lib/index.js']

export const BUILD_SOURCES: string[] = [
  'src/host/platform/win32/index.ts',
  'src/host/platform/index.ts',
  'src/host/platform/darwin/index.ts',
  'src/host/platform/linux/index.ts',
  'scripts/build.mts',
  'package/package.json',
]
