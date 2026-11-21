import type { MouseEvent } from "react";

import type { DomainObjectHandle, KernelOs, KernelTelemetry } from "@kilo-desktop/kernel";
import type { MarkdownExtensionImplementation } from "@kilo-desktop/plugin-chat/contracts";
import type { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import { BROWSER_TELEMETRY_EVENTS, isWebUrl } from "../contracts/index.js";
import { openUrl } from "../shared/open-url.js";

export interface WebLinksRuntime {
	readonly panes: () => DomainObjectHandle<typeof Panes> | null;
	readonly os: () => DomainObjectHandle<typeof KernelOs> | null;
	readonly telemetry: () => DomainObjectHandle<typeof KernelTelemetry> | null;
}

const SYSTEM_BROWSER_MODIFIER = /Mac|iPhone|iPad/iu.test(globalThis.navigator?.platform ?? "")
	? "⌘"
	: "Ctrl";

/** Names the URL (or the link's own title) and the modifier that opens the default browser. */
function withWebLinkTooltip(html: string): string {
	const template = document.createElement("template");
	template.innerHTML = html;
	const anchor = template.content.firstElementChild;
	const href = anchor?.getAttribute("href");
	if (!anchor || !isWebUrl(href ?? undefined)) return html;
	anchor.setAttribute(
		"title",
		[
			anchor.getAttribute("title") || href,
			`${SYSTEM_BROWSER_MODIFIER}-click to open in your default browser`,
		].join("\n"),
	);
	return anchor.outerHTML;
}

function hasModifier(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

async function openInPane(runtime: WebLinksRuntime, workSessionId: string, href: string) {
	const panes = runtime.panes();
	if (!panes) throw new Error("The session's panes are unavailable.");
	await openUrl(panes, workSessionId, href);
}

function openWebLink(
	runtime: WebLinksRuntime,
	workSessionId: string,
	event: MouseEvent<HTMLElement>,
) {
	const anchor = (event.target as Element | null)?.closest?.("a[href]");
	const href = anchor?.getAttribute("href") ?? undefined;
	if (!anchor || !isWebUrl(href) || event.button !== 0) return;
	event.preventDefault();
	const openExternal = () =>
		void runtime
			.os()
			?.methods.openExternal({ url: href })
			.catch(() => undefined);
	if (hasModifier(event)) {
		openExternal();
		return;
	}
	openInPane(runtime, workSessionId, href).then(
		() =>
			void runtime
				.telemetry()
				?.methods.track({
					event: BROWSER_TELEMETRY_EVENTS.tabOpened,
					data: { source: "chat-link" },
				})
				.catch(() => undefined),
		openExternal,
	);
}

/**
 * kilo.browser's `markdown-extension` (origin's BrowserMarkdownExtension): a
 * plain click on an http(s) link in the agent's replies opens it in a Browser
 * pane of the chat's work session, through kilo.work-sessions' openers. A
 * modified click (⌘/Ctrl/Shift/Alt), or a plain click no pane can take,
 * opens the default browser. The tooltip names the URL and the modifier,
 * since the app shows no status-bar preview. Outside a work session links
 * are untouched.
 */
export function createBrowserMarkdownExtension(
	runtime: WebLinksRuntime,
): MarkdownExtensionImplementation {
	return ({ workSessionId }) =>
		workSessionId
			? {
					components: { a: withWebLinkTooltip },
					onClick: (event) => openWebLink(runtime, workSessionId, event),
				}
			: {};
}
