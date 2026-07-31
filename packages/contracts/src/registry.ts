import { featureMethods } from "./features/feature-invoke.js";
import { shellMethods } from "./features/shell.js";
import { themeEvents, themeMethods } from "./features/theme.js";

export function mergeChannelMaps<A extends Record<string, unknown>>(a: A): A;
export function mergeChannelMaps<
	A extends Record<string, unknown>,
	B extends Record<string, unknown>,
>(a: A, b: B): A & B;
export function mergeChannelMaps<
	A extends Record<string, unknown>,
	B extends Record<string, unknown>,
	C extends Record<string, unknown>,
>(a: A, b: B, c: C): A & B & C;
export function mergeChannelMaps<
	A extends Record<string, unknown>,
	B extends Record<string, unknown>,
	C extends Record<string, unknown>,
	D extends Record<string, unknown>,
>(a: A, b: B, c: C, d: D): A & B & C & D;
export function mergeChannelMaps(
	...parts: Array<Record<string, unknown>>
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const part of parts) {
		for (const key of Object.keys(part)) {
			if (Object.hasOwn(result, key)) {
				throw new Error(`Duplicate IPC channel key: ${key}`);
			}
			result[key] = part[key];
		}
	}
	return result;
}

export const ipcMethods = mergeChannelMaps(shellMethods, themeMethods, featureMethods);
export const ipcEvents = mergeChannelMaps(themeEvents);
