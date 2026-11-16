import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";

import { Greetings } from "../contracts";

/**
 * example.hello's renderer entry, run in every window: binds code to the
 * contributions its manifest declares (by the same local ids).
 */
export const helloWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(KernelCommand, "say-hello", async () => {
			await sdk.domainObjects.get(Greetings)?.methods.greet({ name: "world" });
		});
	},
});
