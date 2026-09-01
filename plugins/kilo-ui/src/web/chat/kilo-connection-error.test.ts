import { describe, expect, it } from "vitest";

import { isStaleKiloConnectionError, shouldRetryStaleKiloQuery } from "./kilo-connection-error.js";

describe("isStaleKiloConnectionError", () => {
	it("is true for dropped or unauthorized Kilo connections", () => {
		expect(isStaleKiloConnectionError(new Error("Unauthorized"))).toBe(true);
		expect(isStaleKiloConnectionError(new Error("fetch failed: ECONNREFUSED"))).toBe(true);
		expect(isStaleKiloConnectionError("Failed to fetch")).toBe(true);
		expect(isStaleKiloConnectionError(new Error("Failed to fetch (127.0.0.1:52515)"))).toBe(true);
	});

	it("is true when Kilo returns 503 while restarting after a provider config change", () => {
		expect(
			isStaleKiloConnectionError(
				new Error(
					"kilo server GET http://127.0.0.1:55341/provider?directory=%2Fruntime → 503 Service Unavailable: (empty response body)",
				),
			),
		).toBe(true);
		expect(isStaleKiloConnectionError(new Error("503 Service Unavailable"))).toBe(true);
	});

	it("is false for local model preparation failures", () => {
		expect(isStaleKiloConnectionError(new Error("The local model could not be prepared."))).toBe(
			false,
		);
		expect(isStaleKiloConnectionError(new Error("Failed to create Kilo session."))).toBe(false);
	});
});

describe("shouldRetryStaleKiloQuery", () => {
	it("retries 503s a few times and leaves other failures to the caller", () => {
		const unavailable = new Error(
			"kilo server GET http://127.0.0.1:55341/provider → 503 Service Unavailable: (empty response body)",
		);
		expect(shouldRetryStaleKiloQuery(0, unavailable)).toBe(true);
		expect(shouldRetryStaleKiloQuery(2, unavailable)).toBe(true);
		expect(shouldRetryStaleKiloQuery(3, unavailable)).toBe(false);
		expect(shouldRetryStaleKiloQuery(0, new Error("Failed to fetch"))).toBe(false);
		expect(shouldRetryStaleKiloQuery(0, new Error("The local model could not be prepared."))).toBe(
			false,
		);
	});
});
