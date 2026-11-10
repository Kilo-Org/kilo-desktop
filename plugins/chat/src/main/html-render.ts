import { KernelError, mainHost, type DomainHandle, type PluginSdk } from "@kilo-desktop/kernel";
import { AgentTool, defineTool } from "@kilo-desktop/plugin-agent/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import {
	HTML_RENDER_DOCUMENT_PATH,
	HTML_RENDER_TOOL_DESCRIPTION,
	HTML_RENDER_TOOL_ID,
	HtmlPages,
	MCP_APP_HOST,
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
	MCP_APP_WIDGET_DOCUMENT_PATH,
	htmlPageFileStem,
	htmlRenderInput,
} from "../contracts";

const NOT_A_KILO_CHAT =
	"Pages can only be shown in a Kilo Desktop chat; this call did not come from one.";

/**
 * `html_render`: the agent shows a self-contained page inline in its chat.
 * The tool only validates and acknowledges — the page lives in the call's
 * args, which the chat already keeps, and kilo.chat's renderer frames it.
 * Only a Kilo chat renders the page, so a call from anything else (an
 * external app) is told nobody would see it.
 */
export function implementHtmlRenderTool(sdk: PluginSdk): void {
	sdk.extensions.implement(
		AgentTool,
		HTML_RENDER_TOOL_ID,
		defineTool({
			description: HTML_RENDER_TOOL_DESCRIPTION,
			input: htmlRenderInput,
			run: (input, context) =>
				context.chatId
					? {
							rendered: true,
							title: input.title,
							message:
								"The page is shown to the user above your reply. Do not announce or restate it; add only what it doesn't say.",
						}
					: { error: NOT_A_KILO_CHAT },
		}),
	);
}

/** Creates a file only if none exists at the path; resolves false when one does. */
export type WriteNewFile = (path: string, content: string) => Promise<boolean>;

/** Name attempts before giving up: `Chart.html`, `Chart 2.html`, … */
const MAX_NAME_ATTEMPTS = 100;

const joinPath = (directory: string, name: string) =>
	`${directory.replace(/[\\/]+$/, "")}${directory.includes("\\") ? "\\" : "/"}${name}`;

/**
 * The `html-pages` domain object. The window names the folder, so it is
 * accepted only when kilo.workspaces authorizes it as a workspace folder (or
 * a managed worktree of one), and the file is created exclusively: an
 * existing file — or a symlink planted in its place — is never written
 * through; the name moves on instead.
 */
export function provideHtmlPages(sdk: PluginSdk, writeNewFile: WriteNewFile | undefined): void {
	let workspaces: DomainHandle<typeof Workspaces> | null = null;
	sdk.domains.provide(HtmlPages, {
		initialState: {},
		methods: {
			save: async ({ workspaceDirectory, title, html }) => {
				if (!writeNewFile) throw new KernelError("UNAVAILABLE", "Pages can't be saved here.");
				workspaces ??= sdk.domains.get(Workspaces);
				const authorization = await workspaces?.methods.authorize({
					path: workspaceDirectory,
					rule: "folder",
				});
				if (!authorization?.allowed) {
					throw new KernelError("PERMISSION_DENIED", "That folder isn't a workspace folder.");
				}
				const root = authorization.path ?? workspaceDirectory;
				const stem = htmlPageFileStem(title);
				for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
					const name = attempt === 1 ? `${stem}.html` : `${stem} ${attempt}.html`;
					if (await writeNewFile(joinPath(root, name), html)) return { relativePath: name };
				}
				throw new KernelError("BUSINESS", `Too many files named "${stem}" already exist.`);
			},
		},
	});
}

/**
 * Re-announces READY on a bounded interval until the HTML arrives: the
 * window's listener is registered from an effect after the frame commits, so
 * a single READY can race ahead of it and leave a blank frame.
 */
const SHELL_READY_RETRY_MS = 100;
const SHELL_READY_MAX_ATTEMPTS = 50;

/**
 * The shell document served on the `mcp-app` host. Untrusted widget and page
 * HTML runs here — an isolated, opaque-origin frame with no app bridge —
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

/** The host's named CSPs (see the app's embedded web host security profiles). */
const ACTIVE_UNTRUSTED_CONTENT_PROFILE = "active-untrusted-content";
const HTML_RENDER_CONTENT_PROFILE = "html-render-content";

/**
 * Registers the `mcp-app` embedded host: no bundle, two inline shell
 * documents — the MCP App widget shell under the active-untrusted CSP and the
 * agent page shell under the stricter html-render CSP (no network, no
 * loopback).
 */
export function registerMcpAppHost(sdk: PluginSdk): void {
	const embeddedHosts = mainHost(sdk).embeddedHosts;
	if (!embeddedHosts) return;
	sdk.onDispose(
		embeddedHosts.register({
			host: MCP_APP_HOST,
			root: undefined,
			documents: {
				[MCP_APP_WIDGET_DOCUMENT_PATH]: mcpAppShellHtml("MCP App"),
				[HTML_RENDER_DOCUMENT_PATH]: mcpAppShellHtml("HTML page"),
			},
			securityProfiles: {
				[MCP_APP_WIDGET_DOCUMENT_PATH]: ACTIVE_UNTRUSTED_CONTENT_PROFILE,
				[HTML_RENDER_DOCUMENT_PATH]: HTML_RENDER_CONTENT_PROFILE,
			},
		}),
	);
}
