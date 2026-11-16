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
 * - Env-var proxies (`HTTP(S)_PROXY`/`NO_PROXY`) are read from `process.env` on
 *   every request: the bootstrap installs the patch before the login shell's
 *   environment (via `shell-env`) arrives, and the resolver would otherwise
 *   keep the values it saw when created.
 * - This is a monkey-patch of process-global singletons for the process
 *   lifetime; there is nothing to tear down.
 */
const environmentProxy = (env: NodeJS.ProcessEnv = process.env) =>
	env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || undefined;

const environmentNoProxy = (env: NodeJS.ProcessEnv = process.env) =>
	(env.no_proxy || env.NO_PROXY || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

export function installProxyAgent(): void {
	const logger = createLogger("proxy-agent");
	const require = createRequire(import.meta.url);
	const http = require("node:http") as typeof httpType;
	const https = require("node:https") as typeof httpsType;

	// `@vscode/proxy-agent`'s `Log` interface requires a `trace` level that our
	// scoped `electron-log` logger does not expose. Adapt it here — at the one
	// foreign consumer — instead of widening the shell-wide logger type. `trace`
	// is the noisiest level, so route it to `debug`.
	const proxyLog = { ...logger, trace: (...args: unknown[]) => logger.debug(...args) };

	const params: ProxyAgentParams = {
		resolveProxy: (url) => session.defaultSession.resolveProxy(url),
		getProxyURL: environmentProxy,
		getProxySupport: () => "on",
		getNoProxyConfig: environmentNoProxy,
		isAdditionalFetchSupportEnabled: () => true,
		isWebSocketPatchEnabled: () => false,
		addCertificatesV1: () => false,
		addCertificatesV2: () => false,
		loadSystemCertificatesFromNode: () => false,
		loadAdditionalCertificates: async () => [],
		log: proxyLog,
		getLogLevel: () => LogLevel.Info,
		proxyResolveTelemetry: () => {},
		isUseHostProxyEnabled: () => true,
		// Read live through getProxyURL/getNoProxyConfig instead.
		env: {},
	};

	const { resolveProxyWithRequest, resolveProxyURL } = createProxyResolver(params);
	Object.assign(http, createHttpPatch(params, http, resolveProxyWithRequest));
	Object.assign(https, createHttpPatch(params, https, resolveProxyWithRequest));
	globalThis.fetch = createFetchPatch(params, globalThis.fetch, resolveProxyURL);
}
