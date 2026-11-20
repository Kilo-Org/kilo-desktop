import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";

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

async function readIfPresent(filePath: string): Promise<Buffer | undefined> {
	try {
		return await readFile(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/**
 * Owns serialized installation of Desktop-provided Kilo plugins. Ownership is
 * embedded in each generated file rather than kept in a second file, so a
 * crash cannot leave the plugin and its ownership record out of sync. Only an
 * exact source marker permits updates, removal, or source-scoped discovery;
 * user-created files are never claimed. Writes are atomic so Kilo cannot import
 * a partially copied bundle. The directory is Desktop's managed plugin
 * directory (see `managed-kilo-plugins.ts`), never a Kilo config `plugin/`
 * folder, and bundles are copied out of the app so Kilo can read them outside
 * asar.
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
			const destinationPath = path.join(this.#pluginDirectory, `anaconda-${pluginId}.js`);
			const existing = await readIfPresent(destinationPath);
			if (existing && !isOwnedBy(existing, sourceId, pluginId)) {
				return {
					kind: "skipped-error",
					reason: `plugin file is not owned by ${sourceId}`,
				};
			}
			const source = await readFile(sourcePath);
			const next = Buffer.concat([Buffer.from(marker), source]);
			if (existing?.equals(next)) return { kind: "skipped", reason: "up-to-date" };

			await mkdir(this.#pluginDirectory, { recursive: true });
			await atomicWriteFile(destinationPath, next);
			return { kind: "written", reason: existing ? "updated" : "created" };
		});
	}

	remove(sourceId: string, pluginId: string): Promise<KiloPluginMutationOutcome> {
		return this.#enqueue(async () => {
			const validationError =
				validateId("source id", sourceId) ?? validateId("plugin id", pluginId);
			if (validationError) return { kind: "skipped-error", reason: validationError };

			const destinationPath = path.join(this.#pluginDirectory, `anaconda-${pluginId}.js`);
			const existing = await readIfPresent(destinationPath);
			if (!existing) return { kind: "skipped", reason: "nothing-to-remove" };
			if (!isOwnedBy(existing, sourceId, pluginId)) {
				return { kind: "skipped", reason: "not-owned" };
			}
			await unlink(destinationPath);
			return { kind: "removed", reason: "explicit" };
		});
	}

	listOwnedPluginIds(sourceId: string): Promise<readonly string[]> {
		return this.#enqueue(async () => {
			const validationError = validateId("source id", sourceId);
			if (validationError) throw new Error(validationError);
			let filenames: string[];
			try {
				filenames = await readdir(this.#pluginDirectory);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw error;
			}

			const ownedPluginIds: string[] = [];
			for (const filename of filenames.sort()) {
				const match = /^anaconda-(.+)\.js$/.exec(filename);
				const pluginId = match?.[1];
				if (!pluginId || validateId("plugin id", pluginId)) continue;
				// A handful of small files, read in sorted order.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const contents = await readIfPresent(path.join(this.#pluginDirectory, filename));
				if (!contents) continue;
				if (isOwnedBy(contents, sourceId, pluginId)) {
					ownedPluginIds.push(pluginId);
				}
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
