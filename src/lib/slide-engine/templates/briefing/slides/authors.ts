/**
 * 作者页型（Authors）
 * 2 列作者卡：头像 + 名字 + 状态 + 描述 + 链接
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { FONT } from '../theme';

export const AuthorsContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(60),
  authors: z.array(z.object({
    name: z.string().max(30),
    status: z.enum(['ok', 'warn']),
    statusText: z.string().max(20),
    count: z.number().int().nullable(),
    description: z.string().max(120),
    url: z.string().url(),
  })).min(1).max(4),
});

export type AuthorsContent = z.infer<typeof AuthorsContentSchema>;

const SLOTS = ['header-title', 'header-subtitle', 'author-1', 'author-2', 'author-3', 'author-4', 'page-no'];

export const authorsPageType: PageTypeDefinition = {
  key: 'authors',
  title: '作者',
  contentSchema: AuthorsContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = AuthorsContentSchema.parse(content);
    return checkCapacity(
      c.authors.map((a, i) => ({ slot: `author-${i + 1}`, chars: a.description.length, lines: 5 })),
      c.authors.map((_, i) => ({ slot: `author-${i + 1}`, maxChars: 120, maxLines: 5 })),
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = AuthorsContentSchema.parse(content);
    const { theme, pageNo, totalPages, measureLines } = ctx;
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
      box: { x: PAD_X, y: 52, w: 600, h: 18 },
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

    // 作者卡
    const cardTop = 100;
    const cardH = H - cardTop - 60;
    const cardGap = 24;
    const cardCount = Math.min(c.authors.length, 2);
    const cardW = (W - PAD_X * 2 - cardGap * (cardCount - 1)) / cardCount;

    c.authors.slice(0, cardCount).forEach((author, i) => {
      const cx = PAD_X + i * (cardW + cardGap);
      const isOk = author.status === 'ok';
      const primaryColor = isOk ? theme.colors.primary : theme.colors.accent;
      const softColor = isOk ? theme.colors.primarySoft : theme.colors.accentSoft;

      // 卡片背景
      boxes.push({
        id: `author-${i + 1}`,
        slot: `author-${i + 1}`,
        kind: 'card',
        box: { x: cx, y: cardTop, w: cardW, h: cardH },
        z: 2,
        fill: theme.colors.surface,
        radius: 4,
        borderColor: theme.colors.border,
      });

      // 顶部色带
      boxes.push({
        id: `author-${i + 1}-header`,
        slot: `author-${i + 1}`,
        kind: 'card',
        box: { x: cx, y: cardTop, w: cardW, h: 50 },
        z: 3,
        fill: primaryColor,
        radius: 0,
      });

      // 名字（盒高按 h3 × lineHeight 1.2 = 19.2pt 给足，留 21pt）
      boxes.push({
        id: `author-${i + 1}-name`,
        slot: `author-${i + 1}`,
        kind: 'text',
        box: { x: cx + 16, y: cardTop + 10, w: cardW - 90, h: 21 },
        z: 4,
        text: {
          value: author.name.split(' ')[0],
          font: 'cn',
          size: FONT.h3,
          weight: 700,
          lineHeight: 1.2,
          align: 'left',
          color: '#FFFFFF',
          maxLines: 1,
        },
      });

      // 状态 —— 只占名字下方的左半部分，不和 count 重叠
      boxes.push({
        id: `author-${i + 1}-status`,
        slot: `author-${i + 1}`,
        kind: 'text',
        box: { x: cx + 16, y: cardTop + 32, w: cardW - 90, h: 16 },
        z: 4,
        text: {
          value: author.statusText,
          font: 'cn',
          size: FONT.micro,
          weight: 400,
          lineHeight: 1.3,
          align: 'left',
          color: '#FFFFFFD9',
          maxLines: 1,
        },
      });

      // count
      if (author.count !== null) {
        boxes.push({
          id: `author-${i + 1}-count`,
          slot: `author-${i + 1}`,
          kind: 'text',
          box: { x: cx + cardW - 70, y: cardTop + 14, w: 60, h: 22 },
          z: 4,
          text: {
            value: `${author.count} 条`,
            font: 'num',
            size: FONT.h3,
            weight: 700,
            lineHeight: 1.2,
            align: 'right',
            color: '#FFFFFF',
            maxLines: 1,
          },
        });
      }

      // 描述
      const descLines = measureLines(author.description, FONT.caption, cardW - 32, { weight: 400, font: 'cn' });
      boxes.push({
        id: `author-${i + 1}-desc`,
        slot: `author-${i + 1}`,
        kind: 'text',
        box: { x: cx + 16, y: cardTop + 66, w: cardW - 32, h: descLines * FONT.caption * 1.55 },
        z: 4,
        text: {
          value: author.description,
          font: 'cn',
          size: FONT.caption,
          weight: 400,
          lineHeight: 1.55,
          align: 'left',
          color: theme.colors.inkMuted,
          maxLines: Math.min(descLines, 5),
        },
      });

      // 链接
      boxes.push({
        id: `author-${i + 1}-link`,
        slot: `author-${i + 1}`,
        kind: 'text',
        box: { x: cx + 16, y: cardTop + cardH - 30, w: cardW - 32, h: 18 },
        z: 4,
        text: {
          value: `🔗 ${author.url.slice(0, 40)}`,
          font: 'cn',
          size: FONT.micro,
          weight: 400,
          lineHeight: 1.3,
          align: 'left',
          color: '#1D4ED8',
          maxLines: 1,
        },
      });
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
        size: FONT.micro,
        weight: 400,
        lineHeight: 1.4,
        align: 'right',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    return { pageNo, totalPages, pageType: 'authors', boxes };
  },
};
