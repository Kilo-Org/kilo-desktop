import { z } from "zod";

/**
 * The terminal's wire protocol between a frame and main, over a port opened
 * as `kilo.terminal/session`. Zod only, so the frame bundle stays small.
 */
export const TERMINAL_PROTOCOL_VERSION = 4;
export const MAX_TERMINAL_LABEL_LENGTH = 128;

export const terminalLabelSchema = z.string().min(1).max(MAX_TERMINAL_LABEL_LENGTH);

export const terminalIdentitySchema = z.object({
	sessionId: z.string().min(1).max(512),
	terminalId: z.string().min(1).max(512),
});
export type TerminalIdentity = z.infer<typeof terminalIdentitySchema>;

export const terminalConnectionArgsSchema = terminalIdentitySchema.extend({
	protocolVersion: z.literal(TERMINAL_PROTOCOL_VERSION),
	cwd: z.string().min(1).max(32_768).optional(),
	cols: z.number().int().min(2).max(1_000),
	rows: z.number().int().min(1).max(500),
	initialLabel: terminalLabelSchema,
});
export type TerminalConnectionArgs = z.infer<typeof terminalConnectionArgsSchema>;

export const terminalStatusSchema = z.enum(["starting", "running", "exited", "error", "closed"]);
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;

export const terminalClientMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("input"),
		requestId: z.string().min(1).max(128),
		data: z.string().min(1).max(65_536),
	}),
	z.object({
		type: z.literal("resize"),
		cols: z.number().int().min(2).max(1_000),
		rows: z.number().int().min(1).max(500),
	}),
	z.object({ type: z.literal("clear"), requestId: z.string().min(1).max(128) }),
	z.object({ type: z.literal("restart"), requestId: z.string().min(1).max(128) }),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export const terminalSnapshotSchema = z.object({
	type: z.literal("snapshot"),
	status: terminalStatusSchema,
	cwd: z.string().min(1),
	history: z.string(),
	acceptedInputCount: z.number().int().nonnegative(),
	exitCode: z.number().int().nullable(),
	exitSignal: z.number().int().nullable(),
	label: terminalLabelSchema,
});

export const terminalServerMessageSchema = z.discriminatedUnion("type", [
	terminalSnapshotSchema,
	z.object({ type: z.literal("output"), data: z.string() }),
	z.object({ type: z.literal("cleared") }),
	z.object({ type: z.literal("input-accepted"), count: z.number().int().nonnegative() }),
	z.object({ type: z.literal("label"), label: terminalLabelSchema }),
	z.object({
		type: z.literal("status"),
		status: terminalStatusSchema,
		exitCode: z.number().int().nullable().optional(),
		exitSignal: z.number().int().nullable().optional(),
	}),
	z.object({
		type: z.literal("ack"),
		requestId: z.string().min(1).max(128),
		ok: z.boolean(),
		error: z.string().optional(),
	}),
	z.object({ type: z.literal("error"), message: z.string().min(1) }),
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;

export const MAX_TERMINAL_READ_LINES = 2_000;

export const terminalReadoutSchema = z.object({
	/** "closed" when no shell is attached and only the saved transcript remains. */
	status: terminalStatusSchema,
	label: terminalLabelSchema.nullable(),
	cwd: z.string().nullable(),
	exitCode: z.number().int().nullable(),
	exitSignal: z.number().int().nullable(),
	/** Plain text of the last `lines` lines; escape sequences removed. */
	text: z.string(),
	lineCount: z.number().int().nonnegative(),
	truncated: z.boolean(),
});
export type TerminalReadout = z.infer<typeof terminalReadoutSchema>;
