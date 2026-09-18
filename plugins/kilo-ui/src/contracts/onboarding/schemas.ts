import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const onboardingOutcomeSchema = z.enum(["completed", "skipped"]);
export type OnboardingOutcome = z.infer<typeof onboardingOutcomeSchema>;

export const onboardingStateSchema = z.object({
	outcome: onboardingOutcomeSchema.nullable(),
	closedAt: z.number().nullable(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const onboardingContract = defineContract({
	"onboarding.get": defineMethod(z.undefined(), onboardingStateSchema),
	"onboarding.complete": defineMethod(z.undefined(), onboardingStateSchema),
	"onboarding.skip": defineMethod(z.undefined(), onboardingStateSchema),
});

export type OnboardingService = InferContract<typeof onboardingContract>;
