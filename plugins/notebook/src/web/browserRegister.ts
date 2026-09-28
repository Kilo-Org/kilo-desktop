import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk";

import {
	DEFAULT_NOTEBOOK_SETTINGS,
	notebookContract,
	type NotebookService,
	type NotebookSettings,
} from "../contracts/schemas.js";

/**
 * Standalone browser mode has no main process, so there is no loopback relay
 * and no daemon socket. Reporting "no relay, no daemon" is more honest than
 * leaving the channel unregistered, which the view could only render as a
 * generic service failure.
 */
export function notebookBrowserRegister(mainSdk: MainSdk): void {
	// Browser mode has no persistent storage; settings last for the page's lifetime.
	let settings: NotebookSettings = { ...DEFAULT_NOTEBOOK_SETTINGS };
	const service: NotebookService = {
		status: async () => ({
			availability: { status: "unavailable" },
			process: {
				status: "failed",
				reason: "The notebook runtime daemon is unavailable in browser mode.",
			},
			daemon: null,
		}),
		openFile: async () => {
			throw new FeatureError("Opening notebook files is unavailable in browser mode.", "BUSINESS");
		},
		save: async () => ({
			outcome: "failed",
			reason: "Saving notebooks is unavailable in browser mode.",
		}),
		setDefaultSaveDirectory: async () => undefined,
		getSettings: async () => settings,
		updateSettings: async (patch) => {
			settings = {
				autoCreateEnvironmentFile:
					patch.autoCreateEnvironmentFile ?? settings.autoCreateEnvironmentFile,
				trustNewNotebooks: patch.trustNewNotebooks ?? settings.trustNewNotebooks,
			};
			return settings;
		},
		// No filesystem in browser mode, and no daemon to discover a file anyway.
		prepareEnvironment: async () => ({ outcome: "skipped" }),
	};
	mainSdk.channels(notebookContract).handleAll(service);
}
