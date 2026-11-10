import { createElement, type ComponentProps, type ElementType, type MouseEvent } from "react";

import type { DomainObjectHandle, KernelOs, KernelTelemetry } from "@kilo-desktop/kernel";
import type { MarkdownExtensionImplementation } from "@kilo-desktop/plugin-chat/contracts";
import type { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";
import { MarkdownAnchor } from "@kilo-desktop/ui/components/markdown-content";
import type { MarkdownRendererComponents } from "@kilo-desktop/ui/lib/markdown-extension";

import { BROWSER_TELEMETRY_EVENTS, isWebUrl } from "../contracts/index.js";
import { openUrl } from "../shared/open-url.js";

export interface WebLinksRuntime {
	readonly panes: () => DomainObjectHandle<typeof Panes> | null;
	readonly os: () => DomainObjectHandle<typeof KernelOs> | null;
	readonly telemetry: () => DomainObjectHandle<typeof KernelTelemetry> | null;
}

type WebLinkProps = Omit<ComponentProps<"a">, "href"> & {
	readonly href: string;
	readonly workSessionId: string;
	readonly Anchor: ElementType;
	readonly runtime: WebLinksRuntime;
};

const SYSTEM_BROWSER_MODIFIER = /Mac|iPhone|iPad/iu.test(globalThis.navigator?.platform ?? "")
	? "⌘"
	: "Ctrl";

function linkTooltip(href: string, title: string | undefined): string {
	return [title || href, `${SYSTEM_BROWSER_MODIFIER}-click to open in your default browser`].join(
		"\n",
	);
}

function hasModifier(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

async function openInPane(runtime: WebLinksRuntime, workSessionId: string, href: string) {
	const panes = runtime.panes();
	if (!panes) throw new Error("The session's panes are unavailable.");
	await openUrl(panes, workSessionId, href);
}

function WebLink({ workSessionId, Anchor, href, title, onClick, runtime, ...props }: WebLinkProps) {
	const openExternal = () =>
		void runtime
			.os()
			?.methods.openExternal({ url: href })
			.catch(() => undefined);
	const open = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || event.button !== 0) return;
		event.preventDefault();
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
	};
	return createElement(Anchor, { ...props, href, title: linkTooltip(href, title), onClick: open });
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
	return ({ workSessionId }) => ({
		decorateComponents(next: MarkdownRendererComponents) {
			const NextAnchor = (next.a ?? MarkdownAnchor) as ElementType;
			if (!workSessionId) return next;
			return {
				...next,
				a({ node: _node, ...props }: ComponentProps<"a"> & { readonly node?: unknown }) {
					return isWebUrl(props.href) ? (
						<WebLink
							{...props}
							href={props.href}
							workSessionId={workSessionId}
							Anchor={NextAnchor}
							runtime={runtime}
						/>
					) : (
						createElement(NextAnchor, props)
					);
				},
			};
		},
	});
}
