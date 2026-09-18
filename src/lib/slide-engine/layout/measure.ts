/**
 * 文本测量（M4 的前置）：宽度系数按 Microsoft YaHei（中文）与 Inter（数字）的字面口径估算
 * 目标误差 5% 以内；lint 阈值另留余量兜底
 */

import type { MeasureOpts } from '../contracts/page-type';

const COEFF = {
  cjk: 1.0,
  upper: 0.72,
  lower: 0.56,
  digit: 0.58,
  space: 0.28,
  punct: 0.4,
  other: 0.6,
};

const BOLD_MULT = 1.05;

function isCjk(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60)
  );
}

function isHalfwidthKana(code: number): boolean {
  return code >= 0xff61 && code <= 0xff9f;
}

function charCoeff(ch: string): number {
  const code = ch.codePointAt(0);
  if (code == null) return 0;
  if (isHalfwidthKana(code)) return 0.5;
  if (isCjk(code)) return COEFF.cjk;
  if (ch === ' ') return COEFF.space;
  if (ch >= '0' && ch <= '9') return COEFF.digit;
  if (ch >= 'A' && ch <= 'Z') return COEFF.upper;
  if (ch >= 'a' && ch <= 'z') return COEFF.lower;
  if (code >= 0x21 && code <= 0x7e) return COEFF.punct;
  return COEFF.other;
}

export function measureWidth(text: string, size: number, opts?: MeasureOpts): number {
  let w = 0;
  for (const ch of text) {
    w += charCoeff(ch) * size;
  }
  if (opts?.weight != null && opts.weight >= 600) {
    w *= BOLD_MULT;
  }
  return w;
}

type WrapItem = {
  /** 行首可丢弃的空格宽度 */
  lead: number;
  /** 词本身宽度 */
  word: number;
};

function tokenize(text: string, size: number): WrapItem[] {
  const items: WrapItem[] = [];
  let word = '';
  let wordW = 0;
  let lead = 0;
  let pendingSpace = 0;

  const flushWord = () => {
    if (wordW > 0) {
      items.push({ lead: pendingSpace, word: wordW });
      pendingSpace = 0;
      word = '';
      wordW = 0;
    }
  };

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      flushWord();
      pendingSpace += COEFF.space * size;
      continue;
    }
    if (isCjk(code) || isHalfwidthKana(code)) {
      flushWord();
      items.push({ lead: pendingSpace, word: charCoeff(ch) * size });
      pendingSpace = 0;
      continue;
    }
    word += ch;
    wordW += charCoeff(ch) * size;
  }
  flushWord();
  return items;
}

export function measureLines(text: string, size: number, boxWidthPt: number, opts?: MeasureOpts): number {
  if (!text || text.trim().length === 0) return 0;
  if (boxWidthPt <= 0) return Number.POSITIVE_INFINITY;

  const bold = opts?.weight != null && opts.weight >= 600;
  const items = tokenize(text, size).map((it) => ({
    lead: bold ? it.lead * BOLD_MULT : it.lead,
    word: bold ? it.word * BOLD_MULT : it.word,
  }));
  if (items.length === 0) return 0;

  let lines = 1;
  let cur = 0;
  for (const item of items) {
    const word = item.word;
    if (cur > 0) {
      if (cur + item.lead + word <= boxWidthPt) {
        cur += item.lead + word;
        continue;
      }
      lines += 1;
      cur = 0;
    }
    if (word > boxWidthPt) {
      const extra = Math.ceil(word / boxWidthPt) - 1;
      lines += extra;
      cur = word - extra * boxWidthPt;
    } else {
      cur = word;
    }
  }
  return lines;
}

/** 文本块高度（pt） */
export function measureTextHeight(lines: number, size: number, lineHeight: number): number {
  return lines * size * lineHeight;
}

/**
 * 把文本截到「在给定宽度内不超过 maxLines 行」，超出部分用省略号收尾。
 *
 * 为什么需要它：L2 的判据是「实测行数 > 盒上声明的 maxLines」。
 * 布局一旦按剩余空间动态调小 maxLines（多块争抢同一列时必然发生），
 * 就必须同步把文本截掉，否则声明值与内容互相打架 ——
 * 表现成「明明给这块留了位置，lint 却报它溢出」。
 *
 * 二分查找；measureLines 是纯估算函数，成本可忽略。
 */
export function clipToLines(
  text: string,
  size: number,
  boxWidthPt: number,
  maxLines: number,
  opts?: MeasureOpts,
): string {
  if (!text) return text;
  if (maxLines <= 0) return '';
  if (measureLines(text, size, boxWidthPt, opts) <= maxLines) return text;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureLines(`${text.slice(0, mid)}…`, size, boxWidthPt, opts) <= maxLines) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo <= 0 ? '…' : `${text.slice(0, lo)}…`;
}
