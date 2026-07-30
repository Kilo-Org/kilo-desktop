import type { FeatureRegistration, MainSdk } from "@anaconda-agentic-desktop/feature-sdk";
import {
	sdkConsumerContract,
	sdkProducerContract,
	type Note,
} from "@anaconda-agentic-desktop/contracts";

/**
 * Feature registrations used when the app runs standalone in a browser
 * (no Electron main process). Mirrors the desktop FEATURES array in
 * apps/desktop/src/main/features/registry/features.ts — keep both in sync.
 *
 * Only browserRegister boots in this mode; features without one are skipped
 * with a warning. Node-free features opt in with `browserRegister: register`;
 * features whose mainRegister uses Node APIs (SQLite, fs, ...) must provide
 * browser-safe fakes.
 */

/** Browser-safe in-memory implementation of the sdk-producer feature. */
function sdkProducerBrowserRegister(mainSdk: MainSdk): void {
	let notes: Note[] = [];

	mainSdk.channels(sdkProducerContract).handleAll({
		list: () => [...notes],
		add: (input) => {
			const note: Note = { id: crypto.randomUUID(), text: input.text, createdAt: Date.now() };
			notes.push(note);
			return note;
		},
		delete: (input) => {
			const before = notes.length;
			notes = notes.filter((n) => n.id !== input.id);
			return { deleted: notes.length < before };
		},
		clear: () => {
			const count = notes.length;
			notes = [];
			return { count };
		},
		echo: (input) => ({
			echoed: `[sdk-producer] ${input.message}`,
			timestamp: Date.now(),
		}),
	});
}

/** sdk-consumer has a trivial ping handler (no Node deps). */
function sdkConsumerBrowserRegister(mainSdk: MainSdk): void {
	mainSdk.channels(sdkConsumerContract).handleAll({
		ping: () => ({ pong: true as const, from: "sdk-consumer" }),
	});
}

export const WEB_FEATURES: readonly FeatureRegistration[] = [
	{
		id: "sdk-producer",
		mainRegister: sdkProducerBrowserRegister,
		browserRegister: sdkProducerBrowserRegister,
	},
	{
		id: "sdk-consumer",
		mainRegister: sdkConsumerBrowserRegister,
		browserRegister: sdkConsumerBrowserRegister,
	},
];
