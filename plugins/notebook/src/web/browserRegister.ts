import { notebookContract, type NotebookService } from "../contracts/schemas.js";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Standalone browser mode has no main process, so there is no loopback relay
 * and no daemon socket. Reporting "no relay, no daemon" is more honest than
 * leaving the channel unregistered, which the view could only render as a
 * generic service failure.
 */
export function notebookBrowserRegister(mainSdk: MainSdk): void {
	const service: NotebookService = {
		status: async () => ({
			availability: { status: "unavailable" },
			process: {
				status: "failed",
				reason: "The notebook runtime daemon is unavailable in browser mode.",
			},
			daemon: null,
		}),
		save: async () => ({
			outcome: "failed",
			reason: "Saving notebooks is unavailable in browser mode.",
		}),
		setDefaultSaveDirectory: async () => undefined,
	};
	mainSdk.channels(notebookContract).handleAll(service);
}
