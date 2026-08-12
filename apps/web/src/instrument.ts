import { init } from "@sentry/electron/renderer";
import { tanstackRouterBrowserTracingIntegration, init as reactInit } from "@sentry/react";

import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";
import { router } from "@/router";

// All renderer events are sent through the main process so passing dsn,
// release or environment to renderer init will have no effect.
//
// In standalone-browser mode (no Electron shell) there is no main process to
// receive these events, so we skip Sentry entirely. Standalone is only used for
// UI testing and has no browser DSN configured.
if (isDesktopBridgeAvailable()) {
	init(
		{
			integrations: [tanstackRouterBrowserTracingIntegration(router)],
		},
		reactInit,
	);
}
