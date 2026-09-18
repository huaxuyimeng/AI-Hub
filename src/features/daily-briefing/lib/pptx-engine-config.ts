/**
 * PPTX 渲染引擎开关
 * 路径：src/features/daily-briefing/lib/pptx-engine-config.ts
 *
 * 背景：项目里有两套 PPT 生成实现，需要在不打断线上产出的前提下完成切换。
 *   - legacy：build-pptx.ts（1410 行，pptxgenjs 直接调用，装不下就硬砍文字）
 *   - engine：slide-engine 管线（plan → lint → render，lint 有 error 则拒绝产出）
 *
 * 三档模式（由环境变量 BRIEFING_PPTX_ENGINE 控制）：
 *   legacy  仅旧引擎。回退档：新引擎出问题时用 BRIEFING_PPTX_ENGINE=legacy 一键回滚。
 *   shadow  旧引擎产出（用户拿到的仍是旧产物），同时用新引擎跑一遍并记录差异。
 *   engine  仅新引擎（**当前默认**）。新引擎失败时按 ALLOW_LEGACY_FALLBACK 决定是否回落旧引擎。
 *
 * 2026-09-16 切流：默认值由 legacy 改为 engine。
 * 依据：新引擎在真实 09-16 内容与 17 页 fixture 上 lint 均 0 error / 0 warn，
 *      且已补齐免责声明页、字号收敛到 9 级栅格、页数随当天条数变化。
 *
 * 环境变量：
 *   BRIEFING_PPTX_ENGINE       legacy | shadow | engine   默认 engine
 *   BRIEFING_LEGACY_FALLBACK   1 | 0                       默认 1（engine 模式下允许回落）
 */

export type PptxEngineMode = 'legacy' | 'shadow' | 'engine';

const VALID_MODES: readonly PptxEngineMode[] = ['legacy', 'shadow', 'engine'];

/** 默认引擎。改这里即可整体切换/回滚。 */
const DEFAULT_MODE: PptxEngineMode = 'engine';

function readMode(): PptxEngineMode {
  const raw = (process.env.BRIEFING_PPTX_ENGINE ?? '').trim().toLowerCase();
  if ((VALID_MODES as readonly string[]).includes(raw)) {
    return raw as PptxEngineMode;
  }
  return DEFAULT_MODE;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * 读取配置。每次调用都重新读 env —— 便于测试里改 env 后立刻生效，
 * 也便于同一个进程内在不同请求上做灰度。
 */
export function getEngineConfig(): {
  mode: PptxEngineMode;
  allowLegacyFallback: boolean;
  /** 是否需要跑新引擎（shadow 与 engine 都要） */
  runsEngine: boolean;
  /** 新引擎是否为唯一产出源 */
  engineIsAuthoritative: boolean;
} {
  const mode = readMode();
  return {
    mode,
    allowLegacyFallback: readBool('BRIEFING_LEGACY_FALLBACK', true),
    runsEngine: mode === 'shadow' || mode === 'engine',
    engineIsAuthoritative: mode === 'engine',
  };
}

/** 供日志/前端展示的当前模式说明 */
export function describeMode(mode: PptxEngineMode): string {
  switch (mode) {
    case 'legacy':
      return '旧引擎（build-pptx）';
    case 'shadow':
      return '影子模式（旧引擎产出 + 新引擎比对）';
    case 'engine':
      return '新引擎（slide-engine）';
  }
}
