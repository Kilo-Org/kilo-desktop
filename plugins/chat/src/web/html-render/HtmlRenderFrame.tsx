import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	HTML_RENDER_DOCUMENT_PATH,
	HTML_RENDER_MAX_HEIGHT,
	MCP_APP_HOST,
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
	clampHtmlRenderHeight,
} from "../../contracts";
import { useDiffTheme, type DiffTheme } from "../tools/diff-theme";
import {
	htmlRenderThemeMessage,
	injectHtmlRenderBootstrap,
	readHtmlRenderContentHeight,
	readHtmlRenderLinkUrl,
	type HtmlRenderTheme,
} from "./html-render-bootstrap";
import { readHtmlRenderTheme } from "./html-render-theme";

/** Height the frame holds until the page first reports its own. */
const PLACEHOLDER_HEIGHT = 320;
/** Same budget as the MCP App frame: only trips when the shell never loads. */
const SHELL_READY_TIMEOUT_MS = 10_000;

/**
 * Last height each page reported, so a frame remounted for the same page (it
 * moves below the turn fold when the turn settles, or scrolls back into a
 * virtualized thread) opens at its real size instead of jumping from the
 * placeholder.
 */
const reportedHeights = new Map<string, number>();
const MAX_REPORTED_HEIGHTS = 500;

function rememberHeight(key: string, height: number) {
	reportedHeights.delete(key);
	reportedHeights.set(key, height);
	if (reportedHeights.size > MAX_REPORTED_HEIGHTS) {
		const oldest = reportedHeights.keys().next().value;
		if (oldest !== undefined) reportedHeights.delete(oldest);
	}
}

/**
 * The isolated shell on the `mcp-app` origin, served under the html-render
 * CSP. Off the custom scheme (web dev server, browser tests) there is no such
 * origin, so the frame falls back to a sandboxed blob: URL.
 */
function htmlRenderShellSrc(location: Pick<Location, "protocol">): string | undefined {
	if (!location.protocol.startsWith("kilo-desktop")) return undefined;
	return `${location.protocol}//${MCP_APP_HOST}${HTML_RENDER_DOCUMENT_PATH}`;
}

function isShellReadyMessage(data: unknown): boolean {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as { type?: unknown }).type === MCP_APP_SHELL_READY_MESSAGE
	);
}

/**
 * Only throttles link requests: activation stays live for seconds after any
 * click anywhere in the window, so it does not show the reader clicked the
 * page's link. A page posting requests on its own still raises no prompt
 * until the reader next interacts with the app.
 */
function hasUserActivation(): boolean {
	return navigator.userActivation?.isActive === true;
}

const MAX_SHOWN_URL_LENGTH = 160;

/**
 * Asks before opening a link the page asked for. The page runs its own script,
 * so nothing it reports proves the reader clicked that link; only the Open
 * button, in app UI the page cannot reach, does. Without it a prompt-injected
 * page could open (and leak data through) any URL despite having no network
 * access. One prompt per frame: a newer request replaces the older one.
 */
function confirmOpenLink(
	url: string,
	promptId: string,
	openExternal: (url: string) => Promise<unknown>,
) {
	const shown =
		url.length > MAX_SHOWN_URL_LENGTH ? `${url.slice(0, MAX_SHOWN_URL_LENGTH - 1)}…` : url;
	toast(`Open ${new URL(url).host} in your browser?`, {
		id: promptId,
		description: shown,
		action: { label: "Open", onClick: () => void openExternal(url).catch(() => undefined) },
	});
}

export function useHtmlRenderTheme(): HtmlRenderTheme {
	const appearance = useDiffTheme();
	const [theme, setTheme] = useState(() => readHtmlRenderTheme(appearance.mode));
	// The shell applies the new theme's variables after notifying, so read them
	// on the next frame. A new Shiki theme restyles them too, without a new mode.
	const readThemeNextFrame = useEffectEvent((mode: DiffTheme["mode"], _shiki: string) =>
		requestAnimationFrame(() => setTheme(readHtmlRenderTheme(mode))),
	);
	useEffect(() => {
		const frame = readThemeNextFrame(appearance.mode, appearance.shiki);
		return () => cancelAnimationFrame(frame);
	}, [appearance.mode, appearance.shiki]);
	return theme;
}

export interface HtmlRenderFrameProps {
	readonly html: string;
	readonly title: string;
	/**
	 * `content` sizes the frame to the page, up to `maxHeight`; `fill` makes it
	 * fill its container and lets the page scroll inside.
	 */
	readonly fit: "content" | "fill";
	readonly maxHeight?: number | undefined;
	/** Identity of the page (its tool call) for reusing its last reported height. */
	readonly heightCacheKey?: string | undefined;
	readonly className?: string | undefined;
	/**
	 * Overrides the isolated shell URL normally derived from `window.location`
	 * on the `kilo-desktop*` custom scheme. Exposed for tests that exercise the
	 * shell handshake outside Electron.
	 */
	readonly shellSrc?: string | undefined;
}

/**
 * Shows an agent-authored page in a sandboxed (`allow-scripts` only, opaque
 * origin) iframe with the app theme injected, transparent over the chat. The
 * page itself is untrusted: its height reports are clamped, and its link
 * requests (http(s) only) open only once the reader confirms them in app UI.
 *
 * The frame is handed the page once and the shell accepts HTML exactly once,
 * so a different page needs a new frame: callers key this component by the
 * page's identity (its tool call).
 */
