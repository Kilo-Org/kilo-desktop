import { Buffer } from "node:buffer";

export const coerceToString = (
	value: string | Buffer,
	encoding: BufferEncoding = "utf8",
): string => (Buffer.isBuffer(value) ? value.toString(encoding) : value);
