import { getRuntimedArtifact, runtimedDownloadUrl, type RuntimedArtifact } from "../artifacts";
import { stagePinnedBinary, type StagePinnedBinaryResult } from "./stage-pinned-binary";

export interface StageRuntimedOptions {
	readonly resourceRoot: string;
	readonly artifact?: RuntimedArtifact;
	readonly sourceBinaryPath?: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

export type StageRuntimedResult = StagePinnedBinaryResult;

/** Stages the required host-platform singleton daemon for packaged builds. */
export async function stageRuntimed(options: StageRuntimedOptions): Promise<StageRuntimedResult> {
	const artifact = options.artifact ?? getRuntimedArtifact();
	return stagePinnedBinary({
		resourceRoot: options.resourceRoot,
		artifact,
		downloadUrl: runtimedDownloadUrl(artifact),
		label: "runtimed",
		...(options.sourceBinaryPath ? { sourceBinaryPath: options.sourceBinaryPath } : {}),
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
	});
}
