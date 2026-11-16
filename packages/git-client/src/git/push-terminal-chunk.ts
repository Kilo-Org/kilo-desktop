import { coerceToString } from "./coerce-to-string.js";

/**
 * Appends a chunk of terminal output to a buffer while maintaining a maximum capacity.
 *
 * This function manages a rolling buffer of terminal output (combined stdout and stderr)
 * by pushing new chunks and trimming from the beginning when the total character count
 * exceeds the specified capacity. This ensures memory-bounded storage of terminal output
 * for git operations.
 *
 * @param chunks - The array of string chunks representing the terminal output buffer.
 *                 This array is mutated in place.
 * @param capacity - The maximum number of characters to retain in the buffer.
 *                   Note: this is character count, not byte count.
 * @param chunk - The new chunk of terminal output to append, either as a Buffer or string.
 */
export const pushTerminalChunk = (
	chunks: string[],
	capacity: number,
	chunk: Buffer | string,
): void => {
	chunks.push(coerceToString(chunk));
	let terminalOutputLength = chunks.reduce((acc, cur) => acc + cur.length, 0);

	while (terminalOutputLength > capacity) {
		const firstChunk = chunks.shift();
		if (firstChunk === undefined) {
			break;
		}

		const overrun = terminalOutputLength - capacity;

		if (overrun >= firstChunk.length) {
			terminalOutputLength -= firstChunk.length;
		} else {
			chunks.unshift(firstChunk.substring(overrun));
			terminalOutputLength -= overrun;
		}
	}
};
