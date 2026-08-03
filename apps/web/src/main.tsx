import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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
import { router } from "@/router";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Renderer root element was not found.");

const localApi = createLocalApi();
const featureSystem = createAppFeatureSystem(
	localApi,
	WEB_FEATURES,
	createRouterNavigation(router),
);

// Mount plugins' declarative zone widgets (contributes.zones) once at boot so
// they persist across navigation — distinct from page-scoped sdk.contribute.
registerPluginZoneContributions(featureSystem, PLUGIN_ZONE_CONTRIBUTIONS, {
	desktopAvailable: isDesktopBridgeAvailable(),
});

createRoot(root).render(
	<StrictMode>
		<AppProviders localApi={localApi} system={featureSystem} />
	</StrictMode>,
);
