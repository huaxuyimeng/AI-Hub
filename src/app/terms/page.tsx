import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = {
  title: '服务条款 · AIHub',
  description: 'AIHub 工作台服务条款',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen overflow-y-auto page-enter bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <PageHeader
          title="服务条款"
          subtitle="最后更新：2026-09-01"
        />
        <article className="prose prose-sm max-w-none space-y-4 text-sm leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-base font-semibold text-foreground">1. 服务说明</h2>
            <p>
              AIHub 是一款面向开发者的 AI 代码质量分析工作台，提供多模型对比、代码评分、AI
              资讯聚合等功能。本条款规范您与 AIHub 之间的权利和义务。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">2. 账号与使用</h2>
            <p>
              您应妥善保管账号凭证，并对您账号下发生的所有活动负责。不得将账号用于违反法律法规
              或侵犯第三方权益的用途。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">3. AI 生成内容</h2>
            <p>
              由 AI 生成的代码建议、评分、资讯摘要仅供参考。AI 输出可能存在错误，重要决策前请
              人工复核。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">4. 数据与隐私</h2>
            <p>
              我们仅在为您提供服务的必要范围内处理您上传的代码与配置。详细说明请参阅
              <Link href="/privacy" className="text-primary hover:underline">隐私政策</Link>。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">5. 条款变更</h2>
            <p>
              我们可能根据产品演进或法规要求更新本条款。重大变更会通过站内通知告知。继续使用
              服务即视为接受更新后的条款。
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
