import { readFile } from "node:fs/promises";
import path from "node:path";

import {
	listManagedKiloPlugins,
	readManagedKiloPlugin,
	removeManagedKiloPlugin,
	writeManagedKiloPlugin,
} from "./managed-kilo-plugins.js";

export type KiloPluginMutationOutcome =
	| { readonly kind: "written"; readonly reason: "created" | "updated" }
	| { readonly kind: "removed"; readonly reason: "explicit" }
	| { readonly kind: "skipped"; readonly reason: "up-to-date" | "nothing-to-remove" | "not-owned" }
	| { readonly kind: "skipped-error"; readonly reason: string };

const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function validateId(label: string, value: string): string | undefined {
	if (!SAFE_ID.test(value)) return `${label} must be a lowercase filesystem-safe id`;
	return undefined;
}

function pluginDirectoryName(pluginId: string): string {
	return `anaconda-${pluginId}`;
}

function ownershipMarker(sourceId: string, pluginId: string): string {
	return `// Kilo Desktop managed plugin: ${sourceId}/${pluginId}\n`;
}

/**
 * Origin named a plugin's source by its short id (`notebook`); kernel plugins
 * contribute as `kilo.notebook`, which adopts the files origin installed.
 */
function originSourceId(sourceId: string): string | undefined {
	return sourceId.startsWith("kilo.") ? sourceId.slice("kilo.".length) : undefined;
}

function isOwnedBy(contents: Buffer, sourceId: string, pluginId: string): boolean {
	const origin = originSourceId(sourceId);
	return [sourceId, ...(origin ? [origin] : [])].some((owner) => {
		const marker = ownershipMarker(owner, pluginId);
		return contents.toString("utf8", 0, Buffer.byteLength(marker)) === marker;
	});
}

/**
 * Owns serialized installation of Desktop-provided Kilo plugins. Ownership is
 * embedded in each generated file rather than kept in a second file, so a
 * crash cannot leave the plugin and its ownership record out of sync. Only an
 * exact source marker permits updates, removal, or source-scoped discovery;
 * user-created files are never claimed. Each plugin is the directory
 * `anaconda-<pluginId>/` in Desktop's managed plugin directory (see
 * `managed-kilo-plugins.ts`), written atomically so Kilo cannot import a
 * partially copied bundle; bundles are copied out of the app so Kilo can read
 * them outside asar.
 */
export class KiloPluginConfig {
	readonly #pluginDirectory: string;
	#pending: Promise<void> = Promise.resolve();

	constructor(pluginDirectory: string) {
		this.#pluginDirectory = pluginDirectory;
	}

	install(
		sourceId: string,
		pluginId: string,
		sourcePath: string,
	): Promise<KiloPluginMutationOutcome> {
		return this.#enqueue(async () => {
			const validationError =
				validateId("source id", sourceId) ?? validateId("plugin id", pluginId);
			if (validationError) return { kind: "skipped-error", reason: validationError };
			if (!path.isAbsolute(sourcePath)) {
				return { kind: "skipped-error", reason: "plugin source path must be absolute" };
			}

			const marker = ownershipMarker(sourceId, pluginId);
			const name = pluginDirectoryName(pluginId);
			const existing = await readManagedKiloPlugin(this.#pluginDirectory, name);
			if (existing && !isOwnedBy(existing, sourceId, pluginId)) {
				return {
					kind: "skipped-error",
					reason: `plugin file is not owned by ${sourceId}`,
				};
			}
			const source = await readFile(sourcePath);
			const next = Buffer.concat([Buffer.from(marker), source]);
			if (!(await writeManagedKiloPlugin(this.#pluginDirectory, name, next))) {
				return { kind: "skipped", reason: "up-to-date" };
			}
			return { kind: "written", reason: existing ? "updated" : "created" };
		});
	}

	remove(sourceId: string, pluginId: string): Promise<KiloPluginMutationOutcome> {
		return this.#enqueue(async () => {
			const validationError =
				validateId("source id", sourceId) ?? validateId("plugin id", pluginId);
			if (validationError) return { kind: "skipped-error", reason: validationError };

			const name = pluginDirectoryName(pluginId);
			const existing = await readManagedKiloPlugin(this.#pluginDirectory, name);
			if (!existing) return { kind: "skipped", reason: "nothing-to-remove" };
			if (!isOwnedBy(existing, sourceId, pluginId)) {
				return { kind: "skipped", reason: "not-owned" };
			}
			await removeManagedKiloPlugin(this.#pluginDirectory, name);
			return { kind: "removed", reason: "explicit" };
		});
	}

	listOwnedPluginIds(sourceId: string): Promise<readonly string[]> {
		return this.#enqueue(async () => {
			const validationError = validateId("source id", sourceId);
			if (validationError) throw new Error(validationError);
			const ownedPluginIds: string[] = [];
			for (const directory of await listManagedKiloPlugins(this.#pluginDirectory)) {
				const match = /^anaconda-(.+)$/.exec(directory.slice(this.#pluginDirectory.length + 1));
				const pluginId = match?.[1];
				if (!pluginId || validateId("plugin id", pluginId)) continue;
				// Ownership is checked one plugin at a time; there are only a handful.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const contents = await readManagedKiloPlugin(
					this.#pluginDirectory,
					pluginDirectoryName(pluginId),
				);
				if (contents && isOwnedBy(contents, sourceId, pluginId)) ownedPluginIds.push(pluginId);
			}
			return ownedPluginIds;
		});
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#pending.then(operation, operation);
		this.#pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
