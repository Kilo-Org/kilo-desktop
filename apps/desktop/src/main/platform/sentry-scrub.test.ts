import { describe, expect, it } from "vitest";

import { redactPiiString, scrubSentryEvent } from "./sentry-scrub.js";

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
		expect(redactPiiString("C:\\Users\\dave\\z.log", "/Users/alice")).toBe(
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
});
