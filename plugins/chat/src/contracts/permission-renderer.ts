import type { ComponentType } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

/** A permission request as a permission renderer sees it. */
export interface PermissionInteraction {
	/**
	 * What is asked for, as Kilo names it: a built-in tool (`bash`, `edit`), a
	 * desktop tool's wire name, or a permission (`external_directory`).
	 */
	readonly permission: string;
	/** The `kilo.core/tool` contribution key, when a desktop tool asks (`kilo.terminal/open`). */
	readonly toolKey?: string;
	/** The request's patterns (a `bash` request's command), without the bare `*` wildcard. */
	readonly patterns: readonly string[];
	/**
	 * What the tool attached to its request (`context.ask`'s `metadata`), with
	 * the server's flags (`sandboxEscalation`, `configProtected`, `skillShell`…).
	 */
	readonly metadata: Readonly<Record<string, unknown>>;
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
export interface PermissionRendererImplementation {
	/** The action in the card's title, as in "Allow {title}?" (the first contribution with one wins). */
	readonly permissionTitle?: (request: PermissionInteraction) => string | undefined;
	/** Shown on the permission card below the request's patterns, in the contributor's context. */
	readonly PermissionDetail?: ComponentType<PermissionDetailProps>;
	/** False hides "Always allow": the request is answered one call at a time. */
	readonly allowAlways?: (request: PermissionInteraction) => boolean;
	/**
	 * False hides the request's patterns, for opaque ones (an id) that a
	 * `PermissionDetail` presents better. "Always allow" still remembers them.
	 */
	readonly showPatterns?: (request: PermissionInteraction) => boolean;
	/** A warning shown under a question's answer (e.g. one that bypasses a guardrail). */
	readonly optionWarning?: (option: QuestionOptionInteraction) => string | undefined;
}

/**
 * Details and policies on the agent's permission requests and questions,
 * shown by kilo.chat's cards: a friendlier title, a summary of what will run,
 * withholding "Always allow", warnings on answers. `tools` limits the
 * permission parts to requests from those desktop tools, by `kilo.core/tool`
 * contribution key (matched on `PermissionRequest.toolKey`, never on wire
 * names). `permissions` limits them to requests for those Kilo permissions,
 * for ones no desktop tool raises (a Kilo plugin's `context.ask`, such as
 * `notebooks_execute`). A request matching either applies; without both they
 * apply to every request.
 */
export const PermissionRenderer = defineExtensionPoint({
	id: "kilo.chat/permission-renderer",
	kind: "additive",
	description: "Details and policies for the agent's permission requests and questions.",
	metadata: z.object({
		tools: z.array(z.string().min(1)).min(1).optional(),
		permissions: z.array(z.string().min(1)).min(1).optional(),
	}),
	implementation: implementation<PermissionRendererImplementation>("renderer"),
});

/** Whether a contribution's permission parts apply to a request. */
export function permissionRendererApplies(
	metadata: {
		readonly tools?: readonly string[] | undefined;
		readonly permissions?: readonly string[] | undefined;
	},
	request: Partial<Pick<PermissionInteraction, "toolKey" | "permission">>,
): boolean {
	if (!metadata.tools && !metadata.permissions) return true;
	const byTool = request.toolKey !== undefined && !!metadata.tools?.includes(request.toolKey);
	const byPermission =
		request.permission !== undefined && !!metadata.permissions?.includes(request.permission);
	return byTool || byPermission;
}
