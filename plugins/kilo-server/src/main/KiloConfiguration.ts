import type { KiloConfigurationState } from "../contracts/schemas.js";
import type { KiloConfigManager, KiloConfigMutationOutcome } from "./KiloConfigManager.js";
import type { KiloPluginConfig, KiloPluginMutationOutcome } from "./KiloPluginConfig.js";

export interface KiloConfigurationOptions {
	readonly mcpConfig: Pick<
		KiloConfigManager,
		"setMcpEntry" | "removeMcpEntry" | "listOwnedMcpEntryIds"
	>;
	readonly pluginConfig: Pick<KiloPluginConfig, "install" | "remove" | "listOwnedPluginIds">;
	readonly onChanged: () => void;
}

function assertMcpMutationAccepted(
	sourceId: string,
	entryId: string,
	outcome: KiloConfigMutationOutcome,
	action: "set" | "remove",
): void {
	if (outcome.kind === "skipped-error") {
		throw new Error(`Could not ${action} Desktop-owned MCP "${entryId}": ${outcome.reason}`);
	}
	if (outcome.kind === "skipped" && outcome.reason === "owned-by-other-source") {
		throw new Error(
			`Could not ${action} Desktop-owned MCP "${entryId}": it is owned by another source, not "${sourceId}".`,
		);
	}
	if (outcome.kind === "skipped" && outcome.reason === "entry-not-owned") {
		if (action === "set") {
			throw new Error(
				`Could not set MCP "${entryId}": an entry not owned by Desktop already uses that id.`,
			);
		}
		throw new Error(
			`Could not remove Desktop-owned MCP "${entryId}": it is not owned by "${sourceId}".`,
		);
	}
}

function assertPluginMutationAccepted(
	sourceId: string,
	pluginId: string,
	outcome: KiloPluginMutationOutcome,
	action: "install" | "remove",
): void {
	if (outcome.kind === "skipped-error") {
		throw new Error(
			`Could not ${action} Desktop-owned Kilo plugin "${pluginId}": ${outcome.reason}`,
		);
	}
	if (action === "remove" && outcome.kind === "skipped" && outcome.reason === "not-owned") {
		throw new Error(
			`Could not remove Desktop-owned Kilo plugin "${pluginId}": it is not owned by "${sourceId}".`,
		);
	}
}

/**
 * Owns serialized, source-scoped Kilo desired state. MCP JSONC and plugin files
 * retain their specialized ownership adapters, while callers declare their
 * complete state at this seam. Additions run before pruning so migrations
 * establish their replacement first. Other sources and user-owned config are
 * preserved. Any changed adapter requests one shared server restart after the
 * complete reconciliation, including partial-failure paths.
 */
export class KiloConfiguration {
	readonly #options: KiloConfigurationOptions;
	#pending: Promise<void> = Promise.resolve();

	constructor(options: KiloConfigurationOptions) {
		this.#options = options;
	}

	set(sourceId: string, desired: KiloConfigurationState): Promise<void> {
		const snapshot = structuredClone(desired);
		const result = this.#pending.then(
			() => this.#reconcile(sourceId, snapshot),
			() => this.#reconcile(sourceId, snapshot),
		);
		this.#pending = result.catch(() => undefined);
		return result;
	}

	async #reconcile(sourceId: string, desired: KiloConfigurationState): Promise<void> {
		let changed = false;
		try {
			for (const [pluginId, sourcePath] of Object.entries(desired.plugins)) {
				const outcome = await this.#options.pluginConfig.install(sourceId, pluginId, sourcePath);
				assertPluginMutationAccepted(sourceId, pluginId, outcome, "install");
				changed ||= outcome.kind === "written";
			}
			for (const [entryId, entry] of Object.entries(desired.mcpEntries)) {
				const outcome = await this.#options.mcpConfig.setMcpEntry(sourceId, entryId, entry);
				assertMcpMutationAccepted(sourceId, entryId, outcome, "set");
				changed ||= outcome.kind === "written";
			}

			const desiredMcpEntryIds = new Set(Object.keys(desired.mcpEntries));
			const ownedMcpEntryIds = await this.#options.mcpConfig.listOwnedMcpEntryIds(sourceId);
			for (const entryId of ownedMcpEntryIds) {
				if (desiredMcpEntryIds.has(entryId)) continue;
				const outcome = await this.#options.mcpConfig.removeMcpEntry(sourceId, entryId);
				assertMcpMutationAccepted(sourceId, entryId, outcome, "remove");
				changed ||= outcome.kind === "removed";
			}

			const desiredPluginIds = new Set(Object.keys(desired.plugins));
			const ownedPluginIds = await this.#options.pluginConfig.listOwnedPluginIds(sourceId);
			for (const pluginId of ownedPluginIds) {
				if (desiredPluginIds.has(pluginId)) continue;
				const outcome = await this.#options.pluginConfig.remove(sourceId, pluginId);
				assertPluginMutationAccepted(sourceId, pluginId, outcome, "remove");
				changed ||= outcome.kind === "removed";
			}
		} finally {
			if (changed) this.#options.onChanged();
		}
	}
}
