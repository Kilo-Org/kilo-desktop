import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";
import { sdkProducerContract } from "@anaconda-agentic-desktop/contracts";

import { NoteService } from "./NoteService.js";

/**
 * Main-process registration for the sdk-producer feature.
 * Demonstrates: mainSdk.channels(contract).handleAll(...), mainSdk.onDispose()
 *
 * Input and output schemas from the contract are validated at the routing
 * boundary — handlers receive already-parsed args and return raw output.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const service = new NoteService();
	mainSdk.plugins.expose("notesService", {
		count: () => service.list().length,
	});

	mainSdk.channels(sdkProducerContract).handleAll({
		list: () => service.list(),
		add: (input) => {
			const note = service.add(input.text);
			mainSdk.events.emit("note-added", { id: note.id, text: note.text });
			return note;
		},
		delete: (input) => service.delete(input.id),
		clear: () => service.clear(),
		echo: (input) => service.echo(input.message),
	});

	mainSdk.onDispose(() => {
		// Cleanup: in a real feature this would close DB handles, cancel timers, etc.
		console.info("[sdk-producer] Feature disposed");
	});
}
