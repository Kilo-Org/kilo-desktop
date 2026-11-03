import { definePlugin, type PluginEntry } from "@kilo-desktop/kernel";

import { provideAppearance } from "./appearance";
import { provideOnboarding, type OnboardingOptions } from "./onboarding";

/** kilo.shell's main-process entry; Node file access is injected so test hosts can run in a browser. */
export function createShellMainEntry(options: OnboardingOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			provideAppearance(sdk);
			provideOnboarding(sdk, options);
		},
	});
}
