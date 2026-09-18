/**
 * 免责声明页型（Disclaimer）
 * 4 段说明：AI 自动生成 / 转载与独立信源 / 置信度评级方法 / 数据采集与时效性
 *
 * 存在的理由：legacy 引擎有 P15 免责声明页，新引擎切流后若不带这一页，
 * 等于静默丢掉合规说明。文案与 legacy 保持一致，只在此处维护一份。
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';

/** 4 段合规说明的权威文案（plan.ts 引用同一份，避免两处漂移） */
export const DISCLAIMER_SECTIONS = [
  {
    heading: '一、AI 自动生成',
    body: '本份早报内容由 AI 自动采集、聚簇、评级生成，未经人工逐条核验。读者应自行判断内容的真实性与适用性，不应将其作为唯一决策依据。',
  },
  {
    heading: '二、转载与独立信源说明',
    body: '本报告刻意区分「转载」与「独立信源」：多家媒体引用同一家独家报道，仅按 1 个独立信源计算。评级 B 以上需追溯至一手官方材料（官网 / 论文 / 公告）。',
  },
  {
    heading: '三、置信度评级方法',
    body: 'A ≥3 个相互独立的信源 + 一手官方材料；B 2 个独立信源 或 1 信源 + 一手；C 单一信源报道；D 关键数字互相矛盾 或 无官方确认。机器草稿评级上限为 B。',
  },
  {
    heading: '四、数据采集与时效性',
    body: '本份早报基于「采集时刻」的公开数据。AI 行业动态瞬息万变，6 小时前的信息可能已过时。引用前请再次访问原始链接核对最新版本。',
  },
] as const;

export const DisclaimerContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(60),
  generatedAt: z.string().max(64),
  sections: z.array(z.object({
    heading: z.string().max(30),
    body: z.string().max(240),
  })).length(DISCLAIMER_SECTIONS.length),
});

export type DisclaimerContent = z.infer<typeof DisclaimerContentSchema>;

const SLOTS = [
  'header-title', 'header-subtitle',
  'section-1', 'section-1-heading', 'section-1-body',
  'section-2', 'section-2-heading', 'section-2-body',
  'section-3', 'section-3-heading', 'section-3-body',
  'section-4', 'section-4-heading', 'section-4-body',
  'footer-note', 'page-no',
];

export const disclaimerPageType: PageTypeDefinition = {
  key: 'disclaimer',
  title: '免责声明',
  contentSchema: DisclaimerContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = DisclaimerContentSchema.parse(content);
    return checkCapacity(
      c.sections.map((s, i) => ({ slot: `section-${i + 1}-body`, chars: s.body.length, lines: 2 })),
      c.sections.map((_, i) => ({ slot: `section-${i + 1}-body`, maxChars: 240, maxLines: 2 })),
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = DisclaimerContentSchema.parse(content);
    const { theme, pageNo, totalPages } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;
    const PAD_X = 36;

    // Header
    boxes.push({
      id: 'header-title',
      slot: 'header-title',
      kind: 'text',
      box: { x: PAD_X, y: 18, w: 600, h: 32 },
      z: 2,
      text: {
        value: c.title,
        font: 'cn',
        size: theme.type.h1.size,
        weight: theme.type.h1.weight,
        lineHeight: theme.type.h1.lineHeight,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });

    boxes.push({
      id: 'header-subtitle',
      slot: 'header-subtitle',
      kind: 'text',
      box: { x: PAD_X, y: 52, w: 700, h: 18 },
      z: 2,
      text: {
        value: c.subtitle,
        font: 'cn',
        size: theme.type.caption.size,
        weight: theme.type.caption.weight,
        lineHeight: theme.type.caption.lineHeight,
        align: 'left',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    // 4 段说明：左侧色条 + 段标题 + 正文
    const START_Y = 96;
    const SECTION_H = 88;
    const GAP = 12;
    const BODY_W = W - PAD_X * 2 - 12;

    c.sections.forEach((s, i) => {
      const sy = START_Y + i * (SECTION_H + GAP);

      boxes.push({
        id: `section-${i + 1}`,
        slot: `section-${i + 1}`,
        kind: 'divider',
        box: { x: PAD_X, y: sy + 2, w: 3, h: SECTION_H - 12 },
        z: 2,
        fill: theme.colors.primary,
      });

      boxes.push({
        id: `section-${i + 1}-heading`,
        slot: `section-${i + 1}-heading`,
        kind: 'text',
        box: { x: PAD_X + 12, y: sy, w: BODY_W, h: 24 },
        z: 2,
        text: {
          value: s.heading,
          font: 'cn',
          size: theme.type.h3.size,
          weight: theme.type.h3.weight,
          lineHeight: theme.type.h3.lineHeight,
          align: 'left',
          color: theme.colors.ink,
          maxLines: 1,
        },
      });

      boxes.push({
        id: `section-${i + 1}-body`,
        slot: `section-${i + 1}-body`,
        kind: 'text',
        box: { x: PAD_X + 12, y: sy + 26, w: BODY_W, h: 52 },
        z: 2,
        text: {
          value: s.body,
          font: 'cn',
          size: theme.type.body.size,
          weight: 400,
          lineHeight: 1.5,
          align: 'left',
          color: theme.colors.inkMuted,
          maxLines: 2,
        },
      });
    });

    // 生成时间脚注
    boxes.push({
      id: 'footer-note',
      slot: 'footer-note',
      kind: 'text',
      box: { x: PAD_X, y: H - 40, w: 600, h: 16 },
      z: 2,
      text: {
        value: `生成时间 ${c.generatedAt} · AIHub 自动化推送`,
        font: 'cn',
        size: theme.type.micro.size,
        weight: 400,
        lineHeight: 1.4,
        align: 'left',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    // 页脚页码
    boxes.push({
      id: 'page-no',
      slot: 'page-no',
      kind: 'text',
      box: { x: W - 100, y: H - 22, w: 64, h: 16 },
      z: 2,
      allowUnsafe: true,
      text: {
        value: `${String(pageNo).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`,
        font: 'cn',
        size: theme.type.micro.size,
        weight: 400,
        lineHeight: 1.4,
        align: 'right',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    return { pageNo, totalPages, pageType: 'disclaimer', boxes };
  },
};
