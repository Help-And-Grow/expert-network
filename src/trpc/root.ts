import { router } from "./init";
import { bookingProcedures } from "./procedures/booking";
import { expertProcedures } from "./procedures/expert";
import { healthProcedures } from "./procedures/health";
import { userProcedures } from "./procedures/user";

export const appRouter = router({
  ...healthProcedures,
  ...expertProcedures,
  ...bookingProcedures,
  ...userProcedures,
});

export type AppRouter = typeof appRouter;
