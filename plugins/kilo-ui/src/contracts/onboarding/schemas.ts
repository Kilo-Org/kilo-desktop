import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const onboardingOutcomeSchema = z.enum(["completed", "skipped"]);
export type OnboardingOutcome = z.infer<typeof onboardingOutcomeSchema>;

/**
 * Version of the onboarding flow. Bump it when the wizard changes enough that
 * people who finished or skipped an older one should see it again: an outcome
 * recorded against an older version no longer suppresses the wizard.
 * v1: the original sign-in + workspace modal (records carry no version).
 * v2: full-window flow with terms, work style, and the feature tour.
 */
export const ONBOARDING_VERSION = 2;

export const onboardingStateSchema = z.object({
	outcome: onboardingOutcomeSchema.nullable(),
	closedAt: z.number().nullable(),
	/** Onboarding version the outcome was recorded against; `null` = before versioning (v1). */
	version: z.number().nullable(),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

/**
 * Local record of the user accepting the terms of service on the welcome step.
 * `linkedAccounts` holds opaque hashes of the signed-in accounts the acceptance
 * has been attributed to in telemetry, so each account is linked once.
 */
export const termsAcceptanceSchema = z.object({
	version: z.string(),
	acceptedAt: z.number(),
	linkedAccounts: z.array(z.string()),
});
export type TermsAcceptance = z.infer<typeof termsAcceptanceSchema>;

export const onboardingContract = defineContract({
	"onboarding.get": defineMethod(z.undefined(), onboardingStateSchema),
	"onboarding.complete": defineMethod(z.undefined(), onboardingStateSchema),
	"onboarding.skip": defineMethod(z.undefined(), onboardingStateSchema),
	"onboarding.terms.get": defineMethod(z.undefined(), termsAcceptanceSchema.nullable()),
	/** Records acceptance of `version`; `accountKey` marks it already linked to that account. */
	"onboarding.terms.accept": defineMethod(
		z.object({ version: z.string(), accountKey: z.string().optional() }),
		termsAcceptanceSchema,
	),
	"onboarding.terms.markLinked": defineMethod(
		z.object({ accountKey: z.string() }),
		termsAcceptanceSchema.nullable(),
	),
});

export type OnboardingService = InferContract<typeof onboardingContract>;
