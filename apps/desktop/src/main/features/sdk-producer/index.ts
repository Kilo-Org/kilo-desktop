import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";
import {
	addNoteInput,
	clearNotesInput,
	deleteNoteInput,
	echoInput,
	listNotesInput,
} from "@anaconda-agentic-desktop/contracts";

import { NoteService } from "./NoteService.js";

/**
 * Main-process registration for the sdk-producer feature.
 * Demonstrates: mainSdk.handle(channel, schema, handler), mainSdk.onDispose()
 *
 * The input schema validates args at the routing boundary BEFORE the handler
 * runs — handlers receive already-parsed, typed args.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const service = new NoteService();

	mainSdk.handle("list", listNotesInput, () => service.list());

	mainSdk.handle("add", addNoteInput, (input) => service.add(input.text));

	mainSdk.handle("delete", deleteNoteInput, (input) => service.delete(input.id));

	mainSdk.handle("clear", clearNotesInput, () => service.clear());

	mainSdk.handle("echo", echoInput, (input) => service.echo(input.message));

	mainSdk.onDispose(() => {
		// Cleanup: in a real feature this would close DB handles, cancel timers, etc.
		console.info("[sdk-producer] Feature disposed");
	});
}
