import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";
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
