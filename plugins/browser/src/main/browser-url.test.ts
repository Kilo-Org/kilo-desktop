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

	it("rejects malformed and unsupported URLs without returning the raw input", () => {
		expect(() => normalizeBrowserUrl("ftp://user:secret@example.com/file")).toThrow(
			"Only HTTP and HTTPS URLs are supported.",
		);
		expect(() => normalizeBrowserUrl("https://user:secret@example.com:bad/token")).toThrow(
			"Enter a valid URL.",
		);
	});
});
