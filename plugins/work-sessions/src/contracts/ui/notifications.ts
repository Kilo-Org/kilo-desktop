import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
} from "@kilo-desktop/kernel";
import type { PermissionRequest } from "@kilo-desktop/plugin-core/contracts";

/**
 * How long a plugin has to answer a request it takes. One still pending
 * after this is shown to the person (kilo.chat reveals its card) and sounds.
 */
export const PERMISSION_AUTO_ANSWER_TIMEOUT_MS = 3_000;

/**
 * Says whether a plugin answers one of the agent's permission requests for
 * the person (kilo.chat's Auto approve), so "Kilo needs you" sounds only for
 * requests a person must answer. Any contribution answering true silences it
 * for `PERMISSION_AUTO_ANSWER_TIMEOUT_MS`.
 */
export const PermissionAutoAnswer = defineExtensionPoint({
	id: "kilo.work-sessions/permission-auto-answer",
	kind: "additive",
	description: "Whether a plugin answers an agent permission request for the person.",
	metadata: z.object({}),
	implementation: implementation<(request: PermissionRequest) => boolean>("renderer"),
});

/** When a cue notifies: `smart` skips the chat the person is already looking at. */
export const NOTIFICATION_MODES = ["off", "smart", "always"] as const;
/** The cues: a chat's work is done, or an agent (a subagent's too) needs the person. */
export const NOTIFICATION_CUES = ["done", "needsYou"] as const;

export const notificationPreferencesStateSchema = z.object({
	done: z.enum(NOTIFICATION_MODES),
	needsYou: z.enum(NOTIFICATION_MODES),
});
export type NotificationPreferencesState = z.infer<typeof notificationPreferencesStateSchema>;

/**
 * The person's notification choices on this device (Settings → Notifications),
 * so other surfaces can show and flip them — the Swarm Board's "Notify when an
 * agent needs me".
 */
export const NotificationPreferences = defineDomainObject({
	id: "kilo.work-sessions/notification-preferences",
	home: "renderer",
	description: "When chats' cues notify on this device: done, and needs you.",
	state: notificationPreferencesStateSchema,
	methods: {
		setMode: method(
			z.object({ cue: z.enum(NOTIFICATION_CUES), mode: z.enum(NOTIFICATION_MODES) }),
			z.undefined(),
		),
	},
});
