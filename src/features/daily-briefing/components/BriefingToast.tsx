'use client';

/**
 * AI 早报 — 右上角状态弹窗（全应用级，挂在 AppShell）
 *
 * 规则：
 * - 每天首次打开只出现一次（localStorage 记日期）
 * - 用户设置关闭「早报提示」则永不出现
 * - status === 'none'：完全不打扰（cron 7:00 跑之前用户打开也静默）
 * - 生成中：转圈 + 细粒度阶段（B7）
 * - 完成：点击查看；失败：去新闻页重试提示
 */

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { BriefingPanel } from './BriefingPanel';
import { BRIEFING_PHASE_LABELS } from '@/features/daily-briefing/lib/types';

/** 本地记录今天是否已展示过 */
const STORAGE_KEY = 'aihub-briefing-shown';

/** 生成中轮播文案（4 秒切换） */
const ROTATING_MESSAGES = [
  '今日的 AI 早报生成中…',
  '如果无须早报，可以在设置里关闭提示',
  '早报将在生成完成后在这里通知你',
];

/** 各阶段文案（R-4：从 types.ts 统一引用，禁止硬编码） */
const PHASE_LABELS: Record<string, string> = {
  ...BRIEFING_PHASE_LABELS,
  done: '早报生成完成',
};

function todayStr(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function BriefingToast() {
  const [dismissed, setDismissed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);

  // H-hydration-fix：不在 render 阶段同步读 localStorage，
  //                   避免 SSR（always false）vs 客户端 hydration（可能 true）不一致
  const [alreadyShown, setAlreadyShown] = useState(false);

  const settingsQuery = trpc.preferences.getNewsSettings.useQuery();
  // 与 Settings 面板语义对齐：默认开启（schema @default(true)）
  const enabled = settingsQuery.data?.briefingToast ?? true;

  const todayQuery = trpc.dailyReport.today.useQuery(undefined, {
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'generating' ? 5000 : false,
  });

  const status = todayQuery.data?.status ?? 'none';

  // 客户端挂载后才读 localStorage（与 SSR 对齐：初始值 = false，mounted 后更新）
  useEffect(() => {
    setAlreadyShown(localStorage.getItem(STORAGE_KEY) === todayStr());
  }, []);

  // 文案轮播
  useEffect(() => {
    if (status !== 'generating' || dismissed || alreadyShown) return;
    const id = setInterval(
      () => setMsgIndex(i => (i + 1) % ROTATING_MESSAGES.length),
      4000,
    );
    return () => clearInterval(id);
  }, [status, dismissed, alreadyShown]);

  const markShown = () => localStorage.setItem(STORAGE_KEY, todayStr());

  const handleClose = () => { markShown(); setDismissed(true); };
  const handleView = () => { markShown(); setDismissed(true); setPanelOpen(true); };

  // C5：none 状态不出现弹窗
  const visible =
    enabled && !dismissed && !alreadyShown &&
    status !== 'none' &&
    (status === 'generating' || status === 'ready' || status === 'failed');

  if (!visible && !panelOpen) return null;

  // B7：从 todayQuery.data 拿 phase，显示细粒度阶段
  const phase = todayQuery.data?.phase;
  const phaseText = phase ? PHASE_LABELS[phase] : ROTATING_MESSAGES[msgIndex];

  return (
    <>
      {visible && (
        <div className="fixed right-4 top-4 z-40 w-[300px] rounded-lg border border-border bg-card p-3.5">
          <div className="page-enter flex items-start gap-2.5">
            {status === 'generating' && (
              <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border border-border border-t-foreground" />
            )}
            {status === 'ready' && (
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-600">
                ✓
              </span>
            )}
            {status === 'failed' && (
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-[10px] font-bold text-rose-600">
                !
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                AI 早报
              </p>
              {status === 'generating' && (
                <p className="mt-1 text-xs leading-relaxed text-foreground">
                  {phaseText}
                </p>
              )}
              {status === 'ready' && (
                <>
                  <p className="mt-1 text-xs text-foreground">今日 AI 早报已生成</p>
                  <button
                    type="button"
                    onClick={handleView}
                    className="mt-2 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90"
                  >
                    点击查看
                  </button>
                </>
              )}
              {status === 'failed' && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  数据获取异常，如需重新生成，可以到 AI 新闻页生成
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="shrink-0 rounded px-1 text-muted-foreground transition hover:text-foreground"
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <BriefingPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}
