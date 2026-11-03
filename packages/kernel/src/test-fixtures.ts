import type { PluginDefinitions, PluginEntry, PluginRegistration } from "./plugin";

/** Builds a minimal valid manifest for tests. */
export function testManifest(id: string, extra: Record<string, unknown> = {}) {
	return { manifestVersion: 1, id, displayName: id, version: "1.0.0", ...extra };
}

export function testPlugin(
	id: string,
	options: {
		readonly manifest?: Record<string, unknown>;
		readonly definitions?: PluginDefinitions;
		readonly entry?: PluginEntry;
	} = {},
): PluginRegistration {
	return {
		manifest: testManifest(id, options.manifest),
		...(options.definitions ? { definitions: options.definitions } : {}),
		...(options.entry ? { entry: options.entry } : {}),
	};
}
