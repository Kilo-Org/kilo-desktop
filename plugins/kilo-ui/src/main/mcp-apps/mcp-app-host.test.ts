import { describe, expect, it } from "vitest";

import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	HTML_RENDER_CONTENT_SECURITY_PROFILE,
} from "@kilo-desktop/feature-sdk/main";

import { HTML_RENDER_DOCUMENT_PATH } from "../../contracts/html-render/schemas.js";
import {
	MCP_APP_SHELL_READY_MESSAGE,
	MCP_APP_WIDGET_DOCUMENT_PATH,
	MCP_APP_WIDGET_HOST,
} from "../../contracts/mcp-apps/schemas.js";
import { createMcpAppEmbeddedHost } from "./mcp-app-host.js";

describe("createMcpAppEmbeddedHost", () => {
	it("serves only the inline shell documents (no filesystem bundle)", () => {
		const host = createMcpAppEmbeddedHost();

		expect(host.host).toBe(MCP_APP_WIDGET_HOST);
		// Document-only host: no bundled root to serve or shadow the shells.
		expect(host.root).toBeUndefined();
		expect(Object.keys(host.documents ?? {})).toEqual([
			MCP_APP_WIDGET_DOCUMENT_PATH,
			HTML_RENDER_DOCUMENT_PATH,
		]);
		// Each shell carries the handshake the renderer depends on.
		for (const document of Object.values(host.documents ?? {})) {
			expect(document).toContain(MCP_APP_SHELL_READY_MESSAGE);
		}
	});

	it("gives every served document its own isolated profile (fail-closed on a key typo)", () => {
		const host = createMcpAppEmbeddedHost();
		const profiles: Record<string, string> = host.securityProfiles ?? {};

		// A mismatched (typo'd) profile key would leave a shell on the strict
		// embedded policy — its inline scripts are blocked, failing closed rather
		// than silently loosening the app policy.
		expect(profiles).toEqual({
			[MCP_APP_WIDGET_DOCUMENT_PATH]: ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
			[HTML_RENDER_DOCUMENT_PATH]: HTML_RENDER_CONTENT_SECURITY_PROFILE,
		});
	});
});
