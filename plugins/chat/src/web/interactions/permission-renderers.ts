import type { Contribution } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";
import { Tool, toolWireName } from "@kilo-desktop/plugin-core/contracts";

import {
	PermissionRenderer,
	permissionRendererApplies,
	type PermissionInteraction,
	type QuestionOptionInteraction,
} from "../../contracts";
import { useOptionalExtensions } from "../optional-extensions";

export type PermissionRendererContribution = Contribution<typeof PermissionRenderer>;

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
	contributions: readonly PermissionRendererContribution[],
	request: Partial<Pick<PermissionInteraction, "toolKey" | "permission">>,
): PermissionRendererContribution[] {
	return contributions.filter(
		(contribution) =>
			contribution.implementation !== undefined &&
			permissionRendererApplies(contribution.metadata, request),
	);
}

export interface PermissionPresentation {
	readonly title: string | undefined;
	readonly allowAlways: boolean;
	readonly showPatterns: boolean;
	readonly details: readonly PermissionRendererContribution[];
}

/** What the applicable contributions make of a permission request. */
export function presentPermission(
	contributions: readonly PermissionRendererContribution[],
	request: PermissionInteraction,
): PermissionPresentation {
	const applicable = permissionRenderers(contributions, request);
	let title: string | undefined;
	let allowAlways = true;
	let showPatterns = true;
	for (const { implementation } of applicable) {
		title ??= implementation?.permissionTitle?.(request);
		if (implementation?.allowAlways?.(request) === false) allowAlways = false;
		if (implementation?.showPatterns?.(request) === false) showPatterns = false;
	}
	return {
		title,
		allowAlways,
		showPatterns,
		details: applicable.filter((contribution) => contribution.implementation?.PermissionDetail),
	};
}

/** Warnings the contributions raise for a question's answer, without repeats. */
export function questionOptionWarnings(
	contributions: readonly PermissionRendererContribution[],
	option: QuestionOptionInteraction,
): string[] {
	const warnings = new Set<string>();
	for (const { implementation } of contributions) {
		const warning = implementation?.optionWarning?.(option);
		if (warning) warnings.add(warning);
	}
	return [...warnings];
}

/** The window's permission renderers. */
export function usePermissionRenderers(): readonly PermissionRendererContribution[] {
	const contributions = useExtensions(PermissionRenderer);
	return contributions.filter((contribution) => contribution.implementation !== undefined);
}

/**
 * The `kilo.core/tool` contribution key a permission names by its wire
 * name (`desktop_terminal_open` → `kilo.terminal/open`),
 * as kilo.core sets `PermissionRequest.toolKey`.
 */
export function toolKeyOf(
	tools: readonly { readonly key: string }[],
	permission: string,
): string | undefined {
	return tools.find((tool) => toolWireName(tool.key) === permission)?.key;
}

/** The window's desktop tools, by wire name, for `toolKeyOf`. */
export function useDesktopTools(): readonly Contribution<typeof Tool>[] {
	return useOptionalExtensions(Tool);
}
