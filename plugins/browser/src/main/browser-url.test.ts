import { describe, expect, it } from "vitest";

import { normalizeBrowserUrl } from "./browser-url.js";

describe("normalizeBrowserUrl", () => {
	it("uses HTTP for loopback hosts and HTTPS for public hosts", () => {
		expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
		expect(normalizeBrowserUrl("127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
		expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
	});

	it("preserves valid explicit HTTP URLs", () => {
		expect(normalizeBrowserUrl("https://example.com/path?q=1")).toBe(
			"https://example.com/path?q=1",
		);
	});

	it("accepts workspace file URLs, which the host authorizes per request", () => {
		expect(normalizeBrowserUrl("kilo-file://local/Users/me/project/Chart%20one.html")).toBe(
			"kilo-file://local/Users/me/project/Chart%20one.html",
		);
		expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
	});

	it("rejects malformed and unsupported URLs without returning the raw input", () => {
		expect(() => normalizeBrowserUrl("ftp://user:secret@example.com/file")).toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
		expect(() => normalizeBrowserUrl("https://user:secret@example.com:bad/token")).toThrow(
			"Enter a valid URL.",
		);
	});
});
