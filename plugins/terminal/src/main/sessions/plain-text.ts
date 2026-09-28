/**
 * Converts a terminal transcript (raw PTY output) into the plain text a reader
 * would see, for handing to an agent. It models one line at a time: carriage
 * return, backspace, tab, in-line cursor moves, and erase-in-line, so spinners
 * and single-line progress bars collapse to their final state. Escape
 * sequences are otherwise dropped; cursor moves across lines and full-screen
 * programs (vim, htop) are not emulated and may read out of order.
 */

const ESC = 0x1b;
const TAB_WIDTH = 8;

interface LineState {
	cells: string[];
	cursor: number;
}

function writeCell(line: LineState, character: string) {
	while (line.cells.length < line.cursor) line.cells.push(" ");
	line.cells[line.cursor] = character;
	line.cursor += 1;
}

function csiNumber(params: string, fallback: number): number {
	const first = Number.parseInt(params.split(";")[0] ?? "", 10);
	return Number.isFinite(first) ? first : fallback;
}

function applyCsi(line: LineState, params: string, final: string) {
	switch (final) {
		case "K": {
			const mode = csiNumber(params, 0);
			if (mode === 0) line.cells.length = Math.min(line.cells.length, line.cursor);
			else if (mode === 1)
				for (let index = 0; index < Math.min(line.cursor + 1, line.cells.length); index += 1)
					line.cells[index] = " ";
			else line.cells = [];
			break;
		}
		case "G":
			line.cursor = Math.max(0, csiNumber(params, 1) - 1);
			break;
		case "C":
			line.cursor += Math.max(1, csiNumber(params, 1));
			break;
		case "D":
			line.cursor = Math.max(0, line.cursor - Math.max(1, csiNumber(params, 1)));
			break;
	}
}

/** Index just past a string-type sequence (OSC, DCS, PM, APC) terminated by BEL or ST. */
function stringSequenceEnd(input: string, start: number): number {
	for (let index = start; index < input.length; index += 1) {
		const code = input.charCodeAt(index);
		if (code === 0x07 || code === 0x9c) return index + 1;
		if (code === ESC && input.charCodeAt(index + 1) === 0x5c) return index + 2;
	}
	return input.length;
}

export function terminalPlainText(transcript: string): string {
	const lines: string[] = [];
	let line: LineState = { cells: [], cursor: 0 };
	const endLine = () => {
		lines.push(line.cells.join("").trimEnd());
		line = { cells: [], cursor: 0 };
	};

	let index = 0;
	while (index < transcript.length) {
		const code = transcript.charCodeAt(index);
		const next = transcript.charCodeAt(index + 1);
		const csiStart = code === 0x9b ? index + 1 : code === ESC && next === 0x5b ? index + 2 : -1;
		if (csiStart >= 0) {
			let cursor = csiStart;
			while (cursor < transcript.length) {
				const candidate = transcript.charCodeAt(cursor);
				if (candidate >= 0x40 && candidate <= 0x7e) break;
				cursor += 1;
			}
			applyCsi(line, transcript.slice(csiStart, cursor), transcript[cursor] ?? "");
			index = cursor + 1;
			continue;
		}
		if (code === ESC && [0x5d, 0x50, 0x5e, 0x5f].includes(next)) {
			index = stringSequenceEnd(transcript, index + 2);
			continue;
		}
		if ([0x9d, 0x90, 0x9e, 0x9f].includes(code)) {
			index = stringSequenceEnd(transcript, index + 1);
			continue;
		}
		if (code === ESC) {
			// Two-byte escapes, plus charset designations like ESC ( B.
			index += [0x28, 0x29, 0x2a, 0x2b].includes(next) ? 3 : 2;
			continue;
		}

		const character = String.fromCodePoint(transcript.codePointAt(index) ?? code);
		index += character.length;
		if (character === "\n") endLine();
		else if (character === "\r") line.cursor = 0;
		else if (character === "\b") line.cursor = Math.max(0, line.cursor - 1);
		else if (character === "\t") {
			const stop = (Math.floor(line.cursor / TAB_WIDTH) + 1) * TAB_WIDTH;
			while (line.cursor < stop) writeCell(line, " ");
		} else if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code < 0xa0))
			writeCell(line, character);
	}
	if (line.cells.length > 0) endLine();
	return lines.join("\n");
}

export interface TerminalTail {
	readonly text: string;
	readonly lineCount: number;
	readonly truncated: boolean;
}

/** The last `maxLines` non-trailing-blank lines of a transcript's plain text. */
export function terminalTail(transcript: string, maxLines: number): TerminalTail {
	const lines = terminalPlainText(transcript).split("\n");
	while (lines.length > 0 && lines.at(-1) === "") lines.pop();
	const tail = maxLines > 0 ? lines.slice(-maxLines) : [];
	return { text: tail.join("\n"), lineCount: tail.length, truncated: tail.length < lines.length };
}
