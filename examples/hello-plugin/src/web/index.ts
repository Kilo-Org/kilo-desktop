import { HandIcon } from "lucide-react";

import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { Greetings } from "../contracts";
import { HelloSettings } from "./HelloSettings";

/**
 * example.hello's renderer entry, run in every window: binds code to the
 * contributions its manifest declares (by the same local ids).
 */
export const helloWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, "hello", {
			component: HelloSettings,
			icon: HandIcon,
		});
		sdk.extensions.implement(KernelCommand, "say-hello", async () => {
			await sdk.domains.get(Greetings)?.methods.greet({ name: "world" });
		});
	},
});
