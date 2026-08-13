import { z } from "zod";

import { defineContract, defineEvent, defineMethod } from "../contract.js";
import type { InferContract } from "@anaconda-agentic-desktop/feature-sdk";

// ─── Status schema ──────────────────────────────────────────────────────────────

export const anacondaMcpStatusSchema = z.discriminatedUnion("state", [
	z.object({ state: z.literal("disabled") }),
	z.object({ state: z.literal("waiting-for-auth") }),
	z.object({ state: z.literal("waiting-for-kilo") }),
	z.object({ state: z.literal("connected"), url: z.string().url() }),
	z.object({ state: z.literal("error"), reason: z.string() }),
]);

export type AnacondaMcpStatus = z.infer<typeof anacondaMcpStatusSchema>;

// ─── Settings schema ────────────────────────────────────────────────────────────

export const anacondaMcpSettingsSchema = z.object({
	enabled: z.boolean(),
	urlOverride: z.string().url().nullable(),
});

export type AnacondaMcpSettings = z.infer<typeof anacondaMcpSettingsSchema>;

// ─── Contract ───────────────────────────────────────────────────────────────────

export const anacondaMcpContract = defineContract({
	"status.get": defineMethod(z.undefined(), anacondaMcpStatusSchema),
	"settings.get": defineMethod(z.undefined(), anacondaMcpSettingsSchema),
	"settings.set": defineMethod(
		z.object({
			enabled: z.boolean().optional(),
			urlOverride: z.string().url().nullable().optional(),
		}),
		z.object({ ok: z.literal(true) }),
	),
});

// ─── Service type (for useSdk<AnacondaMcpService>) ──────────────────────────────

export type AnacondaMcpService = InferContract<typeof anacondaMcpContract>;

// ─── Events ─────────────────────────────────────────────────────────────────────

/**
 * Feature id under which anaconda-mcp registers in the FEATURES array. The
 * SDK namespaces emitted events with this id, so the registration site and
 * the event constants below must agree — import this constant there.
 */
export const ANACONDA_MCP_FEATURE_ID = "anaconda-mcp";

/**
 * Un-namespaced event name the main-side service emits via
 * `sdk.events.emit(...)`. The SDK namespaces it with the feature id
 * automatically (dot separator).
 */
export const ANACONDA_MCP_STATUS_CHANGED = "status-changed";

/** Fully-namespaced event name renderers subscribe to via `sdk.events.on(...)`. */
export const ANACONDA_MCP_STATUS_CHANGED_EVENT =
	`${ANACONDA_MCP_FEATURE_ID}.${ANACONDA_MCP_STATUS_CHANGED}` as const;

export const anacondaMcpEvents = {
	[ANACONDA_MCP_STATUS_CHANGED_EVENT]: defineEvent(anacondaMcpStatusSchema),
} as const;
