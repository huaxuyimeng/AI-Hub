'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconPlus,
  IconTrash,
  IconFolder,
  IconCode,
  IconMessageCircle,
  IconPlug,
  IconChevronDown,
  IconChevronRight,
  IconSettings,
  IconBolt,
  IconLink,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { BackButton } from '@/components/ui/back-button';

// 提示词模板分类
const TEMPLATE_CATEGORIES = [
  { value: 'code-review', label: '代码审查' },
  { value: 'testing', label: '测试生成' },
  { value: 'refactor', label: '重构优化' },
  { value: 'doc', label: '文档生成' },
  { value: 'security', label: '安全审计' },
  { value: 'general', label: '通用' },
];

// 自动化触发类型
const TRIGGER_TYPES = [
  { value: 'manual', label: '手动触发' },
  { value: 'schedule', label: '定时任务' },
  { value: 'file-change', label: '文件变更' },
  { value: 'analysis-complete', label: '分析完成后' },
];

// 专家角色
const EXPERT_ROLES = [
  { value: 'code-review', label: '代码审查', desc: '检查代码质量、可维护性、逻辑正确性', icon: IconCode },
  { value: 'security', label: '安全审计', desc: '发现安全漏洞、注入风险、敏感信息泄露', icon: IconSparkles },
  { value: 'bug-prediction', label: 'Bug 预判', desc: '预测潜在 bug、边界条件、异常处理', icon: IconTrash },
  { value: 'refactor', label: '重构优化', desc: '优化代码结构、减少重复、提升性能', icon: IconSettings },
];

