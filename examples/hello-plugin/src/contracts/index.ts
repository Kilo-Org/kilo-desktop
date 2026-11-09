import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * example.hello's public surface: what other plugins may import. Here, one
 * domain object other plugins can read, call and listen to.
 */
export const HELLO_PLUGIN_ID = "example.hello";

export const greetingsStateSchema = z.object({
	count: z.number().int().min(0),
	/** Who was greeted last; null before the first greeting. */
	last: z.string().nullable(),
});
export type GreetingsState = z.output<typeof greetingsStateSchema>;

/** The greetings said so far, kept in main and shared by every window. */
export const Greetings = defineDomain({
	id: "example.hello/greetings",
	home: "main",
	state: greetingsStateSchema,
	methods: {
		/** Greets `name` and returns the greeting. */
		greet: method(z.object({ name: z.string().trim().min(1).max(100) }), z.string()),
		reset: method(z.undefined(), z.undefined()),
	},
	events: {
		greeted: z.object({ name: z.string() }),
	},
});

/** What the kernel needs to know about this plugin without running it. */
export const HELLO_DEFINITIONS: PluginDefinitions = { domains: [Greetings] };
