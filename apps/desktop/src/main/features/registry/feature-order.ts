import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

const PRE_BUILT_IN_PLUGIN_IDS = new Set(["kilo-server"]);

/**
 * Order main-process registrations whose capabilities are boot prerequisites
 * ahead of built-in features, while preserving relative order everywhere else.
 *
 * `anaconda-mcp` is built in and persists managed configuration before Kilo's
 * first lazy spawn during its initial reconcile. Kilo must therefore expose
 * its capability before built-ins boot.
 */
export function orderMainFeatures(
	builtInFeatures: readonly FeatureRegistration[],
	pluginFeatures: readonly FeatureRegistration[],
): readonly FeatureRegistration[] {
	const prerequisites: FeatureRegistration[] = [];
	const remainingPlugins: FeatureRegistration[] = [];

	for (const feature of pluginFeatures) {
		if (PRE_BUILT_IN_PLUGIN_IDS.has(feature.id)) {
			prerequisites.push(feature);
		} else {
			remainingPlugins.push(feature);
		}
	}

	return [...prerequisites, ...builtInFeatures, ...remainingPlugins];
}
