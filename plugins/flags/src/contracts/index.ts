import { z } from "zod";

import { defineDomain, type PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * kilo.flags' public surface. Flags are read two ways: the Flags domain
 * object (every value, for code), and `kilo.flags/flag:<key>` context keys
 * (true while a flag is `true`, for `when`).
 */
export const FLAGS_PLUGIN_ID = "kilo.flags";

/** The context key that is true while `flag` is on, for `when` and `useContextKey`. */
export function flagKey(flag: string): `kilo.flags/flag:${string}` {
	return `kilo.flags/flag:${flag}`;
}

/** Every feature flag's current value. `ready` turns true once LaunchDarkly has answered. */
export const Flags = defineDomain({
	id: "kilo.flags/flags",
	home: "main",
	state: z.object({
		flags: z.record(z.string(), z.unknown()),
		ready: z.boolean(),
	}),
});

export const FLAGS_DEFINITIONS: PluginDefinitions = { domains: [Flags] };
