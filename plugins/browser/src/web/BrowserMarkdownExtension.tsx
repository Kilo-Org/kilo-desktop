/**
 * Chat markdown extension (zone `kilo-ui/chat-markdown-extension`): a plain
 * click on an http(s) link in a chat message opens it in a Browser tab of that
 * chat instead of leaving the app. Modified clicks (⌘/Ctrl/Shift/Alt) and
 * clicks with no chat or pane layout fall through to the default navigation,
 * which the shell hands to the system browser.
 */
import { createElement, type ComponentProps, type ElementType, type MouseEvent } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { MarkdownAnchor } from "@kilo-desktop/ui/components/markdown-content";
import type {
	MarkdownRendererComponents,
	MarkdownRendererExtensionFactory,
} from "@kilo-desktop/ui/components/markdown-extension";

import { openBrowserTab } from "./open-browser-tab.js";

interface ChatMarkdownExtensionContext {
	readonly sessionId: string;
}

type WebLinkProps = ComponentProps<"a"> & {
	readonly sessionId: string;
	readonly Anchor: ElementType;
};

function isWebUrl(href: string | undefined): href is string {
	return href !== undefined && /^https?:\/\//iu.test(href.trim());
}

function isPlainPrimaryClick(event: MouseEvent): boolean {
	return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function WebLink({ sessionId, Anchor, href, onClick, ...props }: WebLinkProps) {
	const sdk = useSdk("browser");
	const openInBrowserTab = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || !isPlainPrimaryClick(event) || !href) return;
		if ("error" in openBrowserTab(sdk, sessionId, href)) return;
		event.preventDefault();
		void sdk.telemetry
			.track({ event: "Browser Tab Opened", data: { source: "chat-link" } })
			.catch(() => undefined);
	};
	return createElement(Anchor, { ...props, href, onClick: openInBrowserTab });
}

export const BrowserMarkdownExtension: MarkdownRendererExtensionFactory<
	ChatMarkdownExtensionContext
> = ({ sessionId }) => ({
	decorateComponents(next: MarkdownRendererComponents) {
		const NextAnchor = (next.a ?? MarkdownAnchor) as ElementType;
		if (!sessionId) return next;
		return {
			...next,
			a({ node: _node, ...props }: ComponentProps<"a"> & { readonly node?: unknown }) {
				return isWebUrl(props.href) ? (
					<WebLink {...props} sessionId={sessionId} Anchor={NextAnchor} />
				) : (
					createElement(NextAnchor, props)
				);
			},
		};
	},
});
