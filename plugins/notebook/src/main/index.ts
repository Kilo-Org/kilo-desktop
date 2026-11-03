import { createRequire } from "node:module";
import path from "node:path";

import { createNotebookMainEntry } from "./entry.js";
import { ElectronNotebookHostService } from "./runtime/ElectronNotebookHostService.js";
import type { OpenTelemetryRegistration } from "./runtime/NotebookTelemetryPermission.js";
import { translateAsarToUnpackedPath } from "./runtimed-node.js";

export { createNotebookMainEntry } from "./entry.js";

async function openNativeTrustSession(notebookId: string, socketPath: string) {
	// Loaded on demand: the native addon is only needed while the setting is on.
	const { openNotebook } = await import("@runtimed/node");
	return openNotebook(notebookId, { socketPath, peerLabel: "kilo-desktop:trust" });
}

const openNativeTelemetryRegistration: OpenTelemetryRegistration = async (options) => {
	// The CJS root spreads native exports, which only appear on import's default.
	// Its declarations omit that default, so the native API is feature-detected.
	const { default: runtime } = (await import("@runtimed/node")) as unknown as {
		default: { openTelemetryRegistration?: OpenTelemetryRegistration };
	};
	return typeof runtime.openTelemetryRegistration === "function"
		? runtime.openTelemetryRegistration(options)
		: null;
};

function runtimedNodeEntry(): string | undefined {
	try {
		return translateAsarToUnpackedPath(createRequire(import.meta.url).resolve("@runtimed/node"));
	} catch {
		return undefined;
	}
}

/**
 * kilo.notebook's main entry: nteract's host service over `@runtimed/node`,
 * and origin's storage (a sibling plugin folder, `plugins/notebook`) as the
 * one-time source of its settings.
 */
export const notebookMainEntry = createNotebookMainEntry({
	createHostService: (options) => new ElectronNotebookHostService(options),
	resolveRuntimedNodeEntry: runtimedNodeEntry,
	openTrustSession: openNativeTrustSession,
	openTelemetryRegistration: openNativeTelemetryRegistration,
	originStorageDir: (storageDir) => path.join(storageDir, "..", "notebook"),
});
