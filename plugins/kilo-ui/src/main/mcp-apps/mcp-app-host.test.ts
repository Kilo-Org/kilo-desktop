import { describe, expect, it } from "vitest";

import { ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE } from "@kilo-desktop/feature-sdk/main";

import {
	MCP_APP_SHELL_READY_MESSAGE,
	MCP_APP_WIDGET_DOCUMENT_PATH,
	MCP_APP_WIDGET_HOST,
} from "../../contracts/mcp-apps/schemas.js";
import { createMcpAppEmbeddedHost } from "./mcp-app-host.js";

describe("createMcpAppEmbeddedHost", () => {
	it("serves only the inline widget shell document (no filesystem bundle)", () => {
		const host = createMcpAppEmbeddedHost();

		expect(host.host).toBe(MCP_APP_WIDGET_HOST);
		// Document-only host: no bundled root to serve or shadow the shell.
		expect(host.root).toBeUndefined();
		expect(Object.keys(host.documents ?? {})).toEqual([MCP_APP_WIDGET_DOCUMENT_PATH]);
		// The shell carries the handshake the renderer depends on.
		expect(host.documents?.[MCP_APP_WIDGET_DOCUMENT_PATH]).toContain(MCP_APP_SHELL_READY_MESSAGE);
	});

	it("applies the active-untrusted profile to exactly the served document (fail-closed on a key typo)", () => {
		const host = createMcpAppEmbeddedHost();
		const documents: Record<string, string> = host.documents ?? {};
		const profiles: Record<string, string> = host.securityProfiles ?? {};

		expect(Object.keys(profiles)).toEqual([MCP_APP_WIDGET_DOCUMENT_PATH]);
		expect(profiles[MCP_APP_WIDGET_DOCUMENT_PATH]).toBe(ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE);
		// Every served document must carry the profile: a mismatched (typo'd)
		// profile key leaves the shell on the strict embedded policy — the widget
		// simply fails closed (inline scripts blocked) rather than the shell
		// silently loosening the app policy.
		for (const path of Object.keys(documents)) {
			expect(profiles[path]).toBe(ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE);
		}
	});
});
