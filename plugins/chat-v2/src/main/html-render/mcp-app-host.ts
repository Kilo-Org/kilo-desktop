import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import {
	HTML_RENDER_DOCUMENT_PATH,
	MCP_APP_HOST,
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
} from "../../contracts";

/**
 * Re-announces READY on a bounded interval until the HTML arrives: the
 * window's listener is registered from an effect after the frame commits, so
 * a single READY can race ahead of it and leave a blank frame.
 */
const SHELL_READY_RETRY_MS = 100;
const SHELL_READY_MAX_ATTEMPTS = 50;

/**
 * The shell document served on the `mcp-app` host. Untrusted page HTML runs
 * here — an isolated, opaque-origin frame with no app bridge —
 * instead of a `blob:` frame that would inherit the app origin's CSP. It
 * announces READY to its parent, takes the HTML by postMessage (from its
 * parent only), drops its listener and writes the HTML into its own document,
 * so the HTML runs under this origin's policy and cannot trigger another write.
 *
 * It first removes WebRTC, which no CSP directive contains (`connect-src`
 * does not cover ICE, so a page could reach any STUN/TURN server it names);
 * `document.write` keeps the same realm, so the page starts without it. The
 * desktop host strips it from every subframe realm at creation as well, which
 * also covers realms the page could open itself (`srcdoc` children).
 */
export const mcpAppShellHtml = (title: string) => `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
	</head>
	<body>
		<script>
			(function () {
				Object.getOwnPropertyNames(window).forEach(function (name) {
					if (/^(?:webkit)?RTC/.test(name)) delete window[name];
				});
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
					if (written || ++attempts > ${SHELL_READY_MAX_ATTEMPTS}) {
						clearInterval(retry);
						return;
					}
					announceReady();
				}, ${SHELL_READY_RETRY_MS});
			})();
		</script>
	</body>
</html>`;

/** The host's named CSP (see the app's embedded web host security profiles). */
const HTML_RENDER_CONTENT_PROFILE = "html-render-content";

/**
 * Registers the `mcp-app` embedded host (named for the MCP App widgets it was
 * built for): no bundle, one inline shell document — the agent page shell
 * under the html-render CSP (no network, no loopback).
 */
export function registerMcpAppHost(sdk: PluginSdk): void {
	const embeddedHosts = mainHost(sdk).embeddedHosts;
	if (!embeddedHosts) return;
	sdk.onDispose(
		embeddedHosts.register({
			host: MCP_APP_HOST,
			root: undefined,
			documents: { [HTML_RENDER_DOCUMENT_PATH]: mcpAppShellHtml("HTML page") },
			securityProfiles: { [HTML_RENDER_DOCUMENT_PATH]: HTML_RENDER_CONTENT_PROFILE },
		}),
	);
}
