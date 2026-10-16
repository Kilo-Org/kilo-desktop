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
//
// SDK v11's unset `dataCollection` collects everything, so pin the v10
// `sendDefaultPii: false` baseline here too (it limits what the renderer
// attaches before forwarding). Mirrors DATA_COLLECTION in the main process
// (apps/desktop/src/main/platform/sentry.ts).
const HEADER_DENYLIST = ["forwarded", "-ip", "remote-", "via", "-user"];

if (isDesktopBridgeAvailable()) {
	init(
		{
			integrations: [tanstackRouterBrowserTracingIntegration(router)],
			dataCollection: {
				userInfo: false,
				cookies: false,
				httpHeaders: { request: { deny: HEADER_DENYLIST }, response: { deny: HEADER_DENYLIST } },
				httpBodies: [],
				urlQueryParams: { deny: HEADER_DENYLIST },
				genAI: { inputs: false, outputs: false },
				databaseQueryData: false,
				graphQL: { document: false, variables: false },
			},
		},
		reactInit,
	);
}
