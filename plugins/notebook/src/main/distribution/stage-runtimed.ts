import { getRuntimedArtifact, runtimedDownloadUrl, type RuntimedArtifact } from "./artifacts.js";
import {
	isNativeExecutable,
	stagePinnedBinary,
	type StagePinnedBinaryResult,
} from "./stage-pinned-binary.js";

export { isNativeExecutable };

export interface StageRuntimedOptions {
	readonly resourceRoot: string;
	readonly artifact?: RuntimedArtifact;
	readonly sourceBinaryPath?: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

export type StageRuntimedResult = StagePinnedBinaryResult;

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
