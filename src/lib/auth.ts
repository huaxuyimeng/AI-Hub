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
     */
    async signIn({ user, account }) {
      try {
        if (!user?.email) {
          // eslint-disable-next-line no-console
          console.warn('[auth.signIn] no user.email');
          return false;
        }

        if (account?.provider === 'github' || account?.provider === 'credentials') {
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

          // 首次登录：自动创建 Tenant + User
          const slugBase = normEmail.split('@')[0].replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'user';
          const tenant = await prismaBase.tenant.create({
            data: { name: `${normEmail.split('@')[0]} 的空间`, slug: `${slugBase}-${Date.now().toString(36)}` },
          });
          await prismaBase.user.create({
            data: {
              tenantId: tenant.id,
              email: normEmail,
              name: user.name ?? null,
              image: user.image ?? null,
              role: 'MEMBER',
            },
          });
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
     */
    async jwt({ token, user }) {
      if (user) {
        // Q8 修复：归一化邮箱到小写
        const normEmail = (user.email ?? '').trim().toLowerCase();
        const dbUser = await prismaBase.user.findFirst({
          where: { email: normEmail, deletedAt: null },
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