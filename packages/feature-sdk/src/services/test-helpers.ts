import { z } from "zod";

import { defineMethod } from "../channel-map.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { CommandRegistry } from "./command-registry.js";
import { ContributionRegistry } from "./contribution-registry.js";
import { EventBus } from "./event-bus.js";
import { FeatureRouter } from "./feature-router.js";
import { StateBroker } from "./state-broker.js";
import type { ShellDelegates } from "./create-sdk.js";

export const noop = () => {};

export const testChannels = {
	list: defineMethod(z.undefined(), z.array(z.unknown())),
	greet: defineMethod(z.object({ name: z.string() }), z.string()),
	yes: defineMethod(z.undefined(), z.string()),
	create: defineMethod(z.object({ title: z.string().min(1) }), z.string()),
	local: defineMethod(z.undefined(), z.string()),
	fail: defineMethod(z.undefined(), z.unknown()),
} as const;

export function makeServices(featureRouter = new FeatureRouter()) {
	const shellDelegates: ShellDelegates = {
		notifications: {
			show: () => ({ delivered: true }),
			setBadge: () => ({ delivered: true }),
		},
		theme: {
			subscribe: (fn) => {
				fn("light");
				return noop;
			},
			peek: () => "light",
		},
		shell: { openExternal: async () => ({ opened: true }), copyText: async () => undefined },
		fs: {
			readFile: async () => "",
			writeFile: async () => undefined,
			exists: async () => false,
			mkdir: async () => undefined,
			readdir: async () => [],
			remove: async () => undefined,
		},
	};

	return {
		eventBus: new EventBus(),
		stateBroker: new StateBroker(),
		capabilityRegistry: new CapabilityRegistry(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter,
		shellDelegates,
	};
}
