import { createRequire } from "node:module";
import type * as httpType from "node:http";
import type * as httpsType from "node:https";

import { session } from "electron";
import {
	createFetchPatch,
	createHttpPatch,
	createProxyResolver,
	LogLevel,
	type ProxyAgentParams,
} from "@vscode/proxy-agent";

import { createLogger } from "./logger.js";

/**
 * Patch the in-process Node networking stack (`node:http`, `node:https`, and
 * global `fetch`) so third-party dependencies that use native networking honor
 * corporate/system proxies, mirroring VS Code's `@vscode/proxy-agent` wiring.
 *
 * Scope / caveats:
 * - Affects in-process Node networking ONLY. The spawned `kilo` binary is a
 *   separate OS process and is not covered.
 * - App-authored main-process code uses Electron `net.fetch` (already
 *   proxy-aware) and never touches `http`/`https`/global `fetch`, so this patch
 *   is a no-op for it — it exists purely for third-party deps.
 * - `getProxySupport: "on"` means the patch activates only when a caller did NOT
 *   supply its own custom `agent`/`dispatcher`; it is additive, not fighting.
 * - Env-var proxies (`HTTP(S)_PROXY`/`NO_PROXY`) come from `process.env`, which
 *   the bootstrap sequence populates from the login shell (via `shell-env`).
 * - This is a monkey-patch of process-global singletons for the process
 *   lifetime; there is nothing to tear down.
 */
export function installProxyAgent(): void {
	const logger = createLogger("proxy-agent");
	const require = createRequire(import.meta.url);
	const http = require("node:http") as typeof httpType;
	const https = require("node:https") as typeof httpsType;

	const params: ProxyAgentParams = {
		resolveProxy: (url) => session.defaultSession.resolveProxy(url),
		getProxyURL: () => undefined,
		getProxySupport: () => "on",
		getNoProxyConfig: () => [],
		isAdditionalFetchSupportEnabled: () => true,
		isWebSocketPatchEnabled: () => false,
		addCertificatesV1: () => false,
		addCertificatesV2: () => false,
		loadSystemCertificatesFromNode: () => false,
		loadAdditionalCertificates: async () => [],
		log: logger,
		getLogLevel: () => LogLevel.Info,
		proxyResolveTelemetry: () => {},
		isUseHostProxyEnabled: () => true,
		env: process.env,
	};

	const { resolveProxyWithRequest, resolveProxyURL } = createProxyResolver(params);
	Object.assign(http, createHttpPatch(params, http, resolveProxyWithRequest));
	Object.assign(https, createHttpPatch(params, https, resolveProxyWithRequest));
	globalThis.fetch = createFetchPatch(params, globalThis.fetch, resolveProxyURL);
}
