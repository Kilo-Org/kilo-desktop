import { describe, expect, it } from "vitest";

import { resolveAnacondaMcpUrl } from "./anacondaMcpUrl.js";

describe("resolveAnacondaMcpUrl", () => {
	it("derives the default URL from the resolved site domain", () => {
		expect(resolveAnacondaMcpUrl(null, "anaconda.com")).toEqual({
			ok: true,
			url: "https://anaconda.com/api/mcp",
		});
		expect(resolveAnacondaMcpUrl(null, "stage.anaconda.com")).toEqual({
			ok: true,
			url: "https://stage.anaconda.com/api/mcp",
		});
	});

	it("derives the default for a self-hosted host:port domain", () => {
		expect(resolveAnacondaMcpUrl(null, "localhost:8443")).toEqual({
			ok: true,
			url: "https://localhost:8443/api/mcp",
		});
	});

	it("treats a blank/whitespace override as no override", () => {
		expect(resolveAnacondaMcpUrl("   ", "anaconda.com")).toEqual({
			ok: true,
			url: "https://anaconda.com/api/mcp",
		});
	});

	it("accepts an override whose host equals the site domain", () => {
		expect(resolveAnacondaMcpUrl("https://stage.anaconda.com/mcp", "stage.anaconda.com")).toEqual({
			ok: true,
			url: "https://stage.anaconda.com/mcp",
		});
	});

	it("accepts a same-host override with a different path", () => {
		expect(resolveAnacondaMcpUrl("https://anaconda.com/custom/path", "anaconda.com")).toEqual({
			ok: true,
			url: "https://anaconda.com/custom/path",
		});
	});

	it("normalizes host case and a trailing dot", () => {
		expect(resolveAnacondaMcpUrl("https://ANACONDA.COM/api/mcp", "anaconda.com").ok).toBe(true);
		expect(resolveAnacondaMcpUrl("https://anaconda.com./api/mcp", "anaconda.com").ok).toBe(true);
	});

	it("accepts a self-hosted override on the matching host:port", () => {
		expect(resolveAnacondaMcpUrl("https://localhost:8443/api/mcp", "localhost:8443").ok).toBe(true);
	});

	it("rejects an override whose host differs from the site domain", () => {
		const result = resolveAnacondaMcpUrl("https://evil.example.com/mcp", "anaconda.com");
		expect(result.ok).toBe(false);
	});

	it("rejects a host-suffix spoof (anaconda.com.evil.com)", () => {
		expect(resolveAnacondaMcpUrl("https://anaconda.com.evil.com/mcp", "anaconda.com").ok).toBe(
			false,
		);
	});

	it("rejects a self-hosted override on a different port", () => {
		expect(resolveAnacondaMcpUrl("https://localhost:9000/api/mcp", "localhost:8443").ok).toBe(
			false,
		);
	});

	it("rejects a non-https override", () => {
		expect(resolveAnacondaMcpUrl("http://anaconda.com/api/mcp", "anaconda.com").ok).toBe(false);
	});

	it("rejects an override that embeds credentials", () => {
		// Host here is `evil.com` (userinfo is `anaconda.com`) — both guards apply.
		expect(resolveAnacondaMcpUrl("https://anaconda.com@evil.com/mcp", "anaconda.com").ok).toBe(
			false,
		);
		expect(resolveAnacondaMcpUrl("https://user:pass@anaconda.com/mcp", "anaconda.com").ok).toBe(
			false,
		);
	});

	it("rejects non-web schemes and relative/garbage input", () => {
		expect(resolveAnacondaMcpUrl("javascript:alert(1)", "anaconda.com").ok).toBe(false);
		expect(resolveAnacondaMcpUrl("file:///etc/passwd", "anaconda.com").ok).toBe(false);
		expect(resolveAnacondaMcpUrl("not a url", "anaconda.com").ok).toBe(false);
	});

	it("fails closed when the site domain is empty", () => {
		expect(resolveAnacondaMcpUrl(null, "").ok).toBe(false);
		expect(resolveAnacondaMcpUrl("https://anaconda.com/api/mcp", "").ok).toBe(false);
	});
});
