import type { ComponentType } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

/** A permission request as an interaction renderer sees it. */
export interface PermissionInteraction {
	/** What is asked for: the tool Kilo calls (`bash`, `desktop_terminal_open`) or the permission. */
	readonly permission: string;
	/** The request's patterns (a `bash` request's command), without the bare `*` wildcard. */
	readonly patterns: readonly string[];
	/** The tool call's arguments, when the transcript has them. */
	readonly args: unknown;
}

/** One answer offered by an agent question. */
export interface QuestionOptionInteraction {
	readonly label: string;
	readonly description?: string | undefined;
}

export interface PermissionDetailProps {
	readonly request: PermissionInteraction;
}

/**
 * Contributed to kilo.chat's permission and question cards. Every part is
 * optional; the card keeps its own wording, buttons and layout.
 */
export interface InteractionRendererImplementation {
	/** The action in the card's title, as in "Allow {title}?" (the first contribution with one wins). */
	readonly permissionTitle?: (request: PermissionInteraction) => string | undefined;
	/** Shown on the permission card below the request's patterns, in the contributor's context. */
	readonly PermissionDetail?: ComponentType<PermissionDetailProps>;
	/** False hides "Always allow": the request is answered one call at a time. */
	readonly allowAlways?: (request: PermissionInteraction) => boolean;
	/** A warning shown under a question's answer (e.g. one that bypasses a guardrail). */
	readonly optionWarning?: (option: QuestionOptionInteraction) => string | undefined;
}

/**
 * Details and policies on the agent's permission requests and questions,
 * shown by kilo.chat's cards: a friendlier title, a summary of what will run,
 * withholding "Always allow", warnings on answers. `permissions` limits the
 * permission parts to requests for those tools (Kilo's names); without it
 * they apply to every request.
 */
export const InteractionRenderer = defineExtensionPoint({
	id: "kilo.chat/interaction-renderer",
	kind: "additive",
	description: "Details and policies for the agent's permission requests and questions.",
	metadata: z.object({
		permissions: z.array(z.string().min(1)).min(1).optional(),
	}),
	implementation: implementation<InteractionRendererImplementation>("renderer"),
});
