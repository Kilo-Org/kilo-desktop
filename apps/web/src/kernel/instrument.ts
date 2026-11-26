import { init } from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";

import { getKernelBridge } from "./bridge";

// Renderer events are sent through the main process, so dsn and environment
// passed here have no effect. The release is the one the Sentry Vite plugin
// injects at build time (vite.config.ts). Standalone browser mode has no main
// process to receive them, so Sentry is skipped there.
//
// Pins the `sendDefaultPii: false` baseline; mirrors DATA_COLLECTION in the
// main process (apps/desktop/src/main/platform/sentry.ts). Every renderer
// event, span and log leaves through main, whose `beforeSend` and transport
// redact credentials; here console breadcrumbs are dropped at the source,
// because logged text is free-form and stays in the local log.
const HEADER_DENYLIST = ["forwarded", "-ip", "remote-", "via", "-user"];

if (getKernelBridge()) {
	init(
		{
			dataCollection: {
				userInfo: false,
				cookies: false,
				httpHeaders: { request: { deny: HEADER_DENYLIST }, response: { deny: HEADER_DENYLIST } },
				httpBodies: [],
				urlQueryParams: { deny: HEADER_DENYLIST },
				genAI: { inputs: false, outputs: false },
				databaseQueryData: false,
				graphQL: { document: false, variables: false },
				stackFrameVariables: false,
			},
			beforeBreadcrumb: (breadcrumb) => (breadcrumb.category === "console" ? null : breadcrumb),
		},
		reactInit,
	);
}
