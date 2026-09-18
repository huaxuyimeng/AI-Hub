import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = {
  title: '隐私政策 · AIHub',
  description: 'AIHub 工作台隐私政策',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen overflow-y-auto page-enter bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <PageHeader
          title="隐私政策"
          subtitle="最后更新：2026-09-01"
        />
        <article className="prose prose-sm max-w-none space-y-4 text-sm leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-base font-semibold text-foreground">1. 我们收集什么</h2>
            <p>
              <strong>账号信息</strong>：邮箱、显示名、头像（可选）。
            </p>
            <p>
              <strong>使用数据</strong>：项目、文件、对话、AI 评分与用量统计。
            </p>
            <p>
              <strong>主题偏好</strong>：您选择的主题预设、强调色、自定义背景图。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">2. 数据用途</h2>
            <p>
              您的数据仅用于：(a) 提供工作台核心功能；(b) 多租户隔离与软删除治理；
              (c) 优化 AI 模型路由与成本。我们不会将您的代码与对话用于训练第三方模型。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">3. 数据存储</h2>
            <p>
              元数据存于 Supabase（PostgreSQL）；文件与背景图存于 Cloudflare R2。
              所有传输使用 HTTPS 加密。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">4. 您的权利</h2>
            <p>
              您可以随时导出、软删除或硬删除您的项目与对话记录。账号注销后，相关数据将在
              30 天内从生产环境清除。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">5. Cookie</h2>
            <p>
              我们使用必要的会话 Cookie 来保持登录状态。主题、侧栏折叠等本地偏好使用
              localStorage 存储于您的浏览器。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">6. 联系我们</h2>
            <p>
              如对本政策有疑问，请在
              <Link href="https://github.com" className="text-primary hover:underline">GitHub 仓库</Link>
              提交 Issue。
            </p>
          </section>
        </article>

        <div className="mt-10 border-t pt-6 text-center">
          <Link
            href="/login"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            ← 返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
