/**
 * src/main.ts —— 原型入口：只做一件事，把界面挂到 #app 上。
 */
import { mount } from './ui/app'

const root = document.getElementById('app')
if (root === null) throw new Error('原型页面缺少 #app 挂载点：index.html 与 src/main.ts 不一致。')

mount(root)
