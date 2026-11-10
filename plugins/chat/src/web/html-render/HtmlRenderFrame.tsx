import { useEffect, useId, useMemo, useRef, useState } from "react";

import { KernelOs } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
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
import { useDiffTheme } from "../tools/diff-theme";
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
	useEffect(() => {
		// The shell applies the new theme's variables after notifying, so read
		// them on the next frame.
		const frame = requestAnimationFrame(() => setTheme(readHtmlRenderTheme(appearance.mode)));
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
}: HtmlRenderFrameProps) {
	const os = useDomain(KernelOs);
	const linkPromptId = useId();
	const theme = useHtmlRenderTheme();
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const shellSrc = useMemo(() => htmlRenderShellSrc(window.location), []);
	const shellReady = useRef(false);
	const pageDelivered = useRef(false);
	const [shellError, setShellError] = useState(false);
	const [contentHeight, setContentHeight] = useState(() =>
		heightCacheKey === undefined ? undefined : reportedHeights.get(heightCacheKey),
	);
	const [blobUrl, setBlobUrl] = useState<string | null>(null);

	useEffect(() => {
		if (shellSrc) return;
		const page = injectHtmlRenderBootstrap(html, themeRef.current);
		const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
		setBlobUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [html, shellSrc]);

	useEffect(() => {
		if (!shellSrc) return;
		shellReady.current = false;
		setShellError(false);
		const timer = setTimeout(() => {
			if (!shellReady.current) setShellError(true);
		}, SHELL_READY_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [html, shellSrc]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const frame = iframeRef.current?.contentWindow;
			if (!frame || event.source !== frame) return;
			if (isShellReadyMessage(event.data)) {
				shellReady.current = true;
				// Only the frame's first document is known to be the page shell: a
				// later READY comes from wherever the page navigated its frame
				// (e.g. the widget shell, under a looser policy).
				if (pageDelivered.current) return;
				pageDelivered.current = true;
				const page = injectHtmlRenderBootstrap(html, themeRef.current);
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
	const src = shellSrc ?? blobUrl;
	if (!src) return null;

	const height =
		fit === "content"
			? Math.min(clampHtmlRenderHeight(contentHeight ?? PLACEHOLDER_HEIGHT), maxHeight)
			: undefined;
	return (
		<iframe
			ref={iframeRef}
			src={src}
			sandbox="allow-scripts"
			referrerPolicy="no-referrer"
			title={title}
			className={cn("block w-full border-0 bg-transparent", fit === "fill" && "h-full", className)}
			style={{ colorScheme: theme.appearance, ...(height === undefined ? {} : { height }) }}
		/>
	);
}
