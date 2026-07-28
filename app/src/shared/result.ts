import { z } from "zod";

export const ipcErrorCodes = [
	"VALIDATION",
	"AUTHORIZATION",
	"CANCELLED",
	"BUSINESS",
	"TRANSPORT",
	"INTERNAL",
] as const;

export const ipcErrorSchema = z.object({
	code: z.enum(ipcErrorCodes),
	message: z.string(),
});

export type IpcError = z.infer<typeof ipcErrorSchema>;

export type IpcResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: IpcError };

export function ipcResultSchema<T extends z.ZodType>(value: T) {
	return z.discriminatedUnion("ok", [
		z.object({ ok: z.literal(true), value }),
		z.object({ ok: z.literal(false), error: ipcErrorSchema }),
	]);
}
