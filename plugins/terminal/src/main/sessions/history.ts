import { createHash } from "node:crypto";
import path from "node:path";

export const MAX_HISTORY_LINES = 5_000;
export const MAX_HISTORY_BYTES = 512 * 1024;

export interface HistorySanitizerState {
	readonly visibleText: string;
	readonly pendingControlSequence: string;
}

function capLines(history: string): string {
	const trailing = history.endsWith("\n");
	const lines = history.split("\n");
	if (trailing) lines.pop();
	if (lines.length <= MAX_HISTORY_LINES) return history;
	const result = lines.slice(-MAX_HISTORY_LINES).join("\n");
	return trailing ? `${result}\n` : result;
}

export function capHistory(history: string): string {
	const lineCapped = capLines(history);
	const bytes = Buffer.byteLength(lineCapped);
	if (bytes <= MAX_HISTORY_BYTES) return lineCapped;
	const buffer = Buffer.from(lineCapped);
	let start = buffer.length - MAX_HISTORY_BYTES;
	while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
	return buffer.subarray(start).toString("utf8");
}

function isCsiFinal(code: number): boolean {
	return code >= 0x40 && code <= 0x7e;
}

function stripCsi(body: string, final: string): boolean {
	return (
		final === "n" ||
		(final === "R" && /^[0-9;?]*$/.test(body)) ||
		(final === "c" && /^[>0-9;?]*$/.test(body)) ||
		((final === "p" || final === "y") && /^[0-9;?]*\$$/.test(body)) ||
		(final === "q" && /^>[0-9;]*$/.test(body)) ||
		(final === "u" && body.startsWith("?"))
	);
}

function stringEnd(input: string, start: number): number | null {
	for (let index = start; index < input.length; index += 1) {
		if (input.charCodeAt(index) === 0x07 || input.charCodeAt(index) === 0x9c) return index + 1;
		if (input.charCodeAt(index) === 0x1b && input.charCodeAt(index + 1) === 0x5c) return index + 2;
	}
	return null;
}

function contentWithoutTerminator(value: string): string {
	if (value.endsWith("\u001b\\")) return value.slice(0, -2);
	const finalCode = value.charCodeAt(value.length - 1);
	return finalCode === 0x07 || finalCode === 0x9c ? value.slice(0, -1) : value;
}

function stripString(kind: number, content: string): boolean {
	return (
		((kind === 0x5d || kind === 0x9d) && /^(10|11|12);(?:\?|rgb:)/.test(content)) ||
		((kind === 0x50 || kind === 0x90) && /^[01]?[$+][qr]/.test(content))
	);
}

export function sanitizeHistoryChunk(pending: string, data: string): HistorySanitizerState {
	const input = pending + data;
	let visibleText = "";
	let index = 0;
	while (index < input.length) {
		const code = input.charCodeAt(index);
		if (code === 0x1b && index + 1 >= input.length) {
			return { visibleText, pendingControlSequence: input.slice(index) };
		}
		const next = code === 0x1b ? input.charCodeAt(index + 1) : code;
		const csiStart = code === 0x9b ? index + 1 : code === 0x1b && next === 0x5b ? index + 2 : -1;
		if (csiStart >= 0) {
			let cursor = csiStart;
			while (cursor < input.length && !isCsiFinal(input.charCodeAt(cursor))) cursor += 1;
			if (cursor >= input.length)
				return { visibleText, pendingControlSequence: input.slice(index) };
			const body = input.slice(csiStart, cursor);
			if (!stripCsi(body, input[cursor] ?? "")) visibleText += input.slice(index, cursor + 1);
			index = cursor + 1;
			continue;
		}
		const stringKind =
			code === 0x1b && [0x5d, 0x50, 0x5e, 0x5f].includes(next)
				? next
				: [0x9d, 0x90, 0x9e, 0x9f].includes(code)
					? code
					: -1;
		if (stringKind >= 0) {
			const contentStart = code === 0x1b ? index + 2 : index + 1;
			const end = stringEnd(input, contentStart);
			if (end === null) return { visibleText, pendingControlSequence: input.slice(index) };
			const sequence = input.slice(index, end);
			const content = contentWithoutTerminator(input.slice(contentStart, end));
			if (!stripString(stringKind, content)) visibleText += sequence;
			index = end;
			continue;
		}
		visibleText += input[index] ?? "";
		index += 1;
	}
	return { visibleText, pendingControlSequence: "" };
}

export function historyPath(storageDir: string, sessionId: string, terminalId: string): string {
	const digest = createHash("sha256")
		.update(sessionId)
		.update("\0")
		.update(terminalId)
		.digest("hex");
	return path.join(storageDir, "history", `${digest}.log`);
}
