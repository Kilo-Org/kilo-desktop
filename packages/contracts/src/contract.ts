import type { z } from "zod";

export interface IpcMethodContract<
	TInput extends z.ZodType = z.ZodType,
	TOutput extends z.ZodType = z.ZodType,
> {
	readonly input: TInput;
	readonly output: TOutput;
}

export interface IpcEventContract<TPayload extends z.ZodType = z.ZodType> {
	readonly payload: TPayload;
}

export function defineMethod<TInput extends z.ZodType, TOutput extends z.ZodType>(
	input: TInput,
	output: TOutput,
): IpcMethodContract<TInput, TOutput> {
	return { input, output };
}

export function defineEvent<TPayload extends z.ZodType>(
	payload: TPayload,
): IpcEventContract<TPayload> {
	return { payload };
}

// ─── Feature contracts ───────────────────────────────────────────────────────

/**
 * Feature-contract helpers live in the SDK (channel-map.ts) so plugins can
 * define contracts without depending on this shell-internal package.
 * Re-exported here for the shell and for features still living in apps/.
 */
export { defineContract, type InferContract } from "@kilo-desktop/feature-sdk";
