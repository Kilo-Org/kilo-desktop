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

export function defineIpcMethod<TInput extends z.ZodType, TOutput extends z.ZodType>(
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
