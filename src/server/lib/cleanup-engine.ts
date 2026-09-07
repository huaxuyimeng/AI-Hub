// 磁盘清理引擎：盘符检测 / 白名单扫描 / 渐进式清理任务 / 中断恢复 / 报告生成
//
// 设计要点：
//   - 只删预定义白名单路径的内容，前端只传 item id（杜绝任意路径注入）
//   - 任务状态存 globalThis（dev 热重载存活）+ session 文件（进程重启后可恢复）
//   - 每完成一项就原子更新 session 文件，中断后 resume 只清剩余项
//   - 报告落盘 ~/.aihub-cleanup/reports/，含"还能再清理多少"与建议

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { logger } from '@/lib/observability/logger';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface DriveInfo {
  letter: string;
  totalBytes: number;
  freeBytes: number;
  label: string; // 系统盘 / 数据盘
}

export type TargetKind = 'dir' | 'recycleBin' | 'emptyFolders' | 'emptyFiles';

export interface TargetItem {
  id: string;
  drive: string;
  tier: 'safe' | 'deep';
  label: string;
  software: string;
  desc: string;
  path: string | null; // recycleBin / emptyFolders / emptyFiles 为 null
  kind: TargetKind;
  advice: 'clean' | 'optional' | 'caution';
  exists: boolean;
  sizeBytes: number | null; // null = 未扫描
}

export interface ItemResult {
  id: string;
  label: string;
  software: string;
  path: string | null;
  freedBytes: number;
  failedCount: number;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
}

export interface TaskProgress {
  id: string;
  kind: 'scan' | 'clean';
  drive: string;
  status: 'running' | 'done' | 'error';
  phase: string;
  totalItems: number;
  completedItems: number;
  progress: number; // 0-100
  freedBytes: number;
  scannedBytes: number;
  failedCount: number;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  reportId: string | null; // 清理完成后指向生成的报告
  results: ItemResult[];
  targets: TargetItem[]; // scan 渐进填充；clean 为选中项快照
}

export interface CleanupReport {
  id: string;
  mode: 'safe' | 'deep';
  drive: string;
  startedAt: string;
  endedAt: string;
  items: ItemResult[];
  totalFreed: number;
  failedCount: number;
  remaining: { label: string; software: string; sizeBytes: number; advice: string }[];
  remainingTotal: number;
  recommendations: string[];
}

export interface SessionInfo {
  taskId: string;
  drive: string;
  mode: 'safe' | 'deep';
  startedAt: string;
  freedBytes: number;
  completedCount: number;
  pendingCount: number;
  pendingLabels: string[];
}

// ---------------------------------------------------------------------------
// 常量与路径
// ---------------------------------------------------------------------------

const USER = os.homedir();
const LOCAL = path.join(USER, 'AppData', 'Local');
const ROAMING = path.join(USER, 'AppData', 'Roaming');
const DATA_DIR = path.join(USER, '.aihub-cleanup');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');

/** 用户目录下允许做空文件夹 / 空文件清理的白名单根 */
const EMPTY_SCAN_ROOTS = [
  'Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music', 'source', 'data', 'logs',
];

// ---------------------------------------------------------------------------
// 任务注册表（globalThis：dev 热重载后仍存活）
// ---------------------------------------------------------------------------

interface InternalTask {
  progress: TaskProgress;
}

const g = globalThis as unknown as { __aihubCleanupTask?: InternalTask };

function currentTask(): InternalTask | null {
  return g.__aihubCleanupTask ?? null;
}

function setTask(t: InternalTask | null) {
  g.__aihubCleanupTask = t ?? undefined;
}

export function getTaskProgress(): TaskProgress | null {
  const t = currentTask();
  return t ? { ...t.progress, results: [...t.progress.results], targets: [...t.progress.targets] } : null;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    // 设计意图：仅作路径探测，ENOENT 等"路径不存在"视为 false，其他错误也视同不可访问
    return false;
  }
}

