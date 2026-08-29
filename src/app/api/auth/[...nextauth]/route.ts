// NextAuth v4 dynamic catch-all route
// /api/auth/[signin|callback|session|signout|csrf|providers|...]
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };