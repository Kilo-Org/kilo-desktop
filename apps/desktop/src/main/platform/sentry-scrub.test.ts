import { describe, expect, it } from "vitest";

import {
	redactPiiString,
	scrubEnvelope,
	type SentryEnvelope,
	scrubSentryBreadcrumb,
	scrubSentryEvent,
} from "./sentry-scrub.js";

// Fake credentials are built at runtime, so no key-shaped literal sits in the source.
const fakeKey = ["sk", "ant", "api03", "FAKE0".repeat(6)].join("-");
const fakeToken = `fake${"TOKEN0".repeat(4)}`;

describe("redactPiiString", () => {
	it("replaces the exact home directory with <home>", () => {
		expect(redactPiiString("/Users/alice/project/app.ts", "/Users/alice")).toBe(
			"<home>/project/app.ts",
		);
	});

	it("redacts a POSIX user-home segment for a different user", () => {
		expect(redactPiiString("/Users/bob/x", "/Users/alice")).toBe("/Users/<redacted>/x");
		expect(redactPiiString("/home/carol/y", "/Users/alice")).toBe("/home/<redacted>/y");
	});

	it("does not leak another user whose name starts with the current home dir", () => {
		// Without a path-boundary anchor, the exact-home replacement would turn this
		// into `<home>smith/data.csv`, leaving part of a real username behind.
		expect(redactPiiString("/Users/alicesmith/data.csv", "/Users/alice")).toBe(
			"/Users/<redacted>/data.csv",
		);
		expect(redactPiiString("/Users/alice.smith/x", "/Users/alice")).toBe("/Users/<redacted>/x");
		expect(redactPiiString("C:\\Users\\AliceB\\x", "C:\\Users\\Alice")).toBe(
			"C:\\Users\\<redacted>\\x",
		);
	});

	it("redacts a Windows user-home segment", () => {
		expect(redactPiiString("C:\\Users\\user\\z.log", "/Users/alice")).toBe(
			"C:\\Users\\<redacted>\\z.log",
		);
		expect(redactPiiString("\\Users\\erin\\z", "/Users/alice")).toBe("\\Users\\<redacted>\\z");
	});

	it("leaves non-PII strings untouched", () => {
		expect(redactPiiString("TypeError: cannot read property", "/Users/alice")).toBe(
			"TypeError: cannot read property",
		);
		expect(redactPiiString("/usr/local/bin/node", "/Users/alice")).toBe("/usr/local/bin/node");
	});

	it("does not over-match when the home dir is root-like", () => {
		expect(redactPiiString("/opt/data", "/")).toBe("/opt/data");
	});
});

describe("scrubSentryEvent", () => {
	it("drops the machine hostname and device name", () => {
		const event = scrubSentryEvent(
			{ server_name: "Janes-MacBook-Pro", contexts: { device: { name: "Janes-MacBook-Pro" } } },
			"/Users/jane",
		);
		expect(event.server_name).toBeUndefined();
		expect((event.contexts.device as { name?: string }).name).toBeUndefined();
	});

	it("keeps only the anonymous user id", () => {
		const event = scrubSentryEvent(
			{
				user: {
					id: "install-1",
					ip_address: "1.2.3.4",
					email: "a@b.com",
					username: "jane",
					name: "Jane Doe",
				},
			},
			"/Users/jane",
		);
		expect(event.user).toEqual({ id: "install-1" });
	});

	it("redacts the OS username from stack frames, exception values, messages, and breadcrumbs", () => {
		const event = scrubSentryEvent(
			{
				message: "failed reading /Users/jane/notebook.ipynb",
				exception: {
					values: [
						{
							value: "ENOENT: /Users/jane/x",
							stacktrace: {
								frames: [
									{ filename: "/Users/jane/app/main.ts", abs_path: "/Users/jane/app/main.ts" },
								],
							},
						},
					],
				},
				breadcrumbs: {
					values: [{ message: "open /Users/jane/file", data: { path: "/Users/jane/f" } }],
				},
			},
			"/Users/jane",
		);
		expect(event.message).toBe("failed reading <home>/notebook.ipynb");
		const frame = event.exception.values[0]?.stacktrace.frames[0];
		expect(frame?.filename).toBe("<home>/app/main.ts");
		expect(frame?.abs_path).toBe("<home>/app/main.ts");
		expect(event.exception.values[0]?.value).toBe("ENOENT: <home>/x");
		expect(event.breadcrumbs.values[0]?.message).toBe("open <home>/file");
		expect(event.breadcrumbs.values[0]?.data.path).toBe("<home>/f");
	});

	it("preserves non-PII fields and returns the same object", () => {
		const input = { event_id: "abc", level: "error", tags: { channel: "stable" } };
		const output = scrubSentryEvent(input, "/Users/jane");
		expect(output).toBe(input);
		expect(output).toMatchObject({ event_id: "abc", level: "error", tags: { channel: "stable" } });
	});

	it("handles cyclic structures without infinite recursion", () => {
		const event: Record<string, unknown> = { message: "/Users/jane/x" };
		event.self = event;
		expect(() => scrubSentryEvent(event, "/Users/jane")).not.toThrow();
		expect(event.message).toBe("<home>/x");
	});

	it("is a no-op for non-object input", () => {
		expect(scrubSentryEvent(null, "/Users/jane")).toBeNull();
	});

	it("redacts credentials quoted in a local server's output", () => {
		const serverOutput = [
			`Error: provider "anthropic" rejected options {"apiKey":"${fakeKey}"}`,
			`request failed: Authorization: Bearer ${fakeToken}`,
			// Assembled so no URL with a password sits in the source.
			["mcp env DATABASE_URL=postgres://app", "fake-password@db.example.test:5432/main"].join(":"),
		].join("\n");
		const event = scrubSentryEvent(
			{
				exception: {
					values: [
						{
							type: "KernelError",
							value: `Kilo server exited before becoming ready (code 1).\n${serverOutput}`,
							stacktrace: {
								frames: [{ function: "start", vars: { password: "fake", stderr: serverOutput } }],
							},
						},
					],
				},
				message: `Unexpected server error: ${serverOutput}`,
				request: { headers: { Authorization: `Bearer ${fakeToken}`, Accept: "*/*" } },
				extra: { apiKey: fakeKey, attempt: 2 },
			},
			"/Users/jane",
		);

		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain("FAKE0");
		expect(serialized).not.toContain("TOKEN0");
		expect(serialized).not.toContain("fake-password");
		const exception = event.exception.values[0];
		expect(exception?.value).toContain("Kilo server exited before becoming ready (code 1).");
		expect(exception?.value).toContain("postgres://[Filtered]@db.example.test:5432/main");
		expect(exception?.stacktrace.frames[0]).toEqual({ function: "start" });
		expect(event.request.headers).toEqual({ Authorization: "[Filtered]", Accept: "*/*" });
		expect(event.extra).toEqual({ apiKey: "[Filtered]", attempt: 2 });
	});

	it("drops console breadcrumbs and redacts credentials in the others", () => {
		const event = scrubSentryEvent(
			{
				breadcrumbs: [
					{
						category: "console",
						level: "error",
						message: "The renderer kernel failed to start",
						data: { arguments: [{ message: "a server log line with an unknown secret" }] },
					},
					{
						category: "fetch",
						type: "http",
						data: {
							method: "GET",
							url: `https://api.example.test/v1/models?api_key=${fakeToken}&page=2`,
							status_code: 401,
						},
					},
				],
			},
			"/Users/jane",
		);

		expect(event.breadcrumbs).toEqual([
			{
				category: "fetch",
				type: "http",
				data: {
					method: "GET",
					url: "https://api.example.test/v1/models?api_key=[Filtered]&page=2",
					status_code: 401,
				},
			},
		]);
	});
});

describe("scrubSentryBreadcrumb", () => {
	it("drops console breadcrumbs", () => {
		expect(
			scrubSentryBreadcrumb({ category: "console", message: "anything" }, "/Users/jane"),
		).toBeNull();
	});

	it("redacts credentials in a breadcrumb message and data", () => {
		expect(
			scrubSentryBreadcrumb(
				{
					category: "electron.net",
					message: `retrying with Bearer ${fakeToken}`,
					data: {
						url: ["https://u", "fake-password@proxy.example.test/"].join(":"),
						token: fakeToken,
					},
				},
				"/Users/jane",
			),
		).toEqual({
			category: "electron.net",
			message: "retrying with Bearer [Filtered]",
			data: { url: "https://[Filtered]@proxy.example.test/", token: "[Filtered]" },
		});
	});
});

