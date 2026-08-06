import { createRequire } from "node:module";
import type * as httpType from "node:http";
import type * as httpsType from "node:https";

import { afterEach, describe, expect, it, vi } from "vitest";

const resolveProxy = vi.hoisted(() => vi.fn(async () => "DIRECT"));
vi.mock("electron", () => ({ session: { defaultSession: { resolveProxy } } }));

import { installProxyAgent } from "./proxyAgent.js";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof httpType;
const https = require("node:https") as typeof httpsType;

// Snapshot the process-global singletons this monkey-patch mutates so each test
// starts (and the suite ends) with pristine networking.
const originalHttpRequest = http.request;
const originalHttpGet = http.get;
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;
const originalFetch = globalThis.fetch;

afterEach(() => {
	http.request = originalHttpRequest;
	http.get = originalHttpGet;
	https.request = originalHttpsRequest;
	https.get = originalHttpsGet;
	globalThis.fetch = originalFetch;
	vi.clearAllMocks();
});

describe("installProxyAgent", () => {
	it("patches http and https request/get and replaces global fetch", () => {
		installProxyAgent();

		expect(http.request).not.toBe(originalHttpRequest);
		expect(http.get).not.toBe(originalHttpGet);
		expect(https.request).not.toBe(originalHttpsRequest);
		expect(https.get).not.toBe(originalHttpsGet);
		expect(globalThis.fetch).not.toBe(originalFetch);
		expect(typeof globalThis.fetch).toBe("function");
	});

	it("delegates proxy resolution to the default session", async () => {
		installProxyAgent();

		// The patched fetch runs the resolver, which calls session.resolveProxy.
		await globalThis.fetch("http://example.test/").catch(() => undefined);

		expect(resolveProxy).toHaveBeenCalledWith("http://example.test/");
	});
});
