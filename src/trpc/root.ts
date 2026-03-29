import { router } from "./init";
import { bookingProcedures } from "./procedures/booking";
import { expertProcedures } from "./procedures/expert";
import { healthProcedures } from "./procedures/health";
import { onboardingProcedures } from "./procedures/onboarding";
import { profileProcedures } from "./procedures/profile";
import { reviewProcedures } from "./procedures/review";
import { userProcedures } from "./procedures/user";

export const appRouter = router({
  ...healthProcedures,
  ...expertProcedures,
  ...bookingProcedures,
  ...userProcedures,
  ...profileProcedures,
  ...reviewProcedures,
  ...onboardingProcedures,
});

export type AppRouter = typeof appRouter;
