import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { type NextRequest } from "next/server";

import { resolveUserId } from "@/lib/request-auth";

export async function createTRPCContext(opts: { req: Request }) {
  const userId = await resolveUserId(opts.req as NextRequest);
  return { userId };
}

const t = initTRPC.context<Awaited<ReturnType<typeof createTRPCContext>>>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const enforceUser = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  }
  return next({
    ctx: { userId: ctx.userId as string },
  });
});

export const protectedProcedure = t.procedure.use(enforceUser);
