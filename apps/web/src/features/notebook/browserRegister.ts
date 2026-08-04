import { notebookContract, type NotebookService } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Standalone browser mode has no main process, so there is no loopback relay
 * and no daemon socket. Reporting "no relay, no daemon" is more honest than
 * leaving the channel unregistered, which the view could only render as a
 * generic service failure.
 */
export function notebookBrowserRegister(mainSdk: MainSdk): void {
	const service: NotebookService = {
		status: async () => ({ relayPort: 0, daemon: null }),
	};
	mainSdk.channels(notebookContract).handleAll(service);
}
