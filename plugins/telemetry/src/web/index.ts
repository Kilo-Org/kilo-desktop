import { ShieldIcon } from "lucide-react";

import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkStyleOnboarding } from "@kilo-desktop/plugin-agent/contracts";
import { Navigation, SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { Telemetry } from "../contracts";
import { PrivacySettings } from "./PrivacySettings";

/**
 * Origin's paths for the main window's routes, so "Page Visit" continues
 * origin's series: origin redirected "/" to its chat page `/plugins/chat`
 * (sessions opened within it by search params, as they now open in the home
 * view). `/settings/<section>` kept its section ids. The workspace board was
 * `/plugins/workspace-board`; it is now a sessions view of the home page, so
 * it reports `/plugins/chat` (its "Workspace Board Opened" event marks it).
 */
const ORIGIN_PATHS: Readonly<Record<string, string>> = { "/": "/plugins/chat" };

function originPath(path: string): string {
	return ORIGIN_PATHS[path] ?? path;
}

function track(sdk: PluginSdk, event: string, data: Record<string, unknown> = {}): void {
	void sdk.domains
		.get(Telemetry)
		?.methods.track({ event, data })
		.catch(() => {});
}

/** Reports "Page Visit" whenever the main window's path changes. */
function trackPageVisits(sdk: PluginSdk): void {
	let stop: (() => void) | undefined;
	sdk.domains.track(Navigation, {
		added(navigation) {
			let lastPath: string | undefined;
			const visit = ({ path }: { path: string }) => {
				if (path === lastPath) return;
				lastPath = path;
				track(sdk, "Page Visit", { path: originPath(path) });
			};
			visit(navigation.getState());
			stop = navigation.subscribe(visit);
		},
		removed() {
			stop?.();
			stop = undefined;
		},
	});
	sdk.onDispose(() => stop?.());
}

/**
 * Reports kilo.agent's work-style onboarding step (it lives in the main
 * window), so kilo.agent need not depend on telemetry.
 */
function trackWorkStyleOnboarding(sdk: PluginSdk): void {
	let stops: (() => void)[] = [];
	const stop = () => {
		for (const unsubscribe of stops) unsubscribe();
		stops = [];
	};
	sdk.domains.track(WorkStyleOnboarding, {
		added(onboarding) {
			stops = [
				onboarding.on("shown", () => track(sdk, "Work Style Onboarding Shown")),
				onboarding.on("selected", ({ style }) => track(sdk, "Work Style Selected", { style })),
			];
		},
		removed: stop,
	});
	sdk.onDispose(stop);
}

/** kilo.telemetry's renderer entry: the Privacy settings and the main window's reports. */
export const telemetryWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, "privacy", {
			component: PrivacySettings,
			icon: ShieldIcon,
		});
		if (sdk.context.get("kernel/secondaryWindow")) return;
		trackPageVisits(sdk);
		trackWorkStyleOnboarding(sdk);
	},
});
