// Telemetry for kilo.chat's tests: a sink that records what was sent, and
// the consent that lets it flow (as kilo.work-sessions' test host does).
import {
	definePlugin,
	KernelDataCollection,
	KernelTelemetrySink,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import type { MainKernel } from "@kilo-desktop/kernel/main";
import { testManifest } from "@kilo-desktop/kernel/testing";
import type { GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import { CHAT_PLUGIN_ID } from "../contracts";

/** A telemetry sink, so a test sees the events sent. */
export function telemetrySink() {
	const delivered: Pick<TelemetryEnvelope, "key" | "name" | "data">[] = [];
	const plugin: GuestPlugin = {
		manifest: testManifest("test.telemetry-sink", {
			contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
		}),
		main: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: ({ key, name, data }) => void delivered.push({ key, name, data }),
				});
			},
		}),
	};
	return {
		plugin,
		/** The data of every delivered kilo.chat event with this id. */
		events: (id: string) =>
			delivered.filter(({ key }) => key === `${CHAT_PLUGIN_ID}/${id}`).map(({ data }) => data),
	};
}

/** Lets telemetry flow (the person agreed to data collection). */
export function grantDataCollection(main: MainKernel): void {
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "test" },
		methods: { setChoice: () => {} },
	});
}
