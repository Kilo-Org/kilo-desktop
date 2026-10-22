import type { TerminalPalette } from "@kilo-desktop/feature-sdk";
import {
	TERMINAL_HOST,
	terminalFrameHostMessageSchema,
	type TerminalFrameHostMessage,
	type TerminalTheme,
} from "../contracts/frame.js";

const DESKTOP_PROTOCOLS = new Set(["kilo-desktop:", "kilo-desktop-dev:"]);

export function terminalOriginFrom(appOrigin: string): string | undefined {
	let url: URL;
	try {
		url = new URL(appOrigin);
	} catch {
		return undefined;
	}
	if (!DESKTOP_PROTOCOLS.has(url.protocol) || url.host !== "app") return undefined;
	return `${url.protocol}//${TERMINAL_HOST}`;
}

export function terminalFrameSrcFor(
	location: Pick<Location, "protocol" | "host">,
	developmentOrigin?: string,
): string | undefined {
	const appOrigin = `${location.protocol}//${location.host}`;
	const terminalOrigin = terminalOriginFrom(appOrigin) ?? developmentOrigin;
	if (!terminalOrigin) return undefined;
	const url = new URL(`${terminalOrigin}/index.html`);
	url.searchParams.set("parentOrigin", appOrigin);
	return url.toString();
}

export function trustedTerminalFrameMessageFrom(
	event: Pick<MessageEvent<unknown>, "data" | "origin" | "source">,
	frameWindow: Window | null,
	frameOrigin: string,
): TerminalFrameHostMessage | undefined {
	if (event.source !== frameWindow || event.origin !== frameOrigin) return undefined;
	const parsed = terminalFrameHostMessageSchema.safeParse(event.data);
	return parsed.success ? parsed.data : undefined;
}

type TerminalScrollbarTheme = Pick<TerminalTheme, "scrollbarThumb" | "scrollbarThumbHover">;

export function terminalThemeFor(
	mode: "dark" | "light",
	scrollbarTheme?: Partial<TerminalScrollbarTheme>,
	palette?: TerminalPalette | null,
): TerminalTheme {
	const theme =
		mode === "dark"
			? {
					background: "#141820",
					foreground: "#e1e8f0",
					cursor: "#ffffff",
					cursorAccent: "#141820",
					// 30% foreground over background, matching the app theme derivation.
					selectionBackground: "#52565e",
					selectionForeground: "#e1e8f0",
					black: "#141820",
					brightBlack: "#62748e",
					white: "#e1e8f0",
					brightWhite: "#fafafa",
					scrollbarThumb: "color-mix(in oklch, #37414f 70%, transparent)",
					scrollbarThumbHover: "#37414f",
				}
			: {
					background: "#f3f5f8",
					foreground: "#222934",
					cursor: "#222934",
					cursorAccent: "#f3f5f8",
					selectionBackground: "#b4b8bd",
					selectionForeground: "#222934",
					black: "#f3f5f8",
					brightBlack: "#7a8ba5",
					white: "#222934",
					brightWhite: "#070707",
					scrollbarThumb: "color-mix(in oklch, #e1e8f0 85%, transparent)",
					scrollbarThumbHover: "#e1e8f0",
				};
	return { ...theme, ...palette, ...scrollbarTheme };
}