export default function NewProjectPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');

  // 工作空间文件夹
  const [workspacePath, setWorkspacePath] = useState('');
  const [includePatterns, setIncludePatterns] = useState('');
  const [excludePatterns, setExcludePatterns] = useState('node_modules,.git,dist,build,.next,.cache,coverage');

  // 可折叠 sections
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // 创建中状态
  const [creating, setCreating] = useState(false);

  const create = trpc.project.create.useMutation({
    onSuccess: (p) => {
      utils.project.list.invalidate();
      router.push(`/projects/${p.id}`);
    },
    onError: (e) => {
      setError(e.message);
      setCreating(false);
    },
  });

  function autoSlug() {
    const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    setSlug(s);
  }

  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    create.mutate({
      name,
      slug,
      description: description || undefined,
      visibility,
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="mb-6 flex items-center gap-3">
        <BackButton href="/projects" title="返回项目列表" />
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">新建项目</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          创建后可上传文件、配置插件、绑定提示词和专家
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* 基础信息 */}
        <SectionCard title="基本信息" icon={<IconFolder size={14} />} defaultOpen>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">项目名称</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={autoSlug}
                maxLength={80}
                placeholder="例如：我的前端项目"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Slug <span className="text-xs text-muted-foreground">(URL 路径)</span>
              </label>
              <input
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="^[a-z0-9-]+$"
                placeholder="my-project"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="简要描述项目用途（选填）"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">可见性</label>
              <div className="flex gap-2">
                {(['PRIVATE', 'PUBLIC'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={
                      'rounded-md px-3 py-1.5 text-sm ' +
                      (visibility === v
                        ? 'bg-primary/10 text-primary'
                        : 'border text-muted-foreground hover:bg-accent')
                    }
                  >
                    {v === 'PRIVATE' ? '🔒 私有' : '🌍 公开'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 工作空间 */}
        <SectionCard
          title="工作空间"
          icon={<IconFolder size={14} />}
          description="关联本地代码目录，AI 将读取这些文件进行分析"
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">本地目录路径</label>
              <div className="flex gap-2">
                <input
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder="例如：D:\projects\my-app（留空后续可在详情页配置）"
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <label
                  title="选择文件夹"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  <IconFolder size={14} />
                  选择
                  <input
                    type="file"
                    // @ts-ignore - webkitdirectory is not in TS types
                    webkitdirectory=""
                    directory=""
                    className="hidden"
                    onChange={(e) => {
                      const dir = (e.target as HTMLInputElement).files?.[0]?.webkitRelativePath?.split('/')[0];
                      if (dir) setWorkspacePath(dir);
                    }}
                  />
                </label>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                支持 Windows / macOS / Linux 绝对路径
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">包含模式</label>
                <input
                  value={includePatterns}
                  onChange={(e) => setIncludePatterns(e.target.value)}
                  placeholder="留空 = 全部（选填）"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-0.5 text-[10px] text-muted-foreground">逗号分隔，如：src,lib,test</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">排除模式</label>
                <input
                  value={excludePatterns}
                  onChange={(e) => setExcludePatterns(e.target.value)}
                  placeholder="node_modules, .git"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-0.5 text-[10px] text-muted-foreground">逗号分隔，已预设常用排除</p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 插件选择 */}
        <SectionCard
          title="插件"
          icon={<IconPlug size={14} />}
          description="为此项目选择代码分析、对话增强等插件"
        >
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              可在项目详情页配置具体插件的作用域和参数
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: '代码质量分析', desc: '检测代码复杂度、重复、命名规范', available: false },
                { name: '安全扫描', desc: 'OWASP Top 10 漏洞检测', available: false },
                { name: '文档生成', desc: '自动生成 README / API 文档', available: false },
                { name: '测试生成', desc: '基于代码结构生成单元测试', available: false },
              ].map((plugin) => (
                <div
                  key={plugin.name}
                  className={
                    'flex items-start gap-2 rounded-md border p-2.5 ' +
                    (plugin.available ? 'cursor-pointer hover:border-primary/50' : 'opacity-50')
                  }
                >
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded border" />
                  <div>
                    <div className="text-xs font-medium">{plugin.name}</div>
                    <div className="text-[10px] text-muted-foreground">{plugin.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              ⚠️ 插件需先在「插件」页面安装后再关联到项目（后续支持）
            </p>
          </div>
        </SectionCard>

        {/* 提示词选定 */}
        <SectionCard
          title="提示词模板"
          icon={<IconMessageCircle size={14} />}
          description="为代码审查、文档生成等任务预设提示词"
        >
          <div className="space-y-3">
            {TEMPLATE_CATEGORIES.map((cat) => (
              <div key={cat.value} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{cat.label}</span>
                <select className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring">
                  <option value="">不使用</option>
                  <option value="builtin-default">系统默认</option>
                </select>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* 自动化任务 */}
        <SectionCard
          title="自动化任务"
          icon={<IconBolt size={14} />}
          description="配置定时任务、文件变更触发等自动化流程"
        >
          <div className="space-y-3">
            <div className="space-y-2">
              {[
                { label: '提交时自动分析', desc: '每次 git commit 后运行代码审查', available: false },
                { label: '每日健康报告', desc: '每天定时汇总项目评分和质量问题', available: false },
                { label: 'PR 发布前扫描', desc: '合并前进行全面安全 + 质量检查', available: false },
              ].map((task) => (
                <div key={task.label} className="flex items-start gap-3">
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded border" />
                  <div>
                    <div className="text-xs font-medium">{task.label}</div>
                    <div className="text-[10px] text-muted-foreground">{task.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              ⚠️ 自动化功能即将上线（后续支持）
            </p>
          </div>
        </SectionCard>

        {/* 连接器 */}
        <SectionCard
          title="连接器"
          icon={<IconLink size={14} />}
          description="连接 GitHub、Slack、Linear 等外部系统"
        >
          <div className="grid grid-cols-3 gap-2">
            {[
              { name: 'GitHub', desc: '代码仓库', available: false },
              { name: 'Slack', desc: '通知推送', available: false },
              { name: 'Linear', desc: '任务跟踪', available: false },
            ].map((conn) => (
              <div
                key={conn.name}
                className="flex items-center gap-2 rounded-md border p-2 opacity-50"
              >
                <div className="h-4 w-4 shrink-0 rounded border" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{conn.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{conn.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            ⚠️ 连接器功能即将上线（后续支持）
          </p>
        </SectionCard>

        {/* 专家 */}
        <SectionCard
          title="专家助手"
          icon={<IconSparkles size={14} />}
          description="内置提示词的专项 AI 助手：代码审查、安全、隐患预判"
        >
          <div className="space-y-2">
            {EXPERT_ROLES.map((expert) => {
              const Icon = expert.icon;
              return (
                <div
                  key={expert.value}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:border-primary/30"
                >
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded border" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Icon size={13} className="text-primary" />
                      <span className="text-xs font-medium">{expert.label}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{expert.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t pt-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={creating || !name.trim() || !slug.trim()}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? '创建中…' : '创建项目'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── 辅助组件 ───────────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-accent/50"
      >
        <span className="text-muted-foreground">{icon}</span>
        <div className="flex-1">
          <div className="text-sm font-medium">{title}</div>
          {description && (
            <div className="text-[11px] text-muted-foreground">{description}</div>
          )}
        </div>
        {open ? (
          <IconChevronDown size={14} className="text-muted-foreground" />
        ) : (
          <IconChevronRight size={14} className="text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t px-4 py-4">{children}</div>}
    </div>
  );
}