/** 递归计算目录大小（跳过无权限项与符号链接） */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.debug('[cleanup-engine] dirSize: readdir failed', { dir, error: String(err) });
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += await dirSize(p);
      else if (e.isFile()) {
        const st = await fsp.stat(p);
        total += st.size;
      }
    } catch (err) {
      // 无权限 / 文件占用等：累计跳过但记录，便于调试
      logger.debug('[cleanup-engine] dirSize: entry stat failed', { path: p, error: String(err) });
    }
  }
  return total;
}

interface ClearOutcome {
  freed: number;
  failed: number;
}

/** 清空目录内容（保留目录本身），逐项容错 */
async function clearDirContents(dir: string): Promise<ClearOutcome> {
  const freed = await dirSize(dir);
  let failed = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.warn('[cleanup-engine] clearDirContents: readdir failed', { dir, error: String(err) });
    return { freed: 0, failed: 1 };
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      await fsp.rm(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
    } catch (err) {
      logger.warn('[cleanup-engine] clearDirContents: rm failed', { path: p, error: String(err) });
      failed++;
    }
  }
  return { freed, failed };
}

function runPowerShell(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ...args],
      { timeout: 60_000, windowsHide: true },
      () => resolve() // 清空回收站失败不阻塞任务
    );
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function reportId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `r-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 原子写 JSON：先写 tmp 再 rename */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = file + '.tmp';
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf-8');
  await fsp.rename(tmp, file);
}

// ---------------------------------------------------------------------------
// 盘符检测
// ---------------------------------------------------------------------------

export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') return [];
  const drives: DriveInfo[] = [];
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      const st = await fsp.statfs(root);
      const total = Number(st.blocks) * Number(st.bsize);
      if (total <= 0) continue; // 空光驱等
      drives.push({
        letter,
        totalBytes: total,
        freeBytes: Number(st.bavail) * Number(st.bsize),
        label: letter === 'C' ? '系统盘' : '数据盘',
      });
    } catch {
      // 设计意图：扫描盘符 A-Z，无光驱/未挂载盘 statfs 失败是正常情况，跳过即可
    }
  }
  return drives;
}

// ---------------------------------------------------------------------------
// 白名单清单
// ---------------------------------------------------------------------------

interface TargetDef {
  id: string;
  tier: 'safe' | 'deep';
  label: string;
  software: string;
  desc: string;
  kind: TargetKind;
  advice: 'clean' | 'optional' | 'caution';
  path: () => string | null; // null 表示该项不存在（不生成）
}

const C_TARGET_DEFS: TargetDef[] = [
  // ---- 安全清理（缓存 / 日志，可自动重建）----
  { id: 'c-npm-cache', tier: 'safe', label: 'npm 包缓存', software: 'npm', desc: '下载缓存，删除后自动重建', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'npm-cache') },
  { id: 'c-codex-runtimes', tier: 'safe', label: 'Codex 运行时缓存', software: 'OpenAI Codex', desc: '运行时二进制缓存，可重新下载', kind: 'dir', advice: 'clean', path: () => path.join(USER, '.cache', 'codex-runtimes') },
  { id: 'c-pnpm-cache', tier: 'safe', label: 'pnpm 下载缓存', software: 'pnpm', desc: '下载缓存，删除后自动重建', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'pnpm-cache') },
  { id: 'c-pip-cache', tier: 'safe', label: 'pip 缓存', software: 'Python pip', desc: '下载缓存，删除后自动重建', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'pip', 'cache') },
  { id: 'c-go-build', tier: 'safe', label: 'Go 构建缓存', software: 'Go', desc: '编译缓存，删除后自动重建', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'go-build') },
  { id: 'c-node-gyp', tier: 'safe', label: 'node-gyp 头文件缓存', software: 'node-gyp', desc: '编译头文件缓存，可重新下载', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'node-gyp') },
  { id: 'c-unity-cache', tier: 'safe', label: 'Unity Hub 包缓存', software: 'Unity', desc: '包下载缓存，可重新下载', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'Unity', 'cache') },
  { id: 'c-unity-caches', tier: 'safe', label: 'Unity 缓存', software: 'Unity', desc: '资产缓存，可自动重建', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'Unity', 'Caches') },
  { id: 'c-temp', tier: 'safe', label: '用户临时文件夹', software: 'Windows', desc: '临时文件，被占用的会自动跳过', kind: 'dir', advice: 'clean', path: () => path.join(LOCAL, 'Temp') },
  { id: 'c-trae-cache', tier: 'safe', label: 'Trae 缓存', software: 'Trae', desc: '缓存，可自动重建', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'Trae CN', 'Cache') },
  { id: 'c-trae-cachedata', tier: 'safe', label: 'Trae 代码缓存', software: 'Trae', desc: '编译缓存，可自动重建', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'Trae CN', 'CachedData') },
  { id: 'c-trae-vsix', tier: 'safe', label: 'Trae 扩展安装包缓存', software: 'Trae', desc: '已装扩展的安装包缓存', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'Trae CN', 'CachedExtensionVSIXs') },
  { id: 'c-trae-logs', tier: 'safe', label: 'Trae 日志', software: 'Trae', desc: '运行日志，删除无影响', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'Trae CN', 'logs') },
  { id: 'c-solo-cache', tier: 'safe', label: 'TRAE SOLO 缓存', software: 'TRAE SOLO', desc: '缓存，可自动重建', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'TRAE SOLO CN', 'Cache') },
  { id: 'c-solo-cachedata', tier: 'safe', label: 'TRAE SOLO 代码缓存', software: 'TRAE SOLO', desc: '编译缓存，可自动重建', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'TRAE SOLO CN', 'CachedData') },
  { id: 'c-solo-logs', tier: 'safe', label: 'TRAE SOLO 日志', software: 'TRAE SOLO', desc: '运行日志，删除无影响', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'TRAE SOLO CN', 'logs') },
  { id: 'c-cursor-logs', tier: 'safe', label: 'Cursor 日志', software: 'Cursor', desc: '运行日志，删除无影响', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'Cursor', 'logs') },
  { id: 'c-workbuddy-logs', tier: 'safe', label: 'WorkBuddy 日志', software: 'WorkBuddy', desc: '运行日志，删除无影响', kind: 'dir', advice: 'clean', path: () => path.join(USER, '.workbuddy', 'logs') },
  { id: 'c-workbuddy-traces', tier: 'safe', label: 'WorkBuddy 追踪数据', software: 'WorkBuddy', desc: '性能追踪数据，删除无影响', kind: 'dir', advice: 'clean', path: () => path.join(USER, '.workbuddy', 'traces') },
  { id: 'c-trae-screenshots', tier: 'safe', label: 'Trae 浏览器截图缓存', software: 'Trae', desc: '自动化截图缓存，删除无影响', kind: 'dir', advice: 'clean', path: () => path.join(USER, '.trae-cn', 'trae-browser-screenshots') },
  { id: 'c-lark-shader', tier: 'safe', label: '飞书着色器缓存', software: '飞书', desc: '着色器缓存，可自动重建', kind: 'dir', advice: 'clean', path: () => path.join(ROAMING, 'LarkShell', 'GrShaderCache') },
  { id: 'c-recycle-bin', tier: 'safe', label: '回收站', software: 'Windows', desc: '清空本盘回收站，删除后不可恢复', kind: 'recycleBin', advice: 'clean', path: () => 'C' },

  // ---- 深度清理（需确认）----
  { id: 'c-pnpm-store', tier: 'deep', label: 'pnpm 包存储库', software: 'pnpm', desc: '已装项目不受影响，新装包会重新下载', kind: 'dir', advice: 'optional', path: () => path.join(LOCAL, 'pnpm', 'store') },
  { id: 'c-playwright', tier: 'deep', label: 'Playwright 测试浏览器', software: 'Playwright', desc: '删除后 npx playwright install 可恢复', kind: 'dir', advice: 'optional', path: () => path.join(LOCAL, 'ms-playwright') },
  { id: 'c-marscode-ckg', tier: 'deep', label: 'MarsCode 索引缓存', software: 'MarsCode', desc: '代码索引，删除后会自动重建', kind: 'dir', advice: 'optional', path: () => path.join(USER, '.marscode', '.ckg') },
  { id: 'c-marscode-aichat', tier: 'deep', label: 'MarsCode 对话缓存', software: 'MarsCode', desc: '对话缓存数据', kind: 'dir', advice: 'optional', path: () => path.join(USER, '.marscode', 'ai-chat') },
  { id: 'c-codex-tmp', tier: 'deep', label: 'Codex 临时文件', software: 'OpenAI Codex', desc: '临时文件，不动对话记录', kind: 'dir', advice: 'optional', path: () => path.join(USER, '.codex', '.tmp') },
  { id: 'c-codex-plugins', tier: 'deep', label: 'Codex 插件缓存', software: 'OpenAI Codex', desc: '插件运行时，可重新下载', kind: 'dir', advice: 'optional', path: () => path.join(USER, '.codex', 'plugins') },
  { id: 'c-codex-local', tier: 'deep', label: 'Codex 本地运行时', software: 'OpenAI Codex', desc: '本地运行时二进制，可重新下载', kind: 'dir', advice: 'optional', path: () => path.join(LOCAL, 'OpenAI', 'Codex') },
  { id: 'c-empty-folders', tier: 'deep', label: '空文件夹', software: '用户目录', desc: 'Desktop/Documents 等目录下的空文件夹（不含 .git / node_modules 内部）', kind: 'emptyFolders', advice: 'optional', path: () => 'roots' },
  { id: 'c-empty-files', tier: 'deep', label: '空白文档', software: '用户目录', desc: '0 字节空文件（不含 .gitkeep / .gitignore）', kind: 'emptyFiles', advice: 'optional', path: () => 'roots' },
];

/** 生成某盘的清理项清单（含 JetBrains 动态项） */
export async function buildTargets(drive: string): Promise<TargetItem[]> {
  const items: TargetItem[] = [];
  if (drive === 'C') {
    for (const def of C_TARGET_DEFS) {
      if (def.kind === 'recycleBin') {
        items.push(toItem(def, drive, true));
        continue;
      }
      if (def.kind === 'emptyFolders' || def.kind === 'emptyFiles') {
        const hasRoot = (await Promise.all(EMPTY_SCAN_ROOTS.map((r) => pathExists(path.join(USER, r))))).some(Boolean);
        items.push(toItem(def, drive, hasRoot));
        continue;
      }
      const p = def.path();
      if (p && (await pathExists(p))) {
        items.push(toItem(def, drive, true, p));
      }
    }
    // JetBrains 各版本（动态）
    const jbDir = path.join(LOCAL, 'JetBrains');
    if (await pathExists(jbDir)) {
      let versions: fs.Dirent[] = [];
      try {
        versions = await fsp.readdir(jbDir, { withFileTypes: true });
      } catch (err) {
        logger.warn('[cleanup-engine] buildTargets: JetBrains readdir failed', { jbDir, error: String(err) });
        versions = [];
      }
      for (const v of versions) {
        if (!v.isDirectory()) continue;
        items.push({
          id: `c-jb-${v.name}`,
          drive: 'C',
          tier: 'deep',
          label: `JetBrains 缓存（${v.name}）`,
          software: 'IntelliJ / PyCharm',
          desc: '索引与日志缓存，删除后打开项目会重建索引',
          path: path.join(jbDir, v.name),
          kind: 'dir',
          advice: 'caution',
          exists: true,
          sizeBytes: null,
        });
      }
    }
  } else {
    // 非 C 盘通用项
    items.push({
      id: `${drive.toLowerCase()}-recycle-bin`,
      drive,
      tier: 'safe',
      label: '回收站',
      software: 'Windows',
      desc: '清空本盘回收站，删除后不可恢复',
      path: null,
      kind: 'recycleBin',
      advice: 'clean',
      exists: true,
      sizeBytes: null,
    });
    for (const t of ['Temp', 'tmp']) {
      const p = path.join(`${drive}:\\`, t);
      if (await pathExists(p)) {
        items.push({
          id: `${drive.toLowerCase()}-${t.toLowerCase()}`,
          drive,
          tier: 'safe',
          label: `临时文件夹（${t}）`,
          software: '通用',
          desc: '盘根目录下的临时文件夹',
          path: p,
          kind: 'dir',
          advice: 'optional',
          exists: true,
          sizeBytes: null,
        });
      }
    }
  }
  return items;
}

function toItem(def: TargetDef, drive: string, exists: boolean, p?: string): TargetItem {
  return {
    id: def.id,
    drive,
    tier: def.tier,
    label: def.label,
    software: def.software,
    desc: def.desc,
    path: def.kind === 'dir' ? (p ?? null) : null,
    kind: def.kind,
    advice: def.advice,
    exists,
    sizeBytes: null,
  };
}

// ---------------------------------------------------------------------------
// 扫描任务
// ---------------------------------------------------------------------------

export async function startScan(drive: string): Promise<TaskProgress> {
  const existing = currentTask();
  if (existing && existing.progress.status === 'running') {
    throw new Error('已有任务在运行，请等待完成');
  }
  const targets = await buildTargets(drive);
  const task: InternalTask = {
    progress: {
      id: `scan-${Date.now()}`,
      kind: 'scan',
      drive,
      status: 'running',
      phase: '准备扫描…',
      totalItems: targets.length,
      completedItems: 0,
      progress: 0,
      freedBytes: 0,
      scannedBytes: 0,
      failedCount: 0,
      startedAt: nowIso(),
      endedAt: null,
      error: null,
      reportId: null,
      results: [],
      targets: targets.map((t) => ({ ...t })),
    },
  };
  setTask(task);
  void runScan(task);
  return snapshot(task);
}

async function runScan(task: InternalTask) {
  const { progress } = task;
  try {
    for (let i = 0; i < progress.targets.length; i++) {
      const t = progress.targets[i];
      progress.phase = `正在扫描：${t.label}`;
      if (t.kind === 'recycleBin') {
        // 回收站大小不好精确统计，跳过大小
        t.sizeBytes = null;
      } else if (t.kind === 'emptyFolders' || t.kind === 'emptyFiles') {
        const list = t.kind === 'emptyFolders' ? await findEmptyFolders() : await findEmptyFiles();
        t.sizeBytes = list.length; // 特殊项：数量即"大小"展示
      } else if (t.path) {
        t.sizeBytes = await dirSize(t.path);
        progress.scannedBytes += t.sizeBytes;
      }
      progress.completedItems = i + 1;
      progress.progress = Math.round((progress.completedItems / progress.totalItems) * 100);
    }
    progress.phase = '扫描完成';
    progress.status = 'done';
    progress.endedAt = nowIso();
  } catch (err) {
    progress.status = 'error';
    progress.error = err instanceof Error ? err.message : String(err);
    progress.endedAt = nowIso();
  }
}

// ---------------------------------------------------------------------------
// 空文件夹 / 空文件发现
// ---------------------------------------------------------------------------

async function emptyRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const r of EMPTY_SCAN_ROOTS) {
    const p = path.join(USER, r);
    if (await pathExists(p)) roots.push(p);
  }
  return roots;
}

async function findEmptyFolders(): Promise<string[]> {
  const result: string[] = [];
  const roots = await emptyRoots();
  const walk = async (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.debug('[cleanup-engine] findEmptyFolders: readdir skipped', { dir, error: String(err) });
      return;
    }
    if (entries.length === 0) {
      result.push(dir);
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) await walk(r, 0);
  return result;
}

async function findEmptyFiles(): Promise<string[]> {
  const result: string[] = [];
  const roots = await emptyRoots();
  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.debug('[cleanup-engine] findEmptyFiles: readdir skipped', { dir, error: String(err) });
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        await walk(p, depth + 1);
      } else if (e.isFile()) {
        if (e.name === '.gitkeep' || e.name === '.gitignore') continue;
        try {
          const st = await fsp.stat(p);
          if (st.size === 0) result.push(p);
        } catch (err) {
          logger.debug('[cleanup-engine] findEmptyFiles: stat skipped', { path: p, error: String(err) });
        }
      }
    }
  };
  for (const r of roots) await walk(r, 0);
  return result;
}

// ---------------------------------------------------------------------------
// 清理任务（含会话持久化）
// ---------------------------------------------------------------------------

interface SessionFile {
  version: 1;
  taskId: string;
  drive: string;
  mode: 'safe' | 'deep';
  startedAt: string;
  freedBytes: number;
  completed: ItemResult[];
  pending: TargetItem[];
}

async function readSession(): Promise<SessionFile | null> {
  try {
    const raw = await fsp.readFile(SESSION_FILE, 'utf-8');
    return JSON.parse(raw) as SessionFile;
  } catch {
    // 设计意图：session 文件不存在/损坏 = 无可恢复任务，正常情况返回 null
    return null;
  }
}

async function writeSession(s: SessionFile): Promise<void> {
  await writeJsonAtomic(SESSION_FILE, s);
}

async function removeSession(): Promise<void> {
  try {
    await fsp.rm(SESSION_FILE, { force: true });
  } catch {
    // 设计意图：force=true 已让 ENOENT 不抛错；其他错误也不影响"任务已完成"的事实
  }
}

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const s = await readSession();
  if (!s || s.pending.length === 0) return null;
  return {
    taskId: s.taskId,
    drive: s.drive,
    mode: s.mode,
    startedAt: s.startedAt,
    freedBytes: s.freedBytes,
    completedCount: s.completed.length,
    pendingCount: s.pending.length,
    pendingLabels: s.pending.slice(0, 6).map((p) => p.label),
  };
}

/** 启动清理：入参只能是白名单 id */
export async function startClean(itemIds: string[]): Promise<TaskProgress> {
  const existing = currentTask();
  if (existing && existing.progress.status === 'running') {
    throw new Error('已有任务在运行，请等待完成');
  }
  const drive = itemIds.some((id) => id.startsWith('c-')) ? 'C' : itemIds[0]?.split('-')[0]?.toUpperCase() ?? 'C';
  const all = await buildTargets(drive);
  const selected = all.filter((t) => itemIds.includes(t.id) && t.exists);
  if (selected.length === 0) throw new Error('没有可清理的项目');
  const mode: 'safe' | 'deep' = selected.some((t) => t.tier === 'deep') ? 'deep' : 'safe';

  const taskId = `clean-${Date.now()}`;
  const task: InternalTask = {
    progress: {
      id: taskId,
      kind: 'clean',
      drive,
      status: 'running',
      phase: '准备清理…',
      totalItems: selected.length,
      completedItems: 0,
      progress: 0,
      freedBytes: 0,
      scannedBytes: 0,
      failedCount: 0,
      startedAt: nowIso(),
      endedAt: null,
      error: null,
      reportId: null,
      results: [],
      targets: selected.map((t) => ({ ...t })),
    },
  };
  setTask(task);

  await writeSession({
    version: 1,
    taskId,
    drive,
    mode,
    startedAt: nowIso(),
    freedBytes: 0,
    completed: [],
    pending: selected,
  });
  void runClean(task, mode);
  return snapshot(task);
}

/** 恢复中断的清理会话（服务重启 / 进程退出后） */
export async function resumeSession(): Promise<TaskProgress> {
  const existing = currentTask();
  if (existing && existing.progress.status === 'running') {
    return snapshot(existing);
  }
  const s = await readSession();
  if (!s || s.pending.length === 0) throw new Error('没有可恢复的清理任务');

  const task: InternalTask = {
    progress: {
      id: `clean-resume-${Date.now()}`,
      kind: 'clean',
      drive: s.drive,
      status: 'running',
      phase: '恢复中断的清理任务…',
      totalItems: s.completed.length + s.pending.length,
      completedItems: s.completed.length,
      progress: Math.round((s.completed.length / (s.completed.length + s.pending.length)) * 100),
      freedBytes: s.freedBytes,
      scannedBytes: 0,
      failedCount: 0,
      startedAt: nowIso(),
      endedAt: null,
      error: null,
      reportId: null,
      results: [...s.completed],
      targets: [...s.pending],
    },
  };
  setTask(task);
  void runClean(task, s.mode);
  return snapshot(task);
}

export async function discardSession(): Promise<void> {
  await removeSession();
}

async function runClean(task: InternalTask, mode: 'safe' | 'deep') {
  const { progress } = task;
  try {
    while (progress.targets.length > 0) {
      const t = progress.targets[0];
      progress.phase = `正在清理：${t.label}`;
      const result = await executeTarget(t);
      progress.results.push(result);
      progress.freedBytes += result.freedBytes;
      progress.failedCount += result.failedCount;
      progress.completedItems += 1;
      progress.progress = Math.round((progress.completedItems / progress.totalItems) * 100);

      // 每完成一项：更新 session 文件（剩余队列 = targets[1..]）
      const s = await readSession();
      const base = s ?? {
        version: 1 as const,
        taskId: progress.id,
        drive: progress.drive,
        mode,
        startedAt: progress.startedAt,
        freedBytes: 0,
        completed: [],
        pending: [],
      };
      await writeSession({
        ...base,
        taskId: progress.id,
        drive: progress.drive,
        mode,
        freedBytes: progress.freedBytes,
        completed: [...progress.results],
        pending: progress.targets.slice(1),
      });
      progress.targets = progress.targets.slice(1);
    }

    progress.phase = '正在生成报告…';
    const report = await buildReport(progress, mode);
    progress.phase = '清理完成';
    progress.status = 'done';
    progress.endedAt = nowIso();
    progress.reportId = report.id;
    await removeSession();
  } catch (err) {
    progress.status = 'error';
    progress.error = err instanceof Error ? err.message : String(err);
    progress.endedAt = nowIso();
    // 报错时保留 session，剩余项仍可恢复
  }
}

async function executeTarget(t: TargetItem): Promise<ItemResult> {
  const base: ItemResult = {
    id: t.id,
    label: t.label,
    software: t.software,
    path: t.path,
    freedBytes: 0,
    failedCount: 0,
    status: 'ok',
  };
  try {
    if (t.kind === 'recycleBin') {
      await runPowerShell(['Clear-RecycleBin', '-DriveLetter', t.drive, '-Force', '-ErrorAction', 'SilentlyContinue']);
      // 无法精确统计回收站释放量，用清空前盘剩余空间估算
      const before = await driveFreeBytes(t.drive);
      const st = await fsp.statfs(`${t.drive}:\\`);
      const freed = Math.max(0, Number(st.bavail) * Number(st.bsize) - before);
      return { ...base, freedBytes: Math.min(freed, 50 * 1024 ** 3), status: 'ok' };
    }
    if (t.kind === 'emptyFolders') {
      const folders = await findEmptyFolders();
      let n = 0;
      // 两轮：父目录删空后可能又变空
      for (let round = 0; round < 2; round++) {
        const list = round === 0 ? folders : await findEmptyFolders();
        for (const f of list) {
          try {
            await fsp.rmdir(f);
            n++;
          } catch (err) {
            // 非空或被占用：单条失败无需每条 warn，仅 debug 便于排查
            logger.debug('[cleanup-engine] executeTarget: rmdir skipped', { path: f, error: String(err) });
          }
        }
      }
      return { ...base, freedBytes: 0, status: n > 0 ? 'ok' : 'skipped', failedCount: 0 };
    }
    if (t.kind === 'emptyFiles') {
      const files = await findEmptyFiles();
      let failed = 0;
      for (const f of files) {
        try {
          await fsp.unlink(f);
        } catch (err) {
          logger.warn('[cleanup-engine] executeTarget: unlink failed', { path: f, error: String(err) });
          failed++;
        }
      }
      return { ...base, freedBytes: 0, status: files.length - failed > 0 ? 'ok' : 'skipped', failedCount: failed };
    }
    if (t.path) {
      const outcome = await clearDirContents(t.path);
      return {
        ...base,
        freedBytes: outcome.freed,
        failedCount: outcome.failed,
        status: outcome.failed === 0 ? 'ok' : outcome.freed > 0 ? 'partial' : 'failed',
      };
    }
    return { ...base, status: 'skipped' };
  } catch (err) {
    // 外层兜底：整个 target 整体失败（unexpected error），必须记录否则 size 统计完全失真
    logger.error('[cleanup-engine] executeTarget: unexpected failure', {
      targetId: t.id,
      label: t.label,
      kind: t.kind,
      path: t.path,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...base, status: 'failed', failedCount: 1 };
  }
}

async function driveFreeBytes(drive: string): Promise<number> {
  try {
    const st = await fsp.statfs(`${drive}:\\`);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    // 设计意图：盘符离线/权限不足时返回 0 作为"无法估算"信号，调用方会处理
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

async function buildReport(progress: TaskProgress, mode: 'safe' | 'deep'): Promise<CleanupReport> {
  const remaining: CleanupReport['remaining'] = [];
  // 用白名单全清单 - 本次已清项，得出"还能再清理什么"
  const all = await buildTargets(progress.drive);
  const cleanedIds = new Set(progress.results.map((r) => r.id));
  for (const t of all) {
    if (cleanedIds.has(t.id) || !t.exists) continue;
    let size = t.sizeBytes;
    if (size === null || size === undefined) {
      if (t.kind === 'dir' && t.path) size = await dirSize(t.path);
      else if (t.kind === 'emptyFolders') size = (await findEmptyFolders()).length;
      else if (t.kind === 'emptyFiles') size = (await findEmptyFiles()).length;
      else size = 0;
    }
    if (size <= 0) continue;
    remaining.push({
      label: t.label,
      software: t.software,
      sizeBytes: size,
      advice:
        t.advice === 'clean'
          ? '建议清理'
          : t.advice === 'optional'
            ? '可选：不影响已装软件，按需清理'
            : '谨慎：删除后需重建索引或重新下载',
    });
  }
  remaining.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const recommendations: string[] = [];
  for (const r of remaining.slice(0, 5)) {
    const gb = (r.sizeBytes / 1024 ** 3).toFixed(2);
    recommendations.push(`${r.label}（${r.software}，约 ${gb} GB）— ${r.advice}`);
  }
  if (remaining.length === 0) recommendations.push('当前没有可清理的项目，系统很干净。');

  const report: CleanupReport = {
    id: reportId(),
    mode,
    drive: progress.drive,
    startedAt: progress.startedAt,
    endedAt: nowIso(),
    items: [...progress.results],
    totalFreed: progress.freedBytes,
    failedCount: progress.failedCount,
    remaining,
    remainingTotal: remaining.reduce((s, r) => s + r.sizeBytes, 0),
    recommendations,
  };
  await writeJsonAtomic(path.join(REPORTS_DIR, `${report.id}.json`), report);
  return report;
}

export interface ReportMeta {
  id: string;
  mode: string;
  drive: string;
  endedAt: string;
  totalFreed: number;
  itemCount: number;
}

export async function listReports(): Promise<ReportMeta[]> {
  try {
    const files = await fsp.readdir(REPORTS_DIR);
    const metas: ReportMeta[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fsp.readFile(path.join(REPORTS_DIR, f), 'utf-8');
        const r = JSON.parse(raw) as CleanupReport;
        metas.push({
          id: r.id,
          mode: r.mode,
          drive: r.drive,
          endedAt: r.endedAt,
          totalFreed: r.totalFreed,
          itemCount: r.items.length,
        });
      } catch {
        // 设计意图：单份报告损坏不影响列表，跳过该份即可
      }
    }
    return metas.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  } catch {
    // 设计意图：报告目录不存在/不可读时返回空列表，不阻塞调用方
    return [];
  }
}

export async function getReport(id: string): Promise<CleanupReport | null> {
  // id 只允许白名单字符，防路径穿越
  if (!/^r-\d{8}-\d{6}$/.test(id)) return null;
  try {
    const raw = await fsp.readFile(path.join(REPORTS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(raw) as CleanupReport;
  } catch {
    // 设计意图：报告 id 合法但文件不存在/损坏 → 返回 null 给前端展示"报告丢失"
    return null;
  }
}

// ---------------------------------------------------------------------------
// snapshot（给轮询接口的深拷贝）
// ---------------------------------------------------------------------------

function snapshot(task: InternalTask): TaskProgress {
  return {
    ...task.progress,
    results: task.progress.results.map((r) => ({ ...r })),
    targets: task.progress.targets.map((t) => ({ ...t })),
  };
}
