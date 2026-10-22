import { describe, expect, it } from "vitest";

import { TERMINAL_PROTOCOL_VERSION } from "../contracts/session.js";
import {
	terminalFrameSrcFor,
	terminalOriginFrom,
	terminalThemeFor,
	trustedTerminalFrameMessageFrom,
} from "./terminal-frame-bridge.js";

describe("terminal frame bridge", () => {
	it("uses the application design-system palette for both color modes", () => {
		expect(terminalThemeFor("light")).toEqual({
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
		});
		expect(terminalThemeFor("dark")).toEqual({
			background: "#141820",
			foreground: "#e1e8f0",
			cursor: "#ffffff",
			cursorAccent: "#141820",
			selectionBackground: "#52565e",
			selectionForeground: "#e1e8f0",
			black: "#141820",
			brightBlack: "#62748e",
			white: "#e1e8f0",
			brightWhite: "#fafafa",
			scrollbarThumb: "color-mix(in oklch, #37414f 70%, transparent)",
			scrollbarThumbHover: "#37414f",
		});
	});

	it("derives a dedicated custom-protocol origin and never uses one in standalone web", () => {
		expect(terminalOriginFrom("kilo-desktop://app")).toBe("kilo-desktop://terminal");
		expect(terminalOriginFrom("kilo-desktop-dev://app")).toBe("kilo-desktop-dev://terminal");
		expect(terminalOriginFrom("http://localhost:5173")).toBeUndefined();
		expect(terminalOriginFrom("kilo-desktop-evil://app")).toBeUndefined();
		expect(terminalOriginFrom("kilo-desktop://evil")).toBeUndefined();
		const frame = new URL(terminalFrameSrcFor({ protocol: "kilo-desktop-dev:", host: "app" })!);
		expect(`${frame.protocol}//${frame.host}`).toBe("kilo-desktop-dev://terminal");
		expect(frame.searchParams.get("parentOrigin")).toBe("kilo-desktop-dev://app");
	});

	it("requires exact source, origin, and protocol version", () => {
		const source = window;
		const message = {
			source,
			origin: "kilo-desktop://terminal",
			data: { type: "terminal:ready", protocolVersion: TERMINAL_PROTOCOL_VERSION },
		};
		expect(trustedTerminalFrameMessageFrom(message, source, message.origin)).toEqual(message.data);
		expect(
			trustedTerminalFrameMessageFrom(
				{ ...message, origin: "https://terminal.invalid" },
				source,
				message.origin,
			),
		).toBeUndefined();
		expect(
			trustedTerminalFrameMessageFrom({ ...message, source: null }, source, message.origin),
		).toBeUndefined();
		expect(
			trustedTerminalFrameMessageFrom(
				{
					...message,
					data: { ...message.data, protocolVersion: TERMINAL_PROTOCOL_VERSION + 1 },
				},
				source,
				message.origin,
			),
		).toBeUndefined();
	});

	it("parses labels only from the trusted frame", () => {
		const source = window;
		const origin = "kilo-desktop://terminal";
		const labelMessage = {
			source,
			origin,
			data: { type: "terminal:label", protocolVersion: TERMINAL_PROTOCOL_VERSION, label: "vite" },
		};
		expect(trustedTerminalFrameMessageFrom(labelMessage, source, origin)).toEqual(
			labelMessage.data,
		);
		expect(
			trustedTerminalFrameMessageFrom({ ...labelMessage, source: null }, source, origin),
		).toBeUndefined();
	});
});
