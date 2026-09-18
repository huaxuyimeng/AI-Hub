/**
 * Slide IR：整份演示的中间表示
 * LLM 管线产出它，布局层消费它；不含任何布局信息
 */

import { z } from 'zod';

export const SlidePlanEntrySchema = z.object({
  pageType: z.string(),
  content: z.unknown(),
});

export const SlideIRSchema = z.object({
  deckId: z.string(),
  themeId: z.string(),
  slides: z.array(SlidePlanEntrySchema),
});

export type SlidePlanEntry = z.infer<typeof SlidePlanEntrySchema>;

export type SlideIR = z.infer<typeof SlideIRSchema>;
