import { init } from "@sentry/electron/renderer";
import { tanstackRouterBrowserTracingIntegration, init as reactInit } from "@sentry/react";

import { router } from "@/router";

// All renderer events are sent through the main process so passing dsn,
// release or environment to renderer init will have no effect.
init(
	{
		integrations: [tanstackRouterBrowserTracingIntegration(router)],
	},
	reactInit,
);
