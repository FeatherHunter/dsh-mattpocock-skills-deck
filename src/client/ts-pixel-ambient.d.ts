/**
 * ts-px-ambient.d.ts — 面板闭包运行时全局变量的环境声明（887 TS 化）。
 * React / 上下文 / 读词条 / 重渲染都是宿主拼装时注入的自由变量，无源码；
 * 只声明形状，不参与转译；跨叶子的组件值引用不在这里声明，
 * 每个消费文件自己写模块级 declare const（实现文件各管各的，不冲突）。
 */
declare const React: any;
declare const DswsCtx: any;
declare function emit(s: any): void;
declare function tr(key: string, params?: Record<string, string | number>): string;
declare const host: any;
declare function log(level: string, event: string, fields?: Record<string, any>): void;
declare function promptLang(): string;
declare function dswsLogHash(s: string): string;
declare function dswsLogTrunc(s: string, n: number, kind: string): string;
