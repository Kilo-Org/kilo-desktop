import path from "node:path";

/**
 * Built-in host adapter. Plugin migration replaces this with
 * `mainSdk.resolvePluginAsset("resources/kilo")` and leaves installation resolution unchanged.
 */
export function getBuiltInKiloResourceRoots(): readonly string[] {
	return [
		path.join(process.resourcesPath, "kilo"),
		path.resolve(import.meta.dirname, "../../src/main/features/kilo-code/resources/kilo"),
	];
}
