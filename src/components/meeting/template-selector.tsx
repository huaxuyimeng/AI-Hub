'use client';

/**
 * TemplateSelector — 会议模板选择器（v1 — 2026-09-17）
 *
 * 放在新建会议页的主题输入上方。
 * 用户点击模板后：
 *   1. 自动填充主题（占位符用户可改）
 *   2. 自动选好建议的专家（自动调 ExpertSelectorDrawer + 预填）
 *
 * 设计：
 *   - 水平滚动卡片（横向）
 *   - 每个模板一张卡：icon + 名称 + 描述 + 参与人数
 *   - 选中态：accent 边框 + 高亮
 */

import { useMemo, useState } from 'react';
import * as TablerIcons from '@tabler/icons-react';
import { MEETING_TEMPLATES, type MeetingTemplate } from '@/lib/meeting/templates';
import type { ExpertListItem } from '@/types/expert';

function IconLookup(name: string): React.ComponentType<{ size?: number; stroke?: number }> | undefined {
  const map = TablerIcons as unknown as Record<string, React.ComponentType<{ size?: number; stroke?: number }>>;
  return map[name];
}

interface TemplateSelectorProps {
  /** 加载好的专家列表（用于把 slug 解析成 ExpertListItem） */
  experts: ExpertListItem[];
  /** 用户选模板后的回调 */
  onSelect: (topic: string, resolvedExperts: ExpertListItem[]) => void;
  /** 当前已选中的模板 ID（用于高亮） */
  selectedTemplateId?: string;
}

export function TemplateSelector({ experts, onSelect, selectedTemplateId }: TemplateSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 预处理：O(1) slug 查 ExpertListItem（避免 render 内 O(T×E) 查找）
  const slugMap = useMemo(() => {
    const m = new Map<string, ExpertListItem>();
    for (const e of experts) m.set(e.slug, e);
    return m;
  }, [experts]);

  function handleSelect(template: MeetingTemplate) {
    const resolved = template.suggestedExperts
      .map((slug) => slugMap.get(slug))
      .filter((e): e is ExpertListItem => !!e);
    onSelect(template.topic, resolved);
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          或从模板快速开始
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          点击模板自动选好专家
        </span>
      </div>

      {/* 横向滚动容器 */}
      <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin">
        {MEETING_TEMPLATES.map((t) => {
          const isHovered = hoveredId === t.id;
          const isSelected = selectedTemplateId === t.id;
          const Icon = IconLookup(t.icon);

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t)}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={`点击使用：主题将被设为「${t.topic}」（含占位符，可直接编辑）`}
              className={[
                'group relative flex w-44 shrink-0 flex-col rounded-xl border p-3.5 text-left transition-all duration-150',
                isSelected
                  ? 'border-2 shadow-sm'
                  : 'border border-border hover:border-primary/50 hover:shadow-sm',
              ].join(' ')}
              style={
                isSelected
                  ? { borderColor: t.accentColor, borderWidth: 2 }
                  : isHovered
                    ? { borderColor: `${t.accentColor}80` }
                    : {}
              }
            >
              {/* 顶部 icon + 参与人数 */}
              <div className="mb-2 flex items-center justify-between">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: `${t.accentColor}1A`,
                    color: t.accentColor,
                  }}
                >
                  {Icon ? <Icon size={18} stroke={1.6} /> : <TablerIcons.IconSparkles size={18} stroke={1.6} />}
                </div>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${t.accentColor}1A`, color: t.accentColor }}
                >
                  {t.suggestedExperts.length} 位专家
                </span>
              </div>

              {/* 名称 */}
              <h3
                className={[
                  'mb-1 text-[13px] font-semibold transition-colors',
                  isHovered || isSelected ? '' : 'text-foreground/80',
                ].join(' ')}
              >
                {t.name}
              </h3>

              {/* 描述 */}
              <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {t.description}
              </p>

              {/* 底部专家名 */}
              <div className="mt-2 flex flex-wrap gap-1">
                {t.suggestedExperts.slice(0, 3).map((slug) => {
                  const exp = slugMap.get(slug);
                  return (
                    <span
                      key={slug}
                      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: `${exp?.accentColor ?? '#888'}1A`,
                        color: exp?.accentColor ?? '#888',
                      }}
                    >
                      {exp?.name ?? slug}
                    </span>
                  );
                })}
                {t.suggestedExperts.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{t.suggestedExperts.length - 3}
                  </span>
                )}
              </div>

              {/* 选中高亮条 */}
              {(isHovered || isSelected) && (
                <div
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-xl opacity-80"
                  style={{ backgroundColor: t.accentColor }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
