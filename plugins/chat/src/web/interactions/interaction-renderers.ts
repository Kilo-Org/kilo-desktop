import { useMemo } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";

import {
	InteractionRenderer,
	type PermissionInteraction,
	type QuestionOptionInteraction,
} from "../../contracts";

export type InteractionRendererContribution = Contribution<typeof InteractionRenderer>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * The arguments of the tool call a permission request is about. The request
 * names the call (`tool: {messageID, callID}`) but carries no arguments, so
 * the call is found in the thread by its id.
 */
export function findPermissionToolArgs(
	messages: readonly unknown[] | undefined,
	tool: { readonly messageID: string; readonly callID: string } | undefined,
): unknown {
	if (!tool?.callID) return undefined;
	for (const message of messages ?? []) {
		const content = asRecord(message)?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const record = asRecord(part);
			if (record?.type === "tool-call" && record.toolCallId === tool.callID) return record.args;
		}
	}
	return undefined;
}

/** The contributions that apply to a permission request, highest priority first. */
export function permissionRenderers(
	contributions: readonly InteractionRendererContribution[],
	permission: string,
): InteractionRendererContribution[] {
	return contributions.filter(
		(contribution) =>
			contribution.implementation !== undefined &&
			(!contribution.metadata.permissions ||
				contribution.metadata.permissions.includes(permission)),
	);
}

export interface PermissionPresentation {
	readonly title: string | undefined;
	readonly allowAlways: boolean;
	readonly details: readonly InteractionRendererContribution[];
}

/** What the applicable contributions make of a permission request. */
export function presentPermission(
	contributions: readonly InteractionRendererContribution[],
	request: PermissionInteraction,
): PermissionPresentation {
	const applicable = permissionRenderers(contributions, request.permission);
	let title: string | undefined;
	let allowAlways = true;
	for (const { implementation } of applicable) {
		title ??= implementation?.permissionTitle?.(request);
		if (implementation?.allowAlways?.(request) === false) allowAlways = false;
	}
	return {
		title,
		allowAlways,
		details: applicable.filter((contribution) => contribution.implementation?.PermissionDetail),
	};
}

/** Warnings the contributions raise for a question's answer, without repeats. */
export function questionOptionWarnings(
	contributions: readonly InteractionRendererContribution[],
	option: QuestionOptionInteraction,
): string[] {
	const warnings = new Set<string>();
	for (const { implementation } of contributions) {
		const warning = implementation?.optionWarning?.(option);
		if (warning) warnings.add(warning);
	}
	return [...warnings];
}

/** The window's interaction renderers. */
export function useInteractionRenderers(): readonly InteractionRendererContribution[] {
	const contributions = useExtensions(InteractionRenderer);
	return useMemo(
		() => contributions.filter((contribution) => contribution.implementation !== undefined),
		[contributions],
	);
}
