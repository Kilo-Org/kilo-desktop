import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const BROWSER_FEATURE_ID = "browser";
export const BROWSER_STATE_CHANGED = "state-changed";
export const BROWSER_STATE_CHANGED_EVENT =
	`${BROWSER_FEATURE_ID}.${BROWSER_STATE_CHANGED}` as const;

const instanceIdSchema = z.string().min(1).max(512);
const commandSchema = z.object({ instanceId: instanceIdSchema });
export const browserStateSchema = z.object({
	instanceId: instanceIdSchema,
	webContentsId: z.number().int().positive(),
	url: z.string().max(32_768),
	title: z.string().max(512),
	faviconUrl: z.string().max(100_000),
	loading: z.boolean(),
	canGoBack: z.boolean(),
	canGoForward: z.boolean(),
	zoomFactor: z.number().positive(),
	failure: z.object({ code: z.number().int(), description: z.string().max(512) }).optional(),
});
export type BrowserState = z.infer<typeof browserStateSchema>;

export const browserContract = defineContract({
	config: defineMethod(z.undefined(), z.object({ partition: z.string().min(1) })),
	attach: defineMethod(
		z.object({ instanceId: instanceIdSchema, webContentsId: z.number().int().positive() }),
		browserStateSchema,
	),
	detach: defineMethod(
		z.object({ instanceId: instanceIdSchema, webContentsId: z.number().int().positive() }),
		z.undefined(),
	),
	navigate: defineMethod(
		commandSchema.extend({ url: z.string().min(1).max(32_768) }),
		z.undefined(),
	),
	back: defineMethod(commandSchema, z.undefined()),
	forward: defineMethod(commandSchema, z.undefined()),
	reload: defineMethod(commandSchema, z.undefined()),
	hardReload: defineMethod(commandSchema, z.undefined()),
	zoomIn: defineMethod(commandSchema, z.undefined()),
	zoomOut: defineMethod(commandSchema, z.undefined()),
	resetZoom: defineMethod(commandSchema, z.undefined()),
	openDevTools: defineMethod(commandSchema, z.undefined()),
	close: defineMethod(commandSchema, z.undefined()),
});
export type BrowserService = InferContract<typeof browserContract>;
