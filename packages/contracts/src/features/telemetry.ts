import { z } from "zod";

import { defineMethod } from "../contract.js";

/**
 * Telemetry event names, Title Case to match the org-wide PostHog convention
 * used by the Kilo CLI, VS Code, and cloud (`Session Start`, `Task Created`).
 * Extend this enum as new product surfaces start reporting — the renderer and
 * main handlers validate against it at the IPC boundary, so an unknown name is
 * rejected rather than silently sent.
 */
export const TELEMETRY_EVENTS = [
	"Desktop Initialized",
	"Logged In",
	"Logged Out",
	"Page Visit",
	"Feature Flag Evaluation",
] as const;

export const telemetryEventSchema = z.enum(TELEMETRY_EVENTS);

/**
 * How aggressively to strip identity from an event.
 * - `never` (default): attach the resolved identity when logged in.
 * - `if-not-logged-in`: attach identity only when a session already exists.
 * - `always`: force an anonymous send even when logged in (e.g. email-domain
 *   events that could unmask a user).
 */
export const anonymizeOptionSchema = z.enum(["always", "if-not-logged-in", "never"]);

export const telemetryOptionsSchema = z.object({
	anonymize: anonymizeOptionSchema.optional(),
});

export const telemetryTrackInputSchema = z.object({
	event: telemetryEventSchema,
	data: z.record(z.string(), z.unknown()),
	options: telemetryOptionsSchema.optional(),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type AnonymizeOption = z.infer<typeof anonymizeOptionSchema>;
export type TelemetryOptions = z.infer<typeof telemetryOptionsSchema>;
export type TelemetryTrackInput = z.infer<typeof telemetryTrackInputSchema>;

export const telemetryMethods = {
	"telemetry:track": defineMethod(telemetryTrackInputSchema, z.void()),
} as const;
