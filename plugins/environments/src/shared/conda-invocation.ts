/**
 * Argument summary for the mutating conda tools, shown in the permission dialog
 * so the user can see *what* will run and *from where* before approving.
 *
 * Only the requested inputs are shown (env, packages, channels) — not the
 * resolved install plan, which would require a dry-run. Non-default sources —
 * an unknown channel, a `channel::` qualifier, or a URL/path package spec — are
 * surfaced as warnings, since they bypass the channel list.
 */

import { MUTATING_CONDA_TOOL_NAMES, matchesMutatingCondaCli } from "./conda-permissions.js";

const CONDA_TOOL_PREFIX = "desktop_environments_conda_";

/** Only the tools that raise a consent prompt have anything to summarise. */
const MUTATING_CONDA_TOOLS = new Set<string>(MUTATING_CONDA_TOOL_NAMES);

/** Mutating tools that accept a `channels` argument (the package source). */
const CHANNEL_TOOLS = new Set<string>([
	"desktop_environments_conda_envs_create",
	"desktop_environments_conda_packages_install",
	"desktop_environments_conda_packages_update",
]);

/** Channel-management tools, which take a single `channel` argument. */
const CHANNEL_MANAGEMENT_TOOLS = new Set<string>([
	"desktop_environments_conda_channels_add",
	"desktop_environments_conda_channels_remove",
]);

/** Channels we treat as trusted (quiet). */
const TRUSTED_CHANNELS = new Set(["main", "defaults"]);
/** Channels we recognise but do not vouch for (displayed, not warned). */
const KNOWN_CHANNELS = new Set(["conda-forge"]);

export type ChannelTrust = "trusted" | "known" | "unknown";

export function classifyChannel(channel: string): ChannelTrust {
	const normalized = channel.trim().toLowerCase();
	if (TRUSTED_CHANNELS.has(normalized)) return "trusted";
	if (KNOWN_CHANNELS.has(normalized)) return "known";
	return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

/** Order-preserving de-duplication (the agent can repeat a channel). */
function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/**
 * A package spec that points at a URL or a local path (e.g.
 * `https://host/pkg-1.0-0.conda`, `file:///tmp/pkg`, `/tmp/pkg`, `C:\pkgs\pkg`).
 * These bypass the channel list, so they are a package source in their own
 * right and are surfaced as such.
 */
function isUrlOrPathSpec(spec: string): boolean {
	const value = spec.trim();
	return (
		value.includes("://") ||
		/^file:/i.test(value) ||
		value.startsWith("/") ||
		value.startsWith("~") ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		/^[a-z]:[\\/]/i.test(value)
	);
}

/** The channel of a channel-qualified spec (`conda-forge::pandas`). */
function channelQualifier(spec: string): string | undefined {
	const separator = spec.indexOf("::");
	if (separator <= 0) return undefined;
	const qualifier = spec.slice(0, separator).trim();
	return qualifier.length > 0 ? qualifier : undefined;
}

/** Whether the tool is one of the mutating conda tools the consent gate covers. */
export function isMutatingCondaTool(toolName: string): boolean {
	return MUTATING_CONDA_TOOLS.has(toolName);
}

/**
 * Whether a permission request is a conda mutation that must stay **per-action**
 * — either one of the gated MCP tools, or a `bash` command that runs a
 * mutating conda-family CLI (`conda install …`). Both are approved one call at
 * a time: a standing "Always allow" would let a later, possibly injection-
 * driven, call skip this dialog.
 */
export function isPerActionCondaMutation(
	permissionLabel: string,
	patterns: readonly string[],
): boolean {
	if (isMutatingCondaTool(permissionLabel)) return true;
	return permissionLabel === "bash" && matchesMutatingCondaCli(patterns.join("\n"));
}

export interface CondaInvocationSummary {
	readonly environment?: string;
	readonly packages: readonly string[];
	readonly channels: readonly string[];
	/** The tool accepts channels but the agent gave none, so conda uses the configured channels. */
	readonly channelsUnspecified: boolean;
	readonly warnings: readonly string[];
}

/**
 * Build the dialog summary for a conda tool invocation, or `undefined` when the
 * tool is not a conda tool / args are unavailable.
 */
export function summarizeCondaInvocation(
	toolName: string,
	args: unknown,
): CondaInvocationSummary | undefined {
	if (!MUTATING_CONDA_TOOLS.has(toolName)) return undefined;
	const record = asRecord(args);
	if (!record) return undefined;

	const environment = asNonEmptyString(record.name) ?? asNonEmptyString(record.prefix);
	const packages = asStringArray(record.packages);
	// De-duplicate so a repeated channel doesn't render twice nor produce a
	// duplicate warning (the warnings are keyed by their text in the dialog).
	const managedChannel = CHANNEL_MANAGEMENT_TOOLS.has(toolName)
		? asNonEmptyString(record.channel)
		: undefined;
	const channels = unique(
		managedChannel !== undefined ? [managedChannel] : asStringArray(record.channels),
	);

	const warnings: string[] = [];
	for (const channel of channels) {
		if (classifyChannel(channel) === "unknown") warnings.push(`Unknown channel: ${channel}`);
	}
	// A package spec can carry its own source — a `channel::` qualifier or a
	// direct URL/path — which bypasses the channel list entirely.
	for (const spec of packages) {
		const qualifier = channelQualifier(spec);
		if (qualifier !== undefined) {
			if (classifyChannel(qualifier) === "unknown") warnings.push(`Unknown channel: ${qualifier}`);
			continue;
		}
		if (isUrlOrPathSpec(spec)) warnings.push(`Non-default package source: ${spec}`);
	}
	// `conda.envs.delete` removes the whole environment (`name`/`prefix` only).
	if (toolName === `${CONDA_TOOL_PREFIX}envs_delete`) {
		warnings.push(
			"Removes the entire environment and all of its packages. This is irreversible — review carefully before allowing.",
		);
	}
	// `conda.packages.update` has a `updateAll: true` mode (mutually exclusive
	// with `packages`) that rewrites every package in the environment — the tool
	// itself warns this can break it, and there are no packages to list.
	if (toolName === `${CONDA_TOOL_PREFIX}packages_update` && record.updateAll === true) {
		warnings.push("Updates all packages in the environment; this can break it.");
	}
	// Rank 1 puts the channel ahead of every configured channel, so it wins
	// package resolution for every later install.
	if (toolName === `${CONDA_TOOL_PREFIX}channels_add` && record.position === 1) {
		warnings.push("Takes highest priority over your existing channels.");
	}

	return {
		...(environment ? { environment } : {}),
		packages,
		channels,
		channelsUnspecified: CHANNEL_TOOLS.has(toolName) && channels.length === 0,
		warnings: unique(warnings),
	};
}
