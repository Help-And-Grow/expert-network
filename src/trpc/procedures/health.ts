import { publicProcedure } from "../init";

export const healthProcedures = {
  health: publicProcedure.query(() => ({
    ok: true as const,
    ts: Date.now(),
  })),
};
