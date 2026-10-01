/**
 * Chat markdown extension (zone `kilo-ui/chat-markdown-extension`): a plain
 * click on an http(s) link in a chat message opens it in a Browser tab of that
 * chat instead of leaving the app. A modified click (⌘/Ctrl/Shift/Alt), or a
 * plain click when the chat pane layout is unavailable, opens the default
 * browser. The link's tooltip names the URL and the modifier, since the app
 * shows no status-bar URL preview. Outside a chat session links are untouched.
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

type WebLinkProps = Omit<ComponentProps<"a">, "href"> & {
	readonly href: string;
	readonly sessionId: string;
	readonly Anchor: ElementType;
};

function isWebUrl(href: string | undefined): href is string {
	return href !== undefined && /^https?:\/\//iu.test(href.trim());
}

const SYSTEM_BROWSER_MODIFIER = /Mac|iPhone|iPad/iu.test(globalThis.navigator?.platform ?? "")
	? "⌘"
	: "Ctrl";

function linkTooltip(href: string, title: string | undefined): string {
	const hint = `${SYSTEM_BROWSER_MODIFIER}-click to open in your default browser`;
	return [title || href, hint].join("\n");
}

function hasModifier(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function WebLink({ sessionId, Anchor, href, title, onClick, ...props }: WebLinkProps) {
	const sdk = useSdk("browser");
	const open = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || event.button !== 0) return;
		event.preventDefault();
		if (hasModifier(event) || "error" in openBrowserTab(sdk, sessionId, href)) {
			void sdk.shell.openExternal(href).catch(() => undefined);
			return;
		}
		void sdk.telemetry
			.track({ event: "Browser Tab Opened", data: { source: "chat-link" } })
			.catch(() => undefined);
	};
	return createElement(Anchor, {
		...props,
		href,
		title: linkTooltip(href, title),
		onClick: open,
	});
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
					<WebLink {...props} href={props.href} sessionId={sessionId} Anchor={NextAnchor} />
				) : (
					createElement(NextAnchor, props)
				);
			},
		};
	},
});