describe("scrubEnvelope", () => {
	it("redacts credentials in span names and keeps the attribute shape", () => {
		const envelope = [
			{},
			[
				[
					{ type: "span", item_count: 1 },
					{
						items: [
							{
								name: `POST https://api.example.test/v1/chat?key=${fakeToken}`,
								attributes: {
									"http.request.header.authorization": {
										type: "string",
										value: `Bearer ${fakeToken}`,
									},
									"http.response.status_code": { type: "integer", value: 401 },
								},
							},
						],
					},
				],
			],
		] as unknown as SentryEnvelope;

		scrubEnvelope(envelope, "/Users/jane");

		expect(envelope[1][0]?.[1]).toEqual({
			items: [
				{
					name: "POST https://api.example.test/v1/chat?key=[Filtered]",
					attributes: {
						"http.request.header.authorization": { type: "string", value: "[Filtered]" },
						"http.response.status_code": { type: "integer", value: 401 },
					},
				},
			],
		});
	});

	it("scrubs every item type by default and leaves only binary attachments as they are", () => {
		const minidump = new Uint8Array([1, 2, 3]);
		const envelope = [
			{ trace: { transaction: `GET /v1/models?api_key=${fakeToken}`, public_key: "public" } },
			[
				[
					{ type: "event" },
					{
						message: `failed: Bearer ${fakeToken}`,
						breadcrumbs: [{ category: "console", message: "log text" }],
					},
				],
				[{ type: "transaction" }, { transaction: `GET /v1/models?token=${fakeToken}`, spans: [] }],
				[{ type: "log" }, { items: [{ body: `retry with ${fakeKey}` }] }],
				[{ type: "client_report" }, { discarded_events: [{ reason: `token=${fakeToken}` }] }],
				[{ type: "attachment", filename: "notes.txt" }, `password=${fakeToken}`],
				[{ type: "attachment", filename: "crash.dmp" }, minidump],
			],
		] as unknown as SentryEnvelope;

		scrubEnvelope(envelope, "/Users/jane");

		const serialized = JSON.stringify(envelope);
		expect(serialized).not.toContain("TOKEN0");
		expect(serialized).not.toContain("FAKE0");
		expect(serialized).not.toContain("log text");
		expect(envelope[0]).toEqual({
			trace: { transaction: "GET /v1/models?api_key=[Filtered]", public_key: "public" },
		});
		expect(envelope[1][5]?.[1]).toBe(minidump);
	});

	it("keeps only an attribute's type and value under a credential key", () => {
		const envelope = [
			{},
			[
				[
					{ type: "span" },
					{
						items: [
							{
								attributes: {
									"http.request.header.x-api-key": {
										type: "string",
										value: fakeToken,
										raw: `x-api-key: ${fakeToken}`,
									},
								},
							},
						],
					},
				],
			],
		] as unknown as SentryEnvelope;

		scrubEnvelope(envelope, "/Users/jane");

		expect(envelope[1][0]?.[1]).toEqual({
			items: [
				{
					attributes: {
						"http.request.header.x-api-key": { type: "string", value: "[Filtered]" },
					},
				},
			],
		});
	});
});

describe("scrubSentryEvent limits", () => {
	it("filters a whole `secrets` object", () => {
		const event = scrubSentryEvent(
			{ extra: { secrets: { provider: "acme", apiBase: "plain" }, attempt: 1 } },
			"/Users/jane",
		);
		expect(event.extra).toEqual({ secrets: "[Filtered]", attempt: 1 });
	});

	it("filters values nested past the depth limit instead of sending them raw", () => {
		let nested: Record<string, unknown> = { note: "deepest" };
		for (let level = 0; level < 20; level++) nested = { next: nested };
		const event = scrubSentryEvent({ extra: nested }, "/Users/jane");
		expect(JSON.stringify(event)).not.toContain("deepest");
		expect(JSON.stringify(event)).toContain("[Filtered]");
	});
});
