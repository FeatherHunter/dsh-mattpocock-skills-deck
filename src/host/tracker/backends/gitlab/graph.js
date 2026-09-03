// graph.js —— gitlab 房图关系入口：以后改房间对外导出清单时改它（约 12 行）。
// 实现按改动理由分住阻塞与亲缘两文件，本文件只转出口，行为与拆分前一致。
export { getDependencies, setBlockedBy } from './graph-blocking.js'
export { setParent, setAssignees } from './graph-membership.js'
import { getDependencies, setBlockedBy } from './graph-blocking.js'
import { setParent, setAssignees } from './graph-membership.js'
export default { getDependencies, setBlockedBy, setParent, setAssignees }
