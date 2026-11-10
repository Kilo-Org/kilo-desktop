import { definePlugin, KernelTelemetry, mainHost } from "@kilo-desktop/kernel";

import { Greetings, type GreetingsState } from "../contracts";

interface SavedGreetings extends GreetingsState, Record<string, unknown> {}

/**
 * example.hello's main entry: provides the greetings, saved in this plugin's
 * own kv store so they survive a restart, and reports each greeting as the
 * `greeted` telemetry event it declares (sent only with the user's consent,
 * and only to the telemetry sinks installed). Everything registered through
 * `sdk` is removed when the plugin deactivates.
 */
export const helloMainEntry = definePlugin({
	activate(sdk) {
		const store = mainHost(sdk).storage.kv<SavedGreetings>({
			namespace: "greetings",
			defaults: { count: 0, last: null },
		});
		const saved = (): GreetingsState => {
			const { count, last } = store.snapshot();
			return { count, last };
		};

		const greetings = sdk.domainObjects.provide(Greetings, {
			initialState: saved(),
			methods: {
				greet: ({ name }) => {
					store.set({ count: greetings.state.count + 1, last: name });
					greetings.setState(saved());
					greetings.emit("greeted", { name });
					void sdk.domainObjects.get(KernelTelemetry)?.methods.track({ event: "greeted" });
					return `Hello, ${name}!`;
				},
				reset: () => {
					store.set({ count: 0, last: null });
					greetings.setState(saved());
				},
			},
		});
	},
});
