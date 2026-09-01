import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import type {
	CondaEnvsCreateInput,
	CondaEnvsCreateResult,
	CondaEnvsDeleteInput,
	CondaEnvsDeleteResult,
	CondaPackagesListInput,
	CondaPackagesListResult,
} from "../../../contracts/providers/conda.js";
import { condaContract } from "../../../contracts/providers/conda.js";
import type { JobQueue } from "../../JobQueue.js";

import type { CondaBackend } from "./CondaBackend.js";

/**
 * Bind provider-scoped main-process handlers.
 *
 * Semantics (per delivery plan sub-issues 4 – 6):
 * - **Reads** (`conda.envs.list`) go through {@link JobQueue.read} — a
 *   5 s TTL cache keyed on `(providerId, opName, args)` bypasses the
 *   backend round-trip on repeat calls and is cleared automatically by
 *   any successful write for the same provider.
 * - **Writes** (`conda.envs.create`, `conda.envs.delete`) go through
 *   {@link JobQueue.enqueue} — a per-provider FIFO worker with
 *   `queued` → `running` → terminal progress events emitted on
 *   `environments.job-progress`. The queue-assigned `jobId` is
 *   returned inline on the response so the renderer can correlate
 *   subsequent events (and drive `conda.jobs.cancel` in sub-issue 9)
 *   without a separate lookup.
 *
 * Kept as a free function (not a method on `CondaProvider`) so it can be
 * unit-tested in isolation with a stub backend and a fake `MainSdk`.
 */
export function registerCondaHandlers(
	mainSdk: MainSdk,
	backend: CondaBackend,
	queue: JobQueue,
): void {
	const handlers = mainSdk.channels(condaContract);
	handlers.handle("conda.envs.list", () =>
		queue.read({
			providerId: "conda",
			opName: "envs.list",
			run: (ctx) => backend.list({ signal: ctx.signal }),
		}),
	);

	handlers.handle(
		"conda.envs.create",
		(input: CondaEnvsCreateInput): Promise<CondaEnvsCreateResult> =>
			enqueueEnvsCreate(queue, backend, input),
	);

	handlers.handle(
		"conda.envs.delete",
		(input: CondaEnvsDeleteInput): Promise<CondaEnvsDeleteResult> =>
			enqueueEnvsDelete(queue, backend, input),
	);

	handlers.handle(
		"conda.packages.list",
		(input: CondaPackagesListInput): Promise<CondaPackagesListResult> =>
			queue.read({
				providerId: "conda",
				opName: "packages.list",
				args: { envName: input.envName, prefix: input.prefix },
				run: (ctx) =>
					backend
						.listPackages(
							input.envName,
							{ signal: ctx.signal },
							input.prefix ? { prefix: input.prefix } : undefined,
						)
						.then((packages) => ({
							envName: input.envName,
							packages,
						})),
			}),
	);

	// conda.packages.install / packages.remove / channels.* / jobs.cancel
	// are wired in sub-issues 7 – 9 alongside their CondaBackend
	// implementations, enqueued through `queue.enqueue(...)` (writes).
}

async function enqueueEnvsCreate(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsCreateInput,
): Promise<CondaEnvsCreateResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.create",
		run: (ctx) => backend.create(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	const environment = await result;
	return { jobId, environment };
}

async function enqueueEnvsDelete(
	queue: JobQueue,
	backend: CondaBackend,
	input: CondaEnvsDeleteInput,
): Promise<CondaEnvsDeleteResult> {
	const { jobId, result } = queue.enqueue({
		providerId: "conda",
		kind: "envs.delete",
		run: (ctx) => backend.remove(input, { signal: ctx.signal, onProgress: ctx.onProgress }),
	});
	await result;
	return { jobId, name: input.name };
}
