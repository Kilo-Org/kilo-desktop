export type StagingErrorCode =
	| "INSTALLER_DOWNLOAD_FAILED"
	| "INSTALLER_SHA_MISMATCH"
	| "STAGING_FAILED";

export class StagingError extends Error {
	override readonly name = "StagingError";
	constructor(
		message: string,
		readonly code: StagingErrorCode,
	) {
		super(message);
	}
}
