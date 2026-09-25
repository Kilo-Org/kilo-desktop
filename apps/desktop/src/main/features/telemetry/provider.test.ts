import { describe, expect, it, vi } from "vitest";

import { PostHogProvider } from "./provider.js";
import type { TelemetryConfig, TelemetryEntry } from "./types.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const baseConfig: TelemetryConfig = {
	posthogKey: "phc_test",
	posthogHost: "https://us.i.posthog.com",
	environment: "preview",
	serviceId: "kilo-desktop",
	serviceVersion: "1.2.3",
};

function entry(overrides: Partial<TelemetryEntry> = {}): TelemetryEntry {
	return {
		event: "Desktop Initialized",
		data: { foo: "bar" },
		installationId: "install-1",
		appRunId: "run-1",
		isEmployee: false,
		...overrides,
	};
}

function fakeFetch() {
	const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			url: String(input),
			init: init ?? {},
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
		});
		return new Response("ok", { status: 200 });
	});
	return { calls, fetchMock };
}

function provider(
	config: TelemetryConfig = baseConfig,
	fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
	return new PostHogProvider({
		config,
		logger: silentLogger,
		...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
	});
}

describe("PostHogProvider", () => {
	it("suppresses sends and never initializes the client in development", async () => {
		const { fetchMock } = fakeFetch();
		const p = provider({ ...baseConfig, environment: "development" }, fetchMock);

		await p.track(entry());
		await p.dispose();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("captures an anonymous event against the installation id with base props", async () => {
		const { calls, fetchMock } = fakeFetch();
		await provider(baseConfig, fetchMock).track(entry());

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://us.i.posthog.com/batch/");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.body).toEqual({
			api_key: "phc_test",
			batch: [
				{
					event: "Desktop Initialized",
					distinct_id: "install-1",
					properties: expect.objectContaining({
						foo: "bar",
						installationId: "install-1",
						appRunId: "run-1",
						appName: "kilo-desktop",
						appVersion: "1.2.3",
						platform: process.platform,
						os_version: expect.any(String),
						os_arch: process.arch,
						environment: "preview",
						is_anaconda_employee: false,
					}),
					timestamp: expect.any(String),
				},
			],
		});
	});

	it("captures an identified event against the email with identity properties", async () => {
		const { calls, fetchMock } = fakeFetch();
		await provider(baseConfig, fetchMock).track(
			entry({ email: "dev@anaconda.com", isEmployee: true, cohortId: 42 }),
		);

		expect(calls).toHaveLength(1);
		const events = calls[0]?.body.batch as Array<Record<string, unknown>>;
		const captured = events.find((event) => event.event === "Desktop Initialized");
		expect(captured).toMatchObject({
			event: "Desktop Initialized",
			distinct_id: "dev@anaconda.com",
		});
		expect(captured?.properties).toMatchObject({
			is_anaconda_employee: true,
			cohortId: 42,
		});
	});

	it("identifies on the anonymous-to-identified transition", async () => {
		const { calls, fetchMock } = fakeFetch();
		const p = provider(baseConfig, fetchMock);

		await p.track(entry());
		await p.track(entry({ email: "dev@anaconda.com", cohortId: 42 }));

		expect(calls).toHaveLength(2);
		const events = calls.flatMap((call) => call.body.batch as Array<Record<string, unknown>>);
		expect(events[0]).toMatchObject({ event: "Desktop Initialized", distinct_id: "install-1" });
		expect(events[1]).toMatchObject({
			event: "$identify",
			distinct_id: "dev@anaconda.com",
			properties: {
				$set: { email: "dev@anaconda.com", cohortId: 42, is_anaconda_employee: false },
			},
		});
		expect(events[2]).toMatchObject({
			event: "Desktop Initialized",
			distinct_id: "dev@anaconda.com",
		});
	});

	it("never merges the shared installation persona into a user", async () => {
		const { calls, fetchMock } = fakeFetch();
		const p = provider(baseConfig, fetchMock);

		await p.track(entry());
		await p.track(entry({ email: "dev@anaconda.com" }));
		await p.track(entry());
		await p.track(entry({ email: "other@example.com" }));

		const events = calls.flatMap((call) => call.body.batch as Array<Record<string, unknown>>);
		const merges = events.filter(
			(event) => event.event === "$create_alias" || event.event === "$merge_dangerously",
		);
		expect(merges).toEqual([]);
	});

	it("identifies the new account when switching between two signed-in users", async () => {
		const { calls, fetchMock } = fakeFetch();
		const p = provider(baseConfig, fetchMock);

		await p.track(entry({ email: "a@example.com", cohortId: 1 }));
		await p.track(entry({ email: "b@example.com", cohortId: 2 }));

		const events = calls.flatMap((call) => call.body.batch as Array<Record<string, unknown>>);
		const identifies = events.filter((event) => event.event === "$identify");
		expect(identifies).toHaveLength(2);
		expect(identifies[1]).toMatchObject({
			distinct_id: "b@example.com",
			properties: { $set: { email: "b@example.com", cohortId: 2 } },
		});
	});

	it("lowercases the email in the identify person properties too", async () => {
		const { calls, fetchMock } = fakeFetch();
		await provider(baseConfig, fetchMock).track(entry({ email: "Dev@Anaconda.COM" }));

		const events = calls[0]?.body.batch as Array<Record<string, unknown>>;
		const identify = events.find((event) => event.event === "$identify");
		expect(identify?.properties).toEqual({
			$set: { email: "dev@anaconda.com", is_anaconda_employee: false },
		});
	});

	it("does not repeat identify for a stable identity", async () => {
		const { calls, fetchMock } = fakeFetch();
		const p = provider(baseConfig, fetchMock);

		await p.track(entry());
		await p.track(entry({ email: "dev@anaconda.com" }));
		await p.track(entry({ email: "dev@anaconda.com" }));

		expect(calls).toHaveLength(3);
		const identifyCount = calls
			.flatMap((call) => call.body.batch as Array<Record<string, unknown>>)
			.filter((event) => event.event === "$identify");
		expect(identifyCount).toHaveLength(1);
	});

	it("falls back to the installation id when logging out", async () => {
		const { calls, fetchMock } = fakeFetch();
		const p = provider(baseConfig, fetchMock);

		await p.track(entry());
		await p.track(entry({ email: "dev@anaconda.com" }));
		await p.track(entry());

		expect(calls).toHaveLength(3);
		const events = calls.flatMap((call) => call.body.batch as Array<Record<string, unknown>>);
		expect(events.at(-1)).toMatchObject({
			event: "Desktop Initialized",
			distinct_id: "install-1",
		});
	});

	it("lowercases the email so the distinct id is case-insensitive", async () => {
		const { calls, fetchMock } = fakeFetch();
		await provider(baseConfig, fetchMock).track(entry({ email: "Dev@Anaconda.COM" }));

		const events = calls[0]?.body.batch as Array<Record<string, unknown>>;
		const captured = events.find((event) => event.event === "Desktop Initialized");
		expect(captured?.distinct_id).toBe("dev@anaconda.com");
	});

	it("never throws when the capture request fails", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("offline");
		});

		await expect(provider(baseConfig, fetchMock).track(entry())).resolves.toBeUndefined();
	});

	it("never throws on a non-2xx response", async () => {
		const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));

		await expect(provider(baseConfig, fetchMock).track(entry())).resolves.toBeUndefined();
	});

	it("waits for in-flight captures on dispose", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fetchMock = vi.fn(async () => {
			await gate;
			return new Response("ok", { status: 200 });
		});
		const p = provider(baseConfig, fetchMock);

		const tracking = p.track(entry());
		let disposed = false;
		const disposing = p.dispose().then(() => {
			disposed = true;
		});

		await Promise.resolve();
		expect(disposed).toBe(false);
		release?.();
		await Promise.all([tracking, disposing]);
		expect(disposed).toBe(true);
	});
});
