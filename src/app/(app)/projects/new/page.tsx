'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function NewProjectPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.project.create.useMutation({
    onSuccess: (p) => {
      utils.project.list.invalidate();
      router.push(`/projects/${p.id}`);
    },
    onError: (e) => setError(e.message),
  });

  function autoSlug() {
    const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    setSlug(s);
  }

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-bold">新建项目</h1>
      <p className="mb-6 text-sm text-muted-foreground">先建一个空壳；下一步可以上传文件或跑分析</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate({ name, slug, description: description || undefined, visibility });
        }}
        className="space-y-4 rounded-xl border bg-card p-6"
      >
        <div>
          <label className="mb-1 block text-sm font-medium">名称</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={autoSlug}
            maxLength={80}
            placeholder="我的项目"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Slug <span className="text-xs text-muted-foreground">(URL 路径，小写字母数字短横线)</span>
          </label>
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="^[a-z0-9\-]+$"
            placeholder="my-project"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
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
                {v}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}