import * as Sentry from "@sentry/electron/renderer";
import { tanstackRouterBrowserTracingIntegration } from "@sentry/react";

import { router } from "@/router";

Sentry.init({
	integrations: [tanstackRouterBrowserTracingIntegration(router)],
});
