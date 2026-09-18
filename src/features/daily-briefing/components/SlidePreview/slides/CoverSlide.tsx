'use client';

/**
 * CoverSlide — AI 早报封面页
 *
 * 从原 SlidePreview.tsx 的 CoverSlide 函数提取（2026-09-04 P0-1）。
 * 设计：左 60% 白底文 / 右 40% 蓝青渐变色块 + 网格背景 + 巨型日期。
 *
 * 行为完全等价，但颜色从硬编码 hex 改为 CSS 变量（var(--slide-*)）。
 */

import type { DailyReportContent } from '@/features/daily-briefing/lib/types';
import { W, H, PAD_X, px, FOOTER_H } from '../constants';
import { SlideShell } from '../shared/SlideShell';

export interface CoverSlideProps {
  content: DailyReportContent;
}

export function CoverSlide({ content }: CoverSlideProps) {
  // 方案 A：左 60% 白底文 / 右 40% 蓝青渐变色块
  const leftW = W * 0.58;            // 约 495px
  const rightX = W * 0.60;           // 右侧色块起始
  const rightW = W - rightX;         // 约 358px
  const dateRightPad = px(0.3);

  return (
    <SlideShell grid>
      {/* 网格背景（降低透明度） */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--slide-border-light) 1px, transparent 1px), linear-gradient(to bottom, var(--slide-border-light) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.4,
        }}
      />

      {/* 右侧 40% 蓝青渐变色块 */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: rightX,
          width: rightW,
          background:
            'linear-gradient(160deg, var(--slide-primary) 0%, var(--slide-secondary) 100%)',
        }}
      />

      {/* 右侧：巨型日期 */}
      <div
        className="absolute flex flex-col items-end justify-center"
        style={{
          left: rightX,
          top: px(1.8),
          height: px(1.8),
          right: dateRightPad,
          paddingRight: px(0.1),
          color: '#FFFFFF',
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 'bold',
            fontFamily: '"Inter","Helvetica Neue",Arial,sans-serif',
            lineHeight: 1,
            textAlign: 'right',
          }}
        >
          {content.date.slice(5).replace('-', '.')}
        </div>
        <div
          style={{
            fontSize: 16,
            color: 'var(--slide-light-blue)',
            letterSpacing: 6,
            marginTop: 8,
            fontFamily: '"Inter","Helvetica Neue",Arial,sans-serif',
          }}
        >
          DAILY AI BRIEF
        </div>
        <div
          className="bg-white"
          style={{
            width: '45%',
            height: 3,
            opacity: 0.2,
            marginTop: 14,
            borderRadius: 2,
            alignSelf: 'flex-end',
          }}
        />
      </div>

      {/* 左侧内容区 */}
      <div
        className="absolute"
        style={{
          left: PAD_X,
          top: 0,
          width: leftW,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingTop: px(0.15),
          paddingBottom: px(0.1),
        }}
      >
        {/* 标签 pill */}
        <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
          <div
            className="rounded-full"
            style={{ width: 24, height: 4, background: 'var(--slide-accent)' }}
          />
          <div
            className="rounded-full font-bold"
            style={{
              background: 'var(--slide-light-blue)',
              color: 'var(--slide-primary)',
              fontSize: 13,
              fontWeight: 700,
              padding: '4px 14px',
              letterSpacing: 2,
            }}
          >
            AI 新闻每日推送
          </div>
        </div>

        {/* 主标题 */}
        <div
          style={{
            fontSize: 44,
            fontWeight: 'bold',
            color: 'var(--slide-text)',
            lineHeight: 1.1,
            marginBottom: 10,
          }}
        >
          {content.cover.title}
        </div>
        <div style={{ fontSize: 16, color: 'var(--slide-text-muted)', marginBottom: 5 }}>
          {content.cover.subtitle}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--slide-secondary)',
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          {content.cover.emphasis}
        </div>

        {/* 三个统计卡 */}
        <div className="flex" style={{ gap: px(0.14) }}>
          {content.cover.stats.map((s, i) => {
            const lightBg =
              i === 0
                ? 'var(--slide-light-blue)'
                : i === 1
                ? 'var(--slide-light-cyan)'
                : 'var(--slide-light-amber)';
            const valColor =
              i === 0
                ? 'var(--slide-primary)'
                : i === 1
                ? 'var(--slide-secondary)'
                : 'var(--slide-accent)';
            return (
              <div
                key={i}
                className="rounded-2xl"
                style={{
                  width: px(2.2),
                  height: px(1.05),
                  background: lightBg,
                  padding: '10px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: s.value.length > 6 ? 20 : 28,
                    fontWeight: 'bold',
                    color: valColor,
                    fontFamily: '"Inter","Helvetica Neue",Arial,sans-serif',
                    lineHeight: 1.1,
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--slide-text-muted)',
                    marginTop: 4,
                  }}
                >
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 页脚 */}
      <div
        className="absolute"
        style={{
          left: PAD_X,
          bottom: FOOTER_H + px(0.08),
          fontSize: 10,
          color: 'var(--slide-text-faint)',
        }}
      >
        AIHub · AI 新闻每日推送 · {content.date}
      </div>
    </SlideShell>
  );
}
