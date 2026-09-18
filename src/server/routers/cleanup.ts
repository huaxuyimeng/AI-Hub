// cleanupRouter：磁盘清理（盘符 / 扫描 / 清理任务 / 会话恢复 / 报告）
//
// 数据流：
//   - listDrives    → 所有盘符 + 容量
//   - targets       → 某盘白名单清单（不算大小）
//   - scanStart     → 启动渐进扫描任务，前端轮询 task
//   - cleanStart    → 按 id 白名单启动清理（写 session 文件，可中断恢复）
//   - sessionState / resumeSession / discardSession → 中断恢复
//   - reports / report → 清理报告（清理了什么/多少/还能清多少/建议）

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../context';
import {
  listDrives,
  buildTargets,
  startScan,
  startClean,
  resumeSession,
  discardSession,
  getSessionInfo,
  getTaskProgress,
  listReports,
  getReport,
} from '../lib/cleanup-engine';

export const cleanupRouter = router({
  /** 所有盘符（C-Z 中实际存在的）+ 容量 */
  listDrives: protectedProcedure.query(async () => {
    return listDrives();
  }),

  /** 某盘的清理项清单（不含大小，需另行扫描） */
  targets: protectedProcedure
    .input(z.object({ drive: z.string().length(1) }))
    .query(async ({ input }) => {
      const letter = input.drive.toUpperCase();
      if (!/^[A-Z]$/.test(letter)) {
        // B-13 修复：throw 改为 TRPCError，前端 tRPC 客户端对原始 Error 解析行为不确定。
        throw new TRPCError({ code: 'BAD_REQUEST', message: '非法盘符' });
      }
      return buildTargets(letter);
    }),

  /** 当前任务进度（扫描 / 清理共用，前端 1s 轮询） */
  task: protectedProcedure.query(async () => {
    return getTaskProgress();
  }),

  /** 启动扫描 */
  scanStart: protectedProcedure
    .input(z.object({ drive: z.string().length(1) }))
    .mutation(async ({ input }) => {
      const letter = input.drive.toUpperCase();
      if (!/^[A-Z]$/.test(letter)) {
        // B-13 修复：同上
        throw new TRPCError({ code: 'BAD_REQUEST', message: '非法盘符' });
      }
      return startScan(letter);
    }),

  /** 启动清理（只允许白名单 id） */
  cleanStart: protectedProcedure
    .input(z.object({ itemIds: z.array(z.string()).min(1).max(100) }))
    .mutation(async ({ input }) => {
      for (const id of input.itemIds) {
        if (!/^[a-z]-[a-z0-9-]+$/.test(id)) {
          // B-13 修复：同上
          throw new TRPCError({ code: 'BAD_REQUEST', message: `非法清理项：${id}` });
        }
      }
      return startClean(input.itemIds);
    }),

  /** 中断会话状态（服务重启后恢复用） */
  sessionState: protectedProcedure.query(async () => {
    return getSessionInfo();
  }),

  /** 恢复中断的清理 */
  resumeSession: protectedProcedure.mutation(async () => {
    return resumeSession();
  }),

  /** 丢弃中断会话 */
  discardSession: protectedProcedure.mutation(async () => {
    await discardSession();
    return { ok: true };
  }),

  /** 历史报告列表 */
  reports: protectedProcedure.query(async () => {
    return listReports();
  }),

  /** 报告详情 */
  report: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const r = await getReport(input.id);
      if (!r) {
        // B-13 修复：同上
        throw new TRPCError({ code: 'NOT_FOUND', message: '报告不存在' });
      }
      return r;
    }),
});
