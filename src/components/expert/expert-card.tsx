'use client';

/**
 * ExpertCard — 专家市场卡片组件
 *
 * 设计规格：
 *   - 240×150px（桌面）/ 100% 宽（移动）
 *   - 圆角 12px，1px 边框，hover 上浮
 *   - 顶部 4px accent 装饰条
 *   - 头像 48×48 Tabler icon + accent 背景
 *   - 名称 16px / 角色标签 / 描述 13px / 标签组
 *   - 选中态：2px accent 边框 + 左上角 ✓ 徽章
 *
 * 来源：腾讯元宝 WorkBuddy 卡片风格 + AIHub Workbench 配色 token 融合
 */

import { memo } from 'react';
import * as TablerIcons from '@tabler/icons-react';
import type { IconProps } from '@tabler/icons-react';
import type { ExpertListItem } from '@/types/expert';

interface ExpertCardProps {
  expert: ExpertListItem;
  selected?: boolean;
  expanded?: boolean;
  favorited?: boolean;
  onSelect?: () => void;
  onExpand?: () => void;
  onToggleFavorite?: () => void;
}

function ExpertCardImpl({
  expert,
  selected,
  expanded,
  favorited,
  onSelect,
  onExpand,
  onToggleFavorite,
}: ExpertCardProps) {
  // 动态取 Tabler icon（icon 字段存的是字符串名）
  const IconName = expert.icon as keyof typeof TablerIcons;
  const Icon = TablerIcons[IconName] as React.ComponentType<IconProps> | undefined;

  const tags = expert.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);

  const scenarios = expert.scenarios
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand?.();
        }
      }}
      style={{
        borderColor: selected ? expert.accentColor : undefined,
        boxShadow: selected ? `0 0 0 2px ${expert.accentColor}33` : undefined,
      }}
      className={[
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-card text-left',
        'transition-base gpu',
        'hover:-translate-y-0.5 hover:shadow-md',
      ].join(' ')}
    >
      {/* 顶部装饰条（accent 色） */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: expert.accentColor }}
        aria-hidden
      />

      {/* 选中徽章 / 收藏按钮 */}
      {selected && (
        <div
          className="absolute right-2 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
          style={{ backgroundColor: expert.accentColor }}
        >
          ✓
        </div>
      )}
      {onToggleFavorite && !selected && (
        <button
          type="button"
          aria-label={favorited ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={[
            'absolute right-2 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-base',
            favorited
              ? 'bg-rose-500/15 text-rose-500 hover:bg-rose-500/25'
              : 'bg-muted/60 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100',
          ].join(' ')}
        >
          {favorited ? (
            <TablerIcons.IconHeartFilled size={12} />
          ) : (
            <TablerIcons.IconHeart size={12} />
          )}
        </button>
      )}

      <div className="flex gap-3 p-3">
        {/* 头像 / 图标 */}
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `${expert.accentColor}1A`,
            color: expert.accentColor,
          }}
        >
          {Icon ? (
            <Icon size={26} stroke={1.6} />
          ) : (
            <TablerIcons.IconSparkles size={26} stroke={1.6} />
          )}
        </div>

        {/* 内容 */}
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-baseline gap-2">
            <h3 className="truncate text-[15px] font-semibold leading-tight">
              {expert.name}
            </h3>
          </div>

          <div className="mb-1.5 truncate text-[11px] text-muted-foreground">
            {expert.category}
            {expert.recommendedModel && (
              <>
                <span className="mx-1">·</span>
                <span className="font-mono opacity-70">{expert.recommendedModel}</span>
              </>
            )}
          </div>

          <p className="mb-2 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {expert.description}
          </p>

          {/* 标签组 */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* v2 展开面板：systemPrompt 预览（点击卡片时显示） */}
          {expanded && (
            <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/70">
                  提示词
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  仅展示前 200 字
                </span>
              </div>
              <p className="line-clamp-[5] whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                {expert.systemPrompt
                  ? expert.systemPrompt.slice(0, 200)
                  : '点击「选用」后可在会议中查看完整提示词'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 底部"选用"按钮（hover 时显示；选中时常显） */}
      <div
        className={[
          'absolute inset-x-0 bottom-0 flex justify-end gap-2 px-3 pb-2',
          'transition-opacity',
          selected || expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          style={{
            backgroundColor: selected ? 'transparent' : expert.accentColor,
            color: selected ? expert.accentColor : 'white',
            borderColor: selected ? expert.accentColor : 'transparent',
            borderWidth: 1,
            borderStyle: 'solid',
          }}
          className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-base hover:opacity-90"
        >
          {selected ? '取消选用' : '+ 选用'}
        </button>
      </div>
    </div>
  );
}

export const ExpertCard = memo(ExpertCardImpl);
