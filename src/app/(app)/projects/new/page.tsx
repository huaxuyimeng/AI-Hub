'use client';

import { useState, useDeferredValue, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconLock,
  IconLockOpen,
  IconCheck,
  IconX,
  IconFolderOpen,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { BackButton } from '@/components/ui/back-button';
import { PageHeader } from '@/components/ui/page-header';

// ─── slug 工具 ────────────────────────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const ILLEGAL_SLUG_CHARS = /[^a-z0-9-]/g;

function buildSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(ILLEGAL_SLUG_CHARS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || '';
}

function slugIsValid(s: string): boolean {
  return SLUG_PATTERN.test(s) && s.length >= 1;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export default function NewProjectPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const toast = useToast();

  // 表单字段
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');

  // 提交中
  const [creating, setCreating] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 防抖 name → slug
  const deferredName = useDeferredValue(name);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // slug 校验
  const slugValid = slugIsValid(slug);
  const slugTouched = slug.length > 0;

  // 提交时重置 slug 编辑标记
  const create = trpc.project.create.useMutation({
    onSuccess: (p: { id: string }) => {
      utils.project.list.invalidate();
      router.push(`/projects/${p.id}`);
    },
    onError: (e: { message: string }) => {
      toast.error(e.message);
      setCreating(false);
    },
  });

  // 自动生成 slug（仅当用户未手动编辑时）
  const realSlug = slugManuallyEdited ? slug : buildSlug(deferredName);
  const slugValue = slugManuallyEdited ? slug : realSlug;

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setName(v);
    if (!slugManuallyEdited) {
      setSlug(buildSlug(v));
    }
  }

  function handleSlugChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSlug(e.target.value);
    setSlugManuallyEdited(true);
  }

  function handleSlugBlur() {
    if (slugManuallyEdited) {
      setSlug(buildSlug(slug));
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    slugIsValid(slugValue) &&
    !creating;

  const submitHint = (() => {
    if (!name.trim()) return '请填写项目名称';
    if (!slugValue) return 'Slug 不能为空';
    if (!slugIsValid(slugValue)) return 'Slug 只能包含小写字母、数字和短横线，且至少 1 字符';
    return null;
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setCreating(true);
    create.mutate({
      name: name.trim(),
      slug: slugIsValid(slugValue) ? slugValue : buildSlug(name),
      description: description.trim() || undefined,
      visibility,
    });
  }

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <PageHeader
        title="新建项目"
        subtitle="创建项目后，可在详情页上传文件并运行代码审查。"
        action={<BackButton href="/projects" title="返回项目列表" />}
      />

      <div className="mx-auto max-w-2xl px-8 py-10">
        <form onSubmit={handleSubmit} noValidate>

          {/* 基础信息卡片 */}
          <div className="rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">基础信息</h2>
            </div>
            <div className="space-y-5 p-5">

              {/* 项目名称 */}
              <div className="space-y-1.5">
                <label htmlFor="project-name" className="block text-sm font-medium">
                  项目名称 <span className="text-destructive" aria-hidden>*</span>
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={handleNameChange}
                  maxLength={80}
                  placeholder="例如：我的前端项目"
                  autoComplete="off"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring/40"
                  aria-required="true"
                />
                {name.length > 0 && (
                  <p className="text-right text-[11px] text-muted-foreground">
                    {name.length} / 80
                  </p>
                )}
              </div>

              {/* Slug */}
              <div className="space-y-1.5">
                <label htmlFor="project-slug" className="flex items-center gap-1.5 text-sm font-medium">
                  Slug <span className="text-xs font-normal text-muted-foreground">(URL 路径)</span>
                  <span className="text-destructive" aria-hidden>*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-muted-foreground">
                    /
                  </span>
                  <input
                    id="project-slug"
                    type="text"
                    value={slugValue}
                    onChange={handleSlugChange}
                    onBlur={handleSlugBlur}
                    maxLength={60}
                    pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$"
                    placeholder="my-project"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className={
                      'w-full rounded-lg border bg-background py-2 pr-10 pl-6 font-mono text-sm outline-none transition focus:ring-2 focus:ring-ring/40 ' +
                      (slugTouched
                        ? slugValid
                          ? 'border-success/40 text-success'
                          : 'border-destructive/40 text-destructive'
                        : 'text-foreground')
                    }
                    aria-required="true"
                    aria-describedby="slug-hint"
                  />
                  {slugTouched && (
                    <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                      {slugValid ? (
                        <IconCheck size={14} className="text-success" aria-label="Slug 可用" />
                      ) : (
                        <IconX size={14} className="text-destructive" aria-label="Slug 格式不正确" />
                      )}
                    </span>
                  )}
                </div>
                <p
                  id="slug-hint"
                  className="text-[11px] text-muted-foreground"
                  role={!slugValid && slugTouched ? 'alert' : undefined}
                >
                  {slugTouched && !slugValid
                    ? '仅支持小写字母 a-z、数字 0-9 和短横线 -，首尾不能是 -，至少 1 字符'
                    : '自动从项目名称生成，可手动修改'}
                </p>
              </div>

              {/* 描述 */}
              <div className="space-y-1.5">
                <label htmlFor="project-desc" className="block text-sm font-medium">
                  描述 <span className="text-xs font-normal text-muted-foreground">(选填)</span>
                </label>
                <textarea
                  id="project-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="简要描述项目用途或目标"
                  className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring/40"
                />
                {description.length > 0 && (
                  <p className="text-right text-[11px] text-muted-foreground">
                    {description.length} / 500
                  </p>
                )}
              </div>

              {/* 可见性 */}
              <fieldset>
                <legend className="mb-2 text-sm font-medium">可见性</legend>
                <div className="flex gap-2">
                  <label
                    className={
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition ' +
                      (visibility === 'PRIVATE'
                        ? 'border-ring bg-ring/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground')
                    }
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value="PRIVATE"
                      checked={visibility === 'PRIVATE'}
                      onChange={() => setVisibility('PRIVATE')}
                      className="sr-only"
                    />
                    <IconLock size={14} />
                    <span>私有</span>
                  </label>

                  <label
                    className={
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition ' +
                      (visibility === 'PUBLIC'
                        ? 'border-ring bg-ring/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground')
                    }
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value="PUBLIC"
                      checked={visibility === 'PUBLIC'}
                      onChange={() => setVisibility('PUBLIC')}
                      className="sr-only"
                    />
                    <IconLockOpen size={14} />
                    <span>公开</span>
                  </label>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  公开项目将对所有互联网访客可见；私有项目仅你自己可见
                </p>
              </fieldset>

              {/* 从文件夹创建 */}
              <div className="border-t pt-4">
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-ignore - webkitdirectory is non-standard
                  webkitdirectory=""
                  directory=""
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    // webkitdirectory 只给文件夹名，用它作为项目名
                    const folderName = (file.webkitRelativePath || file.name || 'untitled')
                      .split('/')[0]
                      .trim();
                    if (folderName && folderName !== 'untitled') {
                      setName(folderName);
                      // 切换回自动生成 slug 模式
                      setSlugManuallyEdited(false);
                    }
                    // reset input so same folder can be selected again
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-muted/50 hover:text-foreground"
                >
                  <IconFolderOpen size={16} className="shrink-0" />
                  <span>从本地文件夹创建项目</span>
                  <span className="ml-auto text-xs text-muted-foreground/70">
                    选择文件夹后自动填入项目名称
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* 提交区 */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push('/projects')}
              className="rounded-lg border px-5 py-2 text-sm text-muted-foreground transition hover:border-foreground/30 hover:bg-accent hover:text-foreground"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              aria-live="polite"
            >
              {creating ? '创建中…' : '创建项目'}
            </button>
          </div>

          {/* disabled 原因提示 */}
          {submitHint && !creating && (
            <p className="mt-2 text-right text-xs text-muted-foreground" aria-live="polite">
              {submitHint}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