export function HtmlRenderFrame({
	html,
	title,
	fit,
	maxHeight = HTML_RENDER_MAX_HEIGHT,
	heightCacheKey,
	className,
	shellSrc: shellSrcOverride,
}: HtmlRenderFrameProps) {
	const os = useDomainObject(KernelOs);
	const linkPromptId = useId();
	const theme = useHtmlRenderTheme();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [shellSrc] = useState(() => shellSrcOverride ?? htmlRenderShellSrc(window.location));
	const [frameGeneration, setFrameGeneration] = useState(0);
	const activeGeneration = useRef(frameGeneration);
	const shellReady = useRef(false);
	// The frame window that already received this page. A WindowProxy stays
	// identical across in-frame navigations (so a page navigating to a looser
	// shell like /widget-host.html cannot trigger a second delivery), while
	// disconnecting and reconnecting an iframe destroys its browsing context and
	// creates a new WindowProxy.
	const deliveredWindow = useRef<Window | null>(null);
	const hiddenBeforeDelivery = useRef(false);
	// The page whose shell never reported ready; a new page clears it.
	const [failedPage, setFailedPage] = useState<string | null>(null);
	const shellError = failedPage === html;
	const [contentHeight, setContentHeight] = useState(() =>
		heightCacheKey === undefined ? undefined : reportedHeights.get(heightCacheKey),
	);
	// The page is handed over once, themed as the app is at that moment.
	const bootstrapPage = useEffectEvent((page: string) => injectHtmlRenderBootstrap(page, theme));

	// Without the shell the page loads from a blob: URL, which lives exactly as
	// long as this effect, so it is pointed at imperatively.
	useEffect(() => {
		const iframe = iframeRef.current;
		if (shellSrc || !iframe) return;
		const page = bootstrapPage(html);
		const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
		iframe.src = url;
		return () => URL.revokeObjectURL(url);
	}, [html, shellSrc]);

	useEffect(() => {
		if (!shellSrc) return;
		if (activeGeneration.current !== frameGeneration) {
			activeGeneration.current = frameGeneration;
			deliveredWindow.current = null;
			hiddenBeforeDelivery.current = false;
		}
		const frame = iframeRef.current?.contentWindow ?? null;
		// Resumed from a hidden `<Activity>` while the iframe stayed connected:
		// this exact browsing context already has the page (or navigated away from
		// it), so keep the frame untouched and do not re-arm the failure timeout.
		if (frame && deliveredWindow.current === frame) {
			shellReady.current = true;
			return;
		}
		// Previously delivered to a browsing context that was destroyed (e.g. an
		// ancestor portal detached and reattached the iframe), or hidden before
		// the shell's READY retry loop could finish: remount the iframe so it is
		// guaranteed to start fresh at `shellSrc` (`/html-render.html`).
		if (
			(deliveredWindow.current !== null && deliveredWindow.current !== frame) ||
			hiddenBeforeDelivery.current
		) {
			hiddenBeforeDelivery.current = false;
			shellReady.current = false;
			setFrameGeneration((generation) => generation + 1);
			return;
		}
		shellReady.current = false;
		// Distinguish real `<Activity mode="hidden">` cleanups from synchronous
		// StrictMode mount/unmount/mount checks: StrictMode cleans up before any
		// microtask runs.
		let settled = false;
		queueMicrotask(() => {
			settled = true;
		});
		const timer = setTimeout(() => {
			if (!shellReady.current) setFailedPage(html);
		}, SHELL_READY_TIMEOUT_MS);
		return () => {
			clearTimeout(timer);
			if (settled && deliveredWindow.current === null) {
				hiddenBeforeDelivery.current = true;
			}
		};
	}, [frameGeneration, html, shellSrc]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const frame = iframeRef.current?.contentWindow;
			if (!frame || event.source !== frame) return;
			if (isShellReadyMessage(event.data)) {
				shellReady.current = true;
				// Only the frame's first document is known to be the page shell: a
				// later READY comes from wherever the page navigated its frame
				// (e.g. the widget shell, under a looser policy).
				if (deliveredWindow.current !== null) return;
				deliveredWindow.current = frame;
				const page = bootstrapPage(html);
				frame.postMessage({ type: MCP_APP_SHELL_HTML_MESSAGE, html: page }, "*");
				return;
			}
			const height = readHtmlRenderContentHeight(event.data);
			if (height !== undefined) {
				setContentHeight(height);
				if (heightCacheKey !== undefined) rememberHeight(heightCacheKey, height);
				return;
			}
			const url = readHtmlRenderLinkUrl(event.data);
			if (url && hasUserActivation()) {
				confirmOpenLink(url, linkPromptId, async (target) => {
					await os?.methods.openExternal({ url: target });
				});
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [heightCacheKey, html, linkPromptId, os]);

	useEffect(() => {
		iframeRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
	}, [theme]);

	if (shellError) {
		return <p className="text-muted-foreground py-2 text-sm">This page failed to load.</p>;
	}

	const height =
		fit === "content"
			? Math.min(clampHtmlRenderHeight(contentHeight ?? PLACEHOLDER_HEIGHT), maxHeight)
			: undefined;
	return (
		<iframe
			key={frameGeneration}
			ref={iframeRef}
			src={shellSrc}
			sandbox="allow-scripts"
			referrerPolicy="no-referrer"
			title={title}
			className={cn("block w-full border-0 bg-transparent", fit === "fill" && "h-full", className)}
			style={{ colorScheme: theme.appearance, ...(height === undefined ? {} : { height }) }}
		/>
	);
}
