// 来源：d:\1Money\design\API设计.md §2.1 tRPC fetch handler
// 把 tRPC 挂到 /api/trpc/[trpc] 路由

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/routers/_app';
import { createContext } from '@/server/context';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        req,
        resHeaders: new Headers(),
        info: { connectionParams: null, isBatchCall: false, calls: [] },
      } as never),
  });

export { handler as GET, handler as POST };