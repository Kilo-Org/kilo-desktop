import {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	type EmbeddedWebHost,
} from "@kilo-desktop/feature-sdk/main";

import {
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
	MCP_APP_WIDGET_DOCUMENT_PATH,
	MCP_APP_WIDGET_HOST,
} from "../../contracts/mcp-apps/schemas.js";

/**
 * Static shell served from the dedicated `mcp-app` origin under the
 * active-untrusted security profile. It exists so third-party MCP App widget
 * HTML executes here — an isolated, opaque-origin, preload-less frame — instead
 * of a `blob:` iframe that would inherit the trusted app origin's CSP and force
 * `script-src 'unsafe-inline'` onto it (threat-model EoP 7).
 *
 * The shell announces READY to the app renderer, receives the widget HTML by
 * postMessage, and writes it into its own document so the widget's inline
 * scripts run under THIS origin's policy. It removes its own listener before
 * writing, so the widget markup that replaces this document cannot re-trigger a
 * write, and it only accepts messages from `window.parent`.
 *
 * READY is re-announced on a bounded interval until the HTML arrives. The
 * renderer registers its message listener from a React effect that runs after
 * the iframe commits, so a single READY posted on load can race ahead of that
 * listener and be dropped, leaving a permanently blank frame. Retrying closes
 * the race and stops on the first HTML message (or after the attempt cap).
 */
const WIDGET_SHELL_READY_RETRY_MS = 100;
const WIDGET_SHELL_READY_MAX_ATTEMPTS = 50;
const WIDGET_SHELL_HTML = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>MCP App</title>
	</head>
	<body>
		<script>
			(function () {
				var written = false;
				var retry;
				function onMessage(event) {
					if (event.source !== window.parent) return;
					var data = event.data;
					if (!data || data.type !== ${JSON.stringify(MCP_APP_SHELL_HTML_MESSAGE)}) return;
					if (typeof data.html !== "string") return;
					written = true;
					clearInterval(retry);
					window.removeEventListener("message", onMessage);
					document.open();
					document.write(data.html);
					document.close();
				}
				function announceReady() {
					window.parent.postMessage({ type: ${JSON.stringify(MCP_APP_SHELL_READY_MESSAGE)} }, "*");
				}
				window.addEventListener("message", onMessage);
				announceReady();
				var attempts = 0;
				retry = setInterval(function () {
					if (written || ++attempts > ${WIDGET_SHELL_READY_MAX_ATTEMPTS}) {
						clearInterval(retry);
						return;
					}
					announceReady();
				}, ${WIDGET_SHELL_READY_RETRY_MS});
			})();
		</script>
	</body>
</html>`;

/**
 * The `mcp-app` embedded host contribution. Ships no filesystem bundle — just
 * the inline shell document, served with the active-untrusted CSP.
 */
export function createMcpAppEmbeddedHost() {
	// `satisfies` (not an `EmbeddedWebHost` annotation) so the inferred literal
	// type stays assignable to `plugins.expose`'s `Record<string, unknown>` —
	// the same shape the notebook host contribution uses.
	return {
		host: MCP_APP_WIDGET_HOST,
		root: undefined,
		documents: { [MCP_APP_WIDGET_DOCUMENT_PATH]: WIDGET_SHELL_HTML },
		securityProfiles: {
			[MCP_APP_WIDGET_DOCUMENT_PATH]: ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
		},
	} satisfies EmbeddedWebHost;
}
