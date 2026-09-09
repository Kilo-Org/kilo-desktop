export interface CatalogDownloadArtifact {
	readonly modelId: string;
	readonly quantizationId: string;
	readonly modelName: string;
	readonly publisher: string;
	readonly quantization: string;
	readonly sizeBytes: number;
	readonly sha256: string;
}

export interface ModelDownloadIdentity {
	readonly modelId: string;
	readonly quantizationId: string;
}
