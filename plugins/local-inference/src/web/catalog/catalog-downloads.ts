import type { ModelDownload } from "../../contracts/schemas.js";

export type DownloadIdentity = Pick<ModelDownload, "modelId" | "quantizationId">;

export function catalogArtifactKey(identity: DownloadIdentity): string {
	return `${identity.modelId}\u0000${identity.quantizationId}`;
}

export function upsertDownload(
	downloads: readonly ModelDownload[] | undefined,
	download: ModelDownload,
): ModelDownload[] {
	const current = downloads ?? [];
	const key = catalogArtifactKey(download);
	return [...current.filter((entry) => catalogArtifactKey(entry) !== key), download];
}
