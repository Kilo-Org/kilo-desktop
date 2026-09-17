import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

const PRE_BUILT_IN_PLUGIN_IDS = new Set(["kilo-server", "kilo-ui"]);

/**
 * Boot order within the prerequisites. kilo-server registers before kilo-ui:
 * kilo-ui's boot-time session-cleanup retry resolves kilo-server's
 * connectionService lazily, and kilo-ui's workspaceService is the boot
 * prerequisite of the built-in workspace watcher.
 */
const PREREQUISITE_BOOT_ORDER = ["kilo-server", "kilo-ui"];

/**
 * Order main-process registrations whose capabilities are boot prerequisites
 * ahead of built-in features, while preserving relative order everywhere else.
 *
 * `anaconda-mcp` is built in and persists managed configuration before Kilo's
 * first lazy spawn during its initial reconcile. Kilo must therefore expose
 * its capability before built-ins boot. `kilo-ui` exposes the workspace
 * service the built-in workspace watcher lists at boot — without this
 * ordering, workspaces persisted in earlier sessions would go unwatched
 * until the user's next workspace CRUD event.
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
	// Stable: promoted features without declared order keep input order.
	prerequisites.sort(
		(left, right) =>
			PREREQUISITE_BOOT_ORDER.indexOf(left.id) - PREREQUISITE_BOOT_ORDER.indexOf(right.id),
	);

	return [...prerequisites, ...builtInFeatures, ...remainingPlugins];
}
