import {
	EXTERNAL_PLUGINS_CHANNEL,
	type KernelLogger,
	type PluginDefinitions,
	type PluginEntry,
	type PluginRegistration,
	type WindowExternalPlugin,
} from "@kilo-desktop/kernel";

const defaultImport = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

/**
 * Registrations for the local plugins main loaded this launch: their
 * contracts and window entry, imported from the app origin (main serves the
 * bytes the user approved). A plugin whose modules fail to load here is left
 * out of this window and reported; the rest still run.
 */
export async function externalPluginRegistrations(options: {
	readonly request: (channel: string, payload: unknown) => Promise<unknown>;
	readonly logger: Pick<KernelLogger, "error">;
	readonly importModule?: (url: string) => Promise<unknown>;
}): Promise<PluginRegistration[]> {
	const importModule = options.importModule ?? defaultImport;
	let plugins: unknown;
	try {
		plugins = await options.request(EXTERNAL_PLUGINS_CHANNEL, null);
	} catch (error) {
		options.logger.error("Couldn't list local plugins", error);
		return [];
	}
	if (!Array.isArray(plugins)) return [];
	const loaded = await Promise.all(
		(plugins as WindowExternalPlugin[]).map(async (plugin) => {
			try {
				const definitions = plugin.contracts
					? definitionsOf(await importModule(plugin.contracts))
					: undefined;
				const entry = plugin.web ? entryOf(await importModule(plugin.web)) : undefined;
				return {
					manifest: plugin.manifest,
					source: "external" as const,
					...(definitions ? { definitions } : {}),
					...(entry ? { entry } : {}),
				};
			} catch (error) {
				const id = (plugin.manifest as { id?: unknown } | null)?.id;
				options.logger.error(`Local plugin "${String(id)}" failed to load in this window`, error);
				return undefined;
			}
		}),
	);
	return loaded.filter((registration) => registration !== undefined);
}

function definitionsOf(module: unknown): PluginDefinitions {
	const exports = module as { definitions?: unknown; default?: unknown } | null;
	const definitions = exports?.definitions ?? exports?.default ?? {};
	if (typeof definitions !== "object" || definitions === null) {
		throw new Error("Its contracts module must export `definitions`.");
	}
	return definitions as PluginDefinitions;
}

function entryOf(module: unknown): PluginEntry {
	const entry = (module as { default?: unknown } | null)?.default;
	if (typeof (entry as PluginEntry | undefined)?.activate !== "function") {
		throw new Error("Its web entry must default-export a plugin entry with `activate`.");
	}
	return entry as PluginEntry;
}
