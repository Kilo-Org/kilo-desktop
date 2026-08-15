import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { condaContract } from "../../../contracts/providers/conda.js";
import type { JobQueue } from "../../JobQueue.js";

import type { CondaBackend } from "./CondaBackend.js";

/**
 * Bind provider-scoped main-process handlers. Sub-issue 4 wired only
 * `conda.envs.list` directly on top of the backend; sub-issue 5 routes
 * the same op through the shared {@link JobQueue}'s read cache so
 * repeated calls within a 5 s window skip the `execa` round-trip and
 * are invalidated by any successful write for the same provider.
 *
 * Subsequent slices (6 – 9) layer create / delete / install / channels /
 * jobs.cancel on the same shape via `mainSdk.channels(condaContract)`
 * calls that funnel writes through `queue.enqueue(...)`.
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
	// conda.envs.create / delete / packages.* / channels.* / jobs.cancel are
	// wired in sub-issues 6 – 9 alongside their CondaService implementations,
	// enqueued through `queue.enqueue(...)` (writes) or `queue.read(...)`
	// (reads).
}
