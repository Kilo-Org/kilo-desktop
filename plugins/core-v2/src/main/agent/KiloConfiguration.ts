import type { KiloConfigurationState } from "./types.js";
import type {
	KiloConfigEntry,
	KiloConfigManager,
	KiloConfigMutationOutcome,
	KiloEntrySection,
} from "./KiloConfigManager.js";
import type { KiloPluginConfig, KiloPluginMutationOutcome } from "./KiloPluginConfig.js";
import type { KiloSkillConfig, KiloSkillMutationOutcome } from "./KiloSkillConfig.js";

export interface KiloConfigurationOptions {
	readonly kiloConfig: Pick<KiloConfigManager, "setEntry" | "removeEntry" | "listOwnedEntryIds">;
	readonly pluginConfig: Pick<KiloPluginConfig, "install" | "remove" | "listOwnedPluginIds">;
	readonly skillConfig: Pick<KiloSkillConfig, "install" | "remove" | "listOwnedSkillIds">;
	readonly onChanged: () => void;
	readonly logger?: { warn(message: string): void };
}

type AnyOutcome = KiloConfigMutationOutcome | KiloPluginMutationOutcome | KiloSkillMutationOutcome;

/** What a mutation meant: `conflict` is a name someone else (the user, another source) holds. */
type Effect = "changed" | "unchanged" | "conflict" | { readonly error: string };

function effectOf(outcome: AnyOutcome, action: "set" | "remove"): Effect {
	switch (outcome.kind) {
		case "written":
		case "removed":
			return "changed";
		case "skipped-error":
			return { error: outcome.reason };
		case "skipped":
			switch (outcome.reason) {
				case "up-to-date":
				case "nothing-to-remove":
					return "unchanged";
				case "entry-not-owned":
				case "not-owned":
				case "owned-by-other-source":
					// Pruning something the source turns out not to own leaves it alone.
					return action === "set" ? "conflict" : "unchanged";
			}
	}
}

/** One kind of thing a source puts into Kilo, behind its own ownership adapter. */
interface Part {
	/** How a message names one of them: `MCP server "x"`. */
	readonly label: string;
	/** What setting one is called in a message. */
	readonly setVerb: "install" | "set";
	readonly desired: Readonly<Record<string, unknown>>;
	set(id: string, value: unknown): Promise<AnyOutcome>;
	listOwned(): Promise<readonly string[]>;
	remove(id: string): Promise<AnyOutcome>;
}

/**
 * Owns serialized, source-scoped Kilo desired state: each source declares
 * everything it puts into Kilo (config `mcp`, `agent` and `command` entries,
 * Desktop-managed Kilo plugins, linked skills) and this brings Kilo in line,
 * through each kind's own ownership adapter, so other sources and the user's
 * own config are never touched. Additions run before pruning, so a
 * replacement is in place before what it replaces goes.
 *
 * A name someone else already holds (the user's entry, another source's) is
 * left alone and warned about once; any other failure doesn't stop the rest
 * of the source's state from being applied, and is reported once everything
 * has been tried. Any change requests one shared server restart after the
 * whole reconciliation, including partial-failure paths.
 */
export class KiloConfiguration {
	readonly #options: KiloConfigurationOptions;
	readonly #warned = new Set<string>();
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

	#parts(sourceId: string, desired: KiloConfigurationState): readonly Part[] {
		const { kiloConfig, pluginConfig, skillConfig } = this.#options;
		const entries = (
			section: KiloEntrySection,
			label: string,
			values: Readonly<Record<string, KiloConfigEntry>>,
		): Part => ({
			label,
			setVerb: "set",
			desired: values,
			set: (id, value) => kiloConfig.setEntry(section, sourceId, id, value as KiloConfigEntry),
			listOwned: () => kiloConfig.listOwnedEntryIds(section, sourceId),
			remove: (id) => kiloConfig.removeEntry(section, sourceId, id),
		});
		return [
			{
				label: "Kilo plugin",
				setVerb: "install",
				desired: desired.plugins,
				set: (id, value) => pluginConfig.install(sourceId, id, value as string),
				listOwned: () => pluginConfig.listOwnedPluginIds(sourceId),
				remove: (id) => pluginConfig.remove(sourceId, id),
			},
			{
				label: "skill",
				setVerb: "install",
				desired: desired.skills,
				set: (id, value) => skillConfig.install(sourceId, id, value as string),
				listOwned: () => skillConfig.listOwnedSkillIds(sourceId),
				remove: (id) => skillConfig.remove(sourceId, id),
			},
			entries("mcp", "MCP server", desired.mcpEntries),
			entries("agent", "agent", desired.agents),
			entries("command", "command", desired.commands),
		];
	}

	async #reconcile(sourceId: string, desired: KiloConfigurationState): Promise<void> {
		const parts = this.#parts(sourceId, desired);
		const errors: string[] = [];
		let changed = false;
		const apply = async (
			part: Part,
			id: string,
			action: "set" | "remove",
			run: () => Promise<AnyOutcome>,
		) => {
			let effect: Effect;
			try {
				effect = effectOf(await run(), action);
			} catch (error) {
				effect = { error: error instanceof Error ? error.message : String(error) };
			}
			if (effect === "changed") changed = true;
			else if (effect === "conflict") {
				this.#warnOnce(
					`Left ${part.label} "${id}" alone for "${sourceId}": that name is already taken in Kilo's config.`,
				);
			} else if (effect !== "unchanged") {
				const verb = action === "set" ? part.setVerb : "remove";
				errors.push(`Could not ${verb} Desktop-owned ${part.label} "${id}": ${effect.error}`);
			}
		};
		try {
			for (const part of parts) {
				for (const [id, value] of Object.entries(part.desired)) {
					// Sequential: every set edits the same config file.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					await apply(part, id, "set", () => part.set(id, value));
				}
			}
			for (const part of parts) {
				// Sequential: every part lists from the same config file.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const owned = await part.listOwned().catch((error: unknown) => {
					errors.push(`Could not list ${part.label}s: ${String(error)}`);
					return [];
				});
				for (const id of owned) {
					if (Object.hasOwn(part.desired, id)) continue;
					// Sequential: every remove edits the same config file.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					await apply(part, id, "remove", () => part.remove(id));
				}
			}
		} finally {
			if (changed) this.#options.onChanged();
		}
		if (errors.length > 0) throw new Error(errors.join("\n"));
	}

	#warnOnce(message: string): void {
		if (this.#warned.has(message)) return;
		this.#warned.add(message);
		this.#options.logger?.warn(message);
	}
}
