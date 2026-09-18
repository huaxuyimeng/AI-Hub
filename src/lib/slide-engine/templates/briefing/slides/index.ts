/**
 * 早报页型集合
 * 注册全部 10 个页型到引擎注册表
 */

import { registerPageType, clearPageTypes, hasPageType } from '../../../registry/registry';
import { coverPageType } from './cover';
import { overviewPageType } from './overview';
import { directionIndexPageType } from './direction-index';
import { directionDetailPageType } from './direction-detail';
import { verificationPageType } from './verification';
import { trendsPageType } from './trends';
import { sourcesPageType } from './sources';
import { authorsPageType } from './authors';
import { rumorPageType } from './rumor';
import { disclaimerPageType } from './disclaimer';

export {
  coverPageType,
  overviewPageType,
  directionIndexPageType,
  directionDetailPageType,
  verificationPageType,
  trendsPageType,
  sourcesPageType,
  authorsPageType,
  rumorPageType,
  disclaimerPageType,
};

export const BRIEFING_PAGE_TYPES = [
  coverPageType,
  overviewPageType,
  directionIndexPageType,
  directionDetailPageType,
  verificationPageType,
  trendsPageType,
  sourcesPageType,
  authorsPageType,
  rumorPageType,
  disclaimerPageType,
];

/**
 * 一键注册所有早报页型（**幂等**）
 *
 * 为什么必须幂等：注册表是模块级单例，而低层 `registerPageType` 对重复注册会抛错。
 * 这在常驻进程里是个雷 —— 同一个 Next 进程里第二次渲染 PPT / 第二次跑版面 QA 就会抛，
 * 表现成「第一次正常，之后每次版面校验静默失败」（`runLayoutQA` 的注册在 try 内，
 * 异常被吞掉只留一条日志）。调用方遍布 route / render-pptx / qa-gate / 预览组件，
 * 与其在每处加守卫，不如让这个入口本身可重复调用。
 */
export function registerBriefingPageTypes(): void {
  for (const def of BRIEFING_PAGE_TYPES) {
    if (!hasPageType(def.key)) registerPageType(def);
  }
}

/**
 * 清空注册表并重新注册（用于测试隔离）
 */
export function resetBriefingPageTypes(): void {
  clearPageTypes();
  registerBriefingPageTypes();
}
