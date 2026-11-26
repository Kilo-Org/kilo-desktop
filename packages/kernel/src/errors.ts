export type KernelErrorCode =
	| "VALIDATION"
	| "NOT_FOUND"
	| "PERMISSION_DENIED"
	| "UNAVAILABLE"
	| "CONFLICT"
	| "TIMEOUT"
	| "BUSINESS"
	| "INTERNAL";

/**
 * An expected failure whose code and message survive process boundaries.
 * Anything else thrown across a boundary is scrubbed to a generic INTERNAL error.
 *
 * `detail` is local diagnostic text, such as a child process's own output. It
 * stays in this process: it is never serialized with the error, it is not
 * enumerable (so `JSON.stringify` and error-data collectors skip it), and a
 * failed service shows it on its `kernel/services` record.
 */
export class KernelError extends Error {
	readonly code: KernelErrorCode;
	declare readonly detail: string | undefined;

	constructor(
		code: KernelErrorCode,
		message: string,
		options?: { readonly cause?: unknown; readonly detail?: string },
	) {
		super(message, options);
		this.name = "KernelError";
		this.code = code;
		Object.defineProperty(this, "detail", { value: options?.detail, enumerable: false });
	}
}

export interface SerializedError {
	readonly code: KernelErrorCode;
	readonly message: string;
}

export const INTERNAL_ERROR_MESSAGE = "The operation failed.";

export function serializeError(error: unknown): SerializedError {
	if (error instanceof KernelError) return { code: error.code, message: error.message };
	return { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE };
}

export function deserializeError(serialized: SerializedError): KernelError {
	return new KernelError(serialized.code, serialized.message);
}

export function isKernelError(error: unknown, code?: KernelErrorCode): error is KernelError {
	return error instanceof KernelError && (code === undefined || error.code === code);
}
