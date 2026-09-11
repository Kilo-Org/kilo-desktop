import { z } from "zod";

import { TERMINAL_PROTOCOL_VERSION, terminalLabelSchema } from "./session.js";

export const TERMINAL_HOST = "terminal";

export const terminalThemeSchema = z.object({
	background: z.string(),
	foreground: z.string(),
	cursor: z.string(),
	cursorAccent: z.string(),
	selectionBackground: z.string(),
	selectionForeground: z.string(),
	black: z.string(),
	brightBlack: z.string(),
	white: z.string(),
	brightWhite: z.string(),
	scrollbarThumb: z.string(),
	scrollbarThumbHover: z.string(),
});
export type TerminalTheme = z.infer<typeof terminalThemeSchema>;

export const terminalFrameReadySchema = z.object({
	type: z.literal("terminal:ready"),
	protocolVersion: z.literal(TERMINAL_PROTOCOL_VERSION),
});

export const terminalFrameConnectSchema = z.object({
	type: z.literal("terminal:connect"),
	protocolVersion: z.literal(TERMINAL_PROTOCOL_VERSION),
	theme: terminalThemeSchema,
});

export const terminalFrameThemeSchema = z.object({
	type: z.literal("terminal:theme"),
	protocolVersion: z.literal(TERMINAL_PROTOCOL_VERSION),
	theme: terminalThemeSchema,
});

export const terminalFrameLabelSchema = z.object({
	type: z.literal("terminal:label"),
	protocolVersion: z.literal(TERMINAL_PROTOCOL_VERSION),
	label: terminalLabelSchema,
});

export const terminalFrameHostMessageSchema = z.discriminatedUnion("type", [
	terminalFrameReadySchema,
	terminalFrameLabelSchema,
]);
export type TerminalFrameHostMessage = z.infer<typeof terminalFrameHostMessageSchema>;
