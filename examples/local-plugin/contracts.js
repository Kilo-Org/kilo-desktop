// The plugin's definitions, loaded in main and in every window. `zod` and
// `@kilo-desktop/kernel` are shared by the app: never bundle them.
import { z } from "zod";
import { defineDomainObject, method } from "@kilo-desktop/kernel";

export const Counter = defineDomainObject({
	id: "example.local-hello/counter",
	home: "main",
	state: z.object({ count: z.number().int().min(0) }),
	methods: {
		/** Counts one more and returns the new count. */
		increment: method(z.undefined(), z.number().int()),
	},
});

/** What the kernel needs to know about this plugin without running it. */
export const definitions = { domainObjects: [Counter] };
