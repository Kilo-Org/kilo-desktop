/**
 * Error type features throw from handlers (main-process or renderer) to signal
 * expected failures. The shell translates it across the IPC boundary so the
 * message and code survive intact, unlike generic errors which are scrubbed.
 */
export type FeatureErrorCode = "VALIDATION" | "NOT_FOUND" | "BUSINESS";

export class FeatureError extends Error {
	override readonly name = "FeatureError";

	constructor(
		message: string,
		readonly code: FeatureErrorCode = "BUSINESS",
	) {
		super(message);
	}
}
