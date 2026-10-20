import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";

import { LocalApiError } from "@kilo-desktop/contracts";

import { createDesktopQueryClient } from "./client";

vi.mock("@sentry/react", () => ({
	getClient: () => ({}),
	captureException: vi.fn(),
}));

describe("createDesktopQueryClient", () => {
	beforeEach(() => {
		vi.mocked(Sentry.captureException).mockClear();
	});

	it("retries once for TRANSPORT and INTERNAL LocalApiError", () => {
		const client = createDesktopQueryClient();
		const retry = client.getDefaultOptions().queries?.retry;
		expect(typeof retry).toBe("function");
		if (typeof retry !== "function") return;

		expect(retry(0, new LocalApiError("TRANSPORT", "boom"))).toBe(true);
		expect(retry(0, new LocalApiError("INTERNAL", "boom"))).toBe(true);
		expect(retry(1, new LocalApiError("TRANSPORT", "boom"))).toBe(false);
		expect(retry(0, new LocalApiError("VALIDATION", "nope"))).toBe(false);
		expect(retry(0, new Error("other"))).toBe(false);
	});

	it("disables mutation retries", () => {
		const client = createDesktopQueryClient();
		expect(client.getDefaultOptions().mutations?.retry).toBe(false);
	});

	it("logs every query error once through the shared query cache", async () => {
		const client = createDesktopQueryClient();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				client.fetchQuery({
					queryKey: ["boom"],
					queryFn: () => Promise.reject(new Error("nope")),
				}),
			).rejects.toThrow("nope");

			expect(errorSpy).toHaveBeenCalledWith('[query] ["boom"]', expect.any(Error));
		} finally {
			errorSpy.mockRestore();
			client.clear();
		}
	});

	it("captures a query error to Sentry when a client is configured", async () => {
		const client = createDesktopQueryClient();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				client.fetchQuery({
					queryKey: ["boom"],
					queryFn: () => Promise.reject(new Error("nope")),
				}),
			).rejects.toThrow("nope");

			expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(expect.any(Error), {
				tags: { queryKey: '["boom"]' },
			});
		} finally {
			errorSpy.mockRestore();
			client.clear();
		}
	});

	it("keeps an opted-out query's expected error out of Sentry", async () => {
		const client = createDesktopQueryClient();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				client.fetchQuery({
					queryKey: ["quiet"],
					meta: { reportToSentry: false },
					queryFn: () => Promise.reject(new Error("expected")),
				}),
			).rejects.toThrow("expected");

			expect(errorSpy).toHaveBeenCalledWith('[query] ["quiet"]', expect.any(Error));
			expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
		} finally {
			errorSpy.mockRestore();
			client.clear();
		}
	});
});
