import {
	findRuntArtifact,
	getRuntArtifact,
	runtDownloadUrl,
	type RuntArtifact,
} from "./artifacts.js";
import { stagePinnedBinary, type StagePinnedBinaryResult } from "./stage-pinned-binary.js";

export interface StageRuntOptions {
	readonly resourceRoot: string;
	readonly artifact?: RuntArtifact;
	readonly sourceBinaryPath?: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

export type StageRuntResult = StagePinnedBinaryResult;

/**
 * Stages the host-platform `runt-nightly` CLI when one is published for this
 * target. Returns `undefined` on platforms without a release asset (Windows
 * today) so callers can skip MCP seeding without failing the prepare step.
 */
export async function stageRunt(options: StageRuntOptions): Promise<StageRuntResult | undefined> {
	const artifact = options.artifact ?? findRuntArtifact();
	if (!artifact) return undefined;
	return stagePinnedBinary({
		resourceRoot: options.resourceRoot,
		artifact,
		downloadUrl: runtDownloadUrl(artifact),
		label: "runt",
		...(options.sourceBinaryPath ? { sourceBinaryPath: options.sourceBinaryPath } : {}),
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
	});
}

export async function stageRuntOrThrow(options: StageRuntOptions): Promise<StageRuntResult> {
	const artifact = options.artifact ?? getRuntArtifact();
	return stagePinnedBinary({
		resourceRoot: options.resourceRoot,
		artifact,
		downloadUrl: runtDownloadUrl(artifact),
		label: "runt",
		...(options.sourceBinaryPath ? { sourceBinaryPath: options.sourceBinaryPath } : {}),
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
	});
}
