/**
 * shared/gh-write-generation.js — 写世代计数器（#964 · 同钥匙搭车的三条“不搭”之一：写后不搭）。
 *
 * 做法：任何 gh 写操作成功之后把这个数加一（room client 与 runGh 各一处，共两处落点，
 * 都认 isWriteGhArgs）；探测链在“旧的没回”时只当写世代没变才让新的搭旧的，
 * 写过东西之后来的请求一律自己跑一轮 fresh。
 *
 * 内存数：进程重启归零（搭车只管“这一轮在飞的时候有没有写”，不需要跨进程记忆）。
 */
let generation = 0

/** 写成功之后调一次。 */
export function noteGhWrite() { generation += 1 }

/** 当前世代（只增不减的整数）。 */
export function ghWriteGeneration() { return generation }

export function resetGhWriteGenerationForTest() { generation = 0 }

export default ghWriteGeneration
