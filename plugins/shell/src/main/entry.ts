import { definePlugin, type PluginEntry, type PluginSdk } from "@kilo-desktop/kernel";

import { provideAppearance } from "./appearance";
import { provideLegal, type LegalResources } from "./legal";
import { provideNavigation } from "./navigation";
import { provideNotifications } from "./notifications";
import { provideOnboarding, type OnboardingOptions } from "./onboarding";
import { provideReading, type ReadingOptions } from "./reading";
import { originPath, shellTelemetry, trackOnboarding } from "./telemetry";

export interface ShellMainOptions extends OnboardingOptions {
	/** The legal documents shipped beside the app; none when omitted. */
	readonly legalResources?: (sdk: PluginSdk) => LegalResources;
	readonly reading?: ReadingOptions;
}

const NO_LEGAL_RESOURCES: LegalResources = { locate: () => null, read: async () => null };

/** kilo.shell's main-process entry; Node file access is injected so test hosts can run in a browser. */
export function createShellMainEntry(options: ShellMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const track = shellTelemetry(sdk);
			provideAppearance(sdk);
			provideReading(sdk, track, options.reading);
			provideOnboarding(sdk, options);
			trackOnboarding(sdk, track);
			provideNavigation(sdk, {
				onPathChanged: (_windowId, path) => track("page-visit", { path: originPath(path) }),
			});
			provideNotifications(sdk);
			provideLegal(sdk, options.legalResources?.(sdk) ?? NO_LEGAL_RESOURCES);
		},
	});
}
