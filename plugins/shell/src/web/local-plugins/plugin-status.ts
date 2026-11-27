import type { ExternalPluginRecord, PluginState } from "@kilo-desktop/kernel";

export type PluginStatusKind = "active" | "pending" | "attention" | "idle" | "problem";

export interface LocalPluginStatus {
	readonly label: string;
	readonly kind: PluginStatusKind;
	/** Why it can't load or start, when it can't. */
	readonly message?: string;
}

/** What the kernel says about a plugin this launch: its state and its errors. */
export interface KernelPluginFacts {
	readonly state?: PluginState;
	readonly errors: readonly string[];
}

/**
 * A local plugin's status in the user's words. Before its code runs the
 * scanner decides (can it load? is it allowed?); once main loaded it, the
 * kernel's plugin state does, so a plugin that failed to start says so
 * instead of looking fine. Allowing or withdrawing applies from the next
 * launch, which the pending labels say.
 */
export function localPluginStatus(
	plugin: ExternalPluginRecord,
	kernel: KernelPluginFacts,
	/** Whether local plugins load at the next launch ("Allow local plugins"). */
	localPluginsEnabled: boolean,
): LocalPluginStatus {
	// What loads at the next launch: only enabled plugins, and only while local plugins are on.
	const willLoad = localPluginsEnabled && plugin.approved;
	const reason = plugin.message ?? kernel.errors[0];
	const withReason = (status: Omit<LocalPluginStatus, "message">): LocalPluginStatus =>
		reason ? { ...status, message: reason } : status;

	if (plugin.status === "invalid") return withReason({ label: "Can't load", kind: "problem" });
	if (plugin.status === "failed") return withReason({ label: "Failed to load", kind: "problem" });
	if (!plugin.loaded) {
		return willLoad
			? { label: "Starts after restart", kind: "pending" }
			: { label: "Disabled", kind: "attention" };
	}
	switch (kernel.state) {
		case "failed":
			return withReason({ label: "Failed to start", kind: "problem" });
		case "unresolved":
			return withReason({ label: "Can't start", kind: "problem" });
		case "disabled":
			return { label: "Turned off in Diagnostics", kind: "idle" };
		case "active":
			return willLoad
				? { label: "Active", kind: "active" }
				: { label: "Stops after restart", kind: "pending" };
		case "resolved":
		case "activating":
			return { label: "Starting", kind: "pending" };
		default:
			return { label: "Stopped", kind: "idle" };
	}
}
