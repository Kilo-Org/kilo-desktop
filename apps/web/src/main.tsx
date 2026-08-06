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
import { installWebMcp } from "@/platform/webmcp/installWebMcp";
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

// Publish the ToolRegistry to document.modelContext and start the local relay
// bridge for external MCP clients. Tools are owned by plugins: each plugin's
// `webRegister` (invoked by createFeatureSystem) registers its own tools via
// `sdk.tools`, and this bridge auto-picks them up through the registry's
// change notifications (see issue #74).
installWebMcp(featureSystem);

createRoot(root).render(
	<StrictMode>
		<AppProviders localApi={localApi} system={featureSystem} />
	</StrictMode>,
);
