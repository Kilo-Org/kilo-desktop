import { describe, expect, it, vi } from "vitest";

// Electron is mocked per-file in this package's unit tests (see
// ElectronProtocol.test.ts); createContentSecurityPolicy itself uses none of it.
vi.mock("electron", () => ({
	net: { fetch: vi.fn() },
	protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn(), unhandle: vi.fn() },
}));

import { createContentSecurityPolicy } from "./ElectronProtocol.js";

function scriptSrc(csp: string): string {
	return (
		csp
			.split(";")
			.map((directive) => directive.trim())
			.find((directive) => directive.startsWith("script-src")) ?? "(none)"
	);
}

// CSP semantics: 'unsafe-inline' is ignored by the browser whenever a hash or
// nonce source is also present in the same directive. So injected inline script
// executes only when 'unsafe-inline' is present AND no hash/nonce is.
function inlineScriptAllowed(csp: string): boolean {
	const directive = scriptSrc(csp);
	return /'unsafe-inline'/.test(directive) && !/'sha(256|384|512)-|'nonce-/.test(directive);
}

describe("CSP regression guard — inline script in the trusted app renderer", () => {
	it("refuses injected inline script in the production app origin", () => {
		// The production app origin holds the `desktopApi` preload bridge, so an
		// injected inline script (content injection / XSS) must NOT execute there.
		// This is the point of the hash-pinned CSP: if 'unsafe-inline' were reintroduced
		// without a hash/nonce, an injected <script> would run with preload
		// capability. Asserting (not logging) so CI fails on that regression.
		const prod = createContentSecurityPolicy();
		expect(inlineScriptAllowed(prod)).toBe(false);
		expect(scriptSrc(prod)).not.toContain("'unsafe-inline'");
	});

	it("pins shipped inline scripts by sha256 instead of allowing 'unsafe-inline'", () => {
		// The strict policy still runs the app's own inline scripts — it emits a
		// per-response 'sha256-…' for each one rather than opening the origin up.
		// A present hash with no 'unsafe-inline' is what keeps boot working while
		// injected inline script stays blocked.
		const withHashes = createContentSecurityPolicy(undefined, ["Zm9vYmFy"]);
		expect(/'sha256-/.test(scriptSrc(withHashes))).toBe(true);
		expect(inlineScriptAllowed(withHashes)).toBe(false);
	});
});
