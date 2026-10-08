import "./instrument";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";

import "./globals.css";
import { AppProviders } from "@/app/AppProviders";
import { WEB_FEATURES } from "@/features/features";
import {
	PLUGIN_ZONE_CONTRIBUTIONS,
	registerPluginZoneContributions,
} from "@/features/plugin-zones";
import { createLocalApi } from "@/platform/createLocalApi";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";
import { createAppFeatureSystem } from "@/platform/featureSystem";
import { createRouterNavigation } from "@/platform/navigation";
import { startToolCatalogPublisher } from "@/platform/agent-tools/tool-catalog-publisher";
import { router } from "@/router";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Renderer root element was not found.");

const localApi = createLocalApi();
const featureSystem = createAppFeatureSystem(
	localApi,
	WEB_FEATURES,
	createRouterNavigation(router),
);

// Hold one app-lifetime auth subscription so the renderer's session cache is
// resolved at boot and kept current by main's pushes. Without it the cache
// stays at its seeded `anonymous` until a Kilo-gated page mounts, so the first
// gated visit per launch can't trust a signed-in session and has to wait.
featureSystem.services.shellDelegates.auth.subscribe(() => undefined);

// Mount plugins' declarative zone widgets (contributes.zones) once at boot so
// they persist across navigation — distinct from page-scoped sdk.contribute.
registerPluginZoneContributions(featureSystem, PLUGIN_ZONE_CONTRIBUTIONS, {
	desktopAvailable: isDesktopBridgeAvailable(),
});
// Publish the ToolRegistry to the main process, which serves it to the bundled
// Kilo CLI and to paired external AI apps. Tools are owned by plugins: each
// plugin's `webRegister` (invoked by createFeatureSystem) registers its own
// tools via `sdk.tools`, and the publisher picks them up through the
// registry's change notifications.
// Pane windows must not become a second tool producer — opening a notebook
// (or any UI-local tool) from a popped-out chat would mutate that window's
// store, and the main canvas would never see the pane.
if (localApi.shell.windowRole !== "pane") {
	startToolCatalogPublisher(featureSystem);
}

createRoot(root, {
	// @ts-expect-error -- reactErrorHandler types ErrorInfo against React 18 (componentStack: string|null); React 19 uses string|undefined
	onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
		console.warn("Uncaught error", error, errorInfo.componentStack);
	}),
	// @ts-expect-error -- same React 18/19 ErrorInfo mismatch
	onCaughtError: Sentry.reactErrorHandler(),
	onRecoverableError: Sentry.reactErrorHandler(),
}).render(
	<StrictMode>
		<AppProviders localApi={localApi} system={featureSystem} />
	</StrictMode>,
);
