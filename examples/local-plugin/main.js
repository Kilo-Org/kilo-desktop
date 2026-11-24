// Runs in Electron's main process with the app's privileges.
import { definePlugin, mainHost } from "@kilo-desktop/kernel";

import { Counter } from "./contracts.js";

export default definePlugin({
	activate(sdk) {
		const store = mainHost(sdk).storage.kv({ namespace: "counter", defaults: { count: 0 } });
		const counter = sdk.domainObjects.provide(Counter, {
			initialState: { count: store.get("count") },
			methods: {
				increment: () => {
					const count = counter.state.count + 1;
					store.set({ count });
					counter.setState({ count });
					return count;
				},
			},
		});
	},
});
