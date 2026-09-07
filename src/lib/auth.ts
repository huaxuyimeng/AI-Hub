// 来源：d:\1Money\design\API设计.md §六 Auth 设计
// 批次 A 必修 + 批次 B 落地 + 批次 C 真实缺陷修复
//   C13：Credentials bcrypt 校验
//   C22：jwt callback 时序 - 仅在 user 参数存在时查 DB（user 仅在 signIn/signUp 触发）
//   C24：接 PrismaAdapter，GitHub token 持久化到 Account 表
//   C32：CredentialsProvider label 改名

import type { NextAuthOptions, DefaultSession } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { prismaBase } from './db';

// Session 扩展
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      tenantId?: string;
      role?: 'ADMIN' | 'MEMBER';
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId?: string;
    role?: 'ADMIN' | 'MEMBER';
  }
}

// C24：挂 PrismaAdapter，OAuth Account/Session 表由 NextAuth 自动维护
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prismaBase),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
    // C32：Credentials label 改为中文
    CredentialsProvider({
      name: '邮箱密码',
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        // Q8 修复：归一化邮箱到小写，消除大小写歧义
        const email = String(credentials.email).trim().toLowerCase();
        const user = await prismaBase.user.findFirst({
          where: { email, deletedAt: null },
        });
        // C13：必须有 passwordHash 才允许凭证登录（GitHub OAuth 用户 passwordHash 为 null）
        if (!user?.passwordHash) return null;
        // C13：bcrypt 常量时间比较，防时序攻击
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
        } as never;
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    /**
     * signIn：session 建立前触发。
     * - GitHub OAuth 首次登录：自动创建 Tenant + User
     * - Credentials 首次登录：确保 User 已存在
     * - PrismaAdapter 已负责把 OAuth provider 的 Account / Session 行持久化
     *
     * C-1 修复：防止跨租户 GitHub OAuth 越权
     *   风险：schema 用 @@unique([tenantId, email])，多租户下 email 不唯一；
     *   旧逻辑 findFirst({ email }) 会取第一个匹配 user，攻击者可用同一邮箱在不同 tenant
     *   注册，再用 GitHub OAuth 触发登录，从而拿到任意租户会话。
     *   修复：严格按 Account(provider, providerAccountId) 关联；只在唯一匹配时才按 email 关联。
     */
    async signIn({ user, account }) {
      try {
        if (!user?.email) {
          // eslint-disable-next-line no-console
          console.warn('[auth.signIn] no user.email');
          return false;
        }

        if (account?.provider === 'github') {
          const normEmail = (user.email ?? '').trim().toLowerCase();
          const providerAccountId = String(account.providerAccountId ?? '');

          // 1) 优先按 Account(provider, providerAccountId) 找已绑定的 User
          if (providerAccountId) {
            const linked = await prismaBase.account.findFirst({
              where: { provider: 'github', providerAccountId },
              include: { user: true },
            });
            if (linked?.user) {
              // 已绑定：校验 OAuth 返回的邮箱与 User.email 一致（防 email 漂移/账号被盗）
              if (linked.user.email.toLowerCase() !== normEmail) {
                // eslint-disable-next-line no-console
                console.warn('[auth.signIn] github account email mismatch, blocking', {
                  accountId: linked.user.id,
                  accountEmail: linked.user.email,
                  oauthEmail: normEmail,
                });
                return false;
              }
              return true;
            }
          }

          // 2) 未绑定：按 email 查找 candidate User，多个候选时必须全部为纯 OAuth 用户
          const candidates = await prismaBase.user.findMany({
            where: { email: normEmail, deletedAt: null },
            select: { id: true, passwordHash: true, email: true },
          });
          if (candidates.length > 1) {
            // 多个 tenant 共用同一 email —— 仅当所有候选都是纯 OAuth 用户（无密码）才放行
            // 否则拒绝（防止越权拿到第一个匹配用户的会话）
            const allOAuthOnly = candidates.every((u) => u.passwordHash === null);
            if (!allOAuthOnly) {
              // eslint-disable-next-line no-console
              console.warn('[auth.signIn] cross-tenant oauth attempt blocked', {
                email: normEmail,
                candidateCount: candidates.length,
              });
              return false;
            }
          }
          if (candidates.length === 1 && candidates[0].id) {
            // 兼容旧逻辑：role 默认 'MEMBER'，这里不需要 update（prisma schema 默认值）
            // 仅在需要补齐 role 字段时再 update
            const u = await prismaBase.user.findUnique({
              where: { id: candidates[0].id },
              select: { role: true },
            });
            if (u && !u.role) {
              await prismaBase.user.update({
                where: { id: candidates[0].id },
                data: { role: 'MEMBER' },
              });
            }
          }
          return true;
        }

        if (account?.provider === 'credentials') {
          // Q8 修复：归一化邮箱到小写
          const normEmail = (user.email ?? '').trim().toLowerCase();
          const existing = await prismaBase.user.findFirst({
            where: { email: normEmail, deletedAt: null },
          });
          if (existing) {
            if (!existing.role) {
              await prismaBase.user.update({
                where: { id: existing.id },
                data: { role: 'MEMBER' },
              });
            }
            return true;
          }
          return false;
        }
        return true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[auth.signIn] error', e);
        return false;
      }
    },

    /**
     * C22：jwt callback 时序风险修复
     * - `user` 参数仅在 trigger === 'signIn' / 'signUp' 时存在（即首次登录）
     * - 后续 token 刷新场景 user 是 undefined，jwt callback 不再查 DB
     * - token 上的 tenantId / role 会在后续 session callback 透传给客户端
     *
     * C-1 修复：用 user.id（受信任，由 PrismaAdapter 或 authorize 注入）查 DB，
     *          替代旧的按 email 查 user，避免多租户下 email 不唯一导致取到错 user。
     */
    async jwt({ token, user }) {
      if (user?.id) {
        const dbUser = await prismaBase.user.findUnique({
          where: { id: user.id },
          select: { tenantId: true, role: true },
        });
        token.tenantId = dbUser?.tenantId;
        token.role = (dbUser?.role ?? 'MEMBER') as 'ADMIN' | 'MEMBER';
      }
      // token 刷新场景：保持已有值
      token.role ??= 'MEMBER';
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        if (token.sub) session.user.id = token.sub;
        session.user.tenantId = token.tenantId;
        session.user.role = (token.role ?? 'MEMBER') as 'ADMIN' | 'MEMBER';
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};