import { z } from "zod";

import { defineEvent, defineMethod } from "../contract.js";

const paneWindowIdentity = z.object({
	pluginId: z.string().min(1).max(120),
	sessionId: z.string().min(1).max(256),
	paneId: z.string().min(1).max(256),
});

export const paneWindow = paneWindowIdentity.extend({
	title: z.string().min(1).max(256),
	path: z.string().regex(/^\/plugins\/[a-zA-Z0-9/_-]{1,200}$/),
	workspaceId: z.string().min(1).max(256).optional(),
});

export const paneWindowEvent = paneWindowIdentity.extend({
	type: z.enum(["opened", "docked", "focused", "blurred"]),
});

export const shellNavigationTarget = z.object({
	path: z.string().regex(/^\/(?:settings|plugins)\/[a-zA-Z0-9/_-]{1,200}$/),
	search: z.record(z.string().min(1).max(64), z.string().min(1).max(256)),
});

export type PaneWindow = z.infer<typeof paneWindow>;
export type PaneWindowEvent = z.infer<typeof paneWindowEvent>;
export type ShellNavigationTarget = z.infer<typeof shellNavigationTarget>;

export const shellMethods = {
	"shell:open-external": defineMethod(
		z.object({ url: z.string() }),
		z.object({ opened: z.boolean() }),
	),
	"shell:copy-text": defineMethod(z.object({ text: z.string() }), z.undefined()),
	"shell:show-item-in-folder": defineMethod(
		z.object({ path: z.string().min(1) }),
		z.object({ revealed: z.boolean() }),
	),
	"shell:show-log-file": defineMethod(z.undefined(), z.object({ revealed: z.boolean() })),
	"shell:get-log-file-path": defineMethod(z.undefined(), z.object({ path: z.string() })),
	"shell:show-open-dialog": defineMethod(
		z.object({ kind: z.literal("directory"), multiple: z.boolean().optional() }),
		z.object({ canceled: z.boolean(), paths: z.array(z.string()) }),
	),
	"shell:open-pane-window": defineMethod(paneWindow, z.object({ opened: z.boolean() })),
	"shell:list-pane-windows": defineMethod(
		z.object({ pluginId: z.string().min(1).max(120) }),
		z.array(paneWindow),
	),
	"shell:focus-pane-window": defineMethod(paneWindowIdentity, z.object({ focused: z.boolean() })),
	"shell:dock-pane-window": defineMethod(paneWindowIdentity, z.object({ docked: z.boolean() })),
	"shell:sync-pane-windows": defineMethod(
		z.object({
			pluginId: z.string().min(1).max(120),
			activeSessionId: z.string().min(1).max(256).nullable(),
		}),
		z.undefined(),
	),
} as const;

export const shellEvents = {
	"shell:pane-window-changed": defineEvent(paneWindowEvent),
	"shell:navigate": defineEvent(shellNavigationTarget),
} as const;
