import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { condaContract } from "../../../contracts/providers/conda.js";

import type { CondaBackend } from "./CondaBackend.js";

/**
 * Bind provider-scoped main-process handlers. Sub-issue 4 wires only
 * `conda.envs.list` — the safest op, and enough to prove the full
 * pipeline (handler → service → execa → JSON → renderer). Subsequent
 * slices layer create/delete/install/etc. on the same {@link CondaBackend}
 * shape via `mainSdk.channels(condaContract).handle(...)` calls.
 *
 * Kept as a free function (not a method on `CondaProvider`) so it can be
 * unit-tested in isolation with a stub backend and a fake `MainSdk` from
 * `@anaconda-agentic-desktop/testing`.
 */
export function registerCondaHandlers(mainSdk: MainSdk, backend: CondaBackend): void {
	const handlers = mainSdk.channels(condaContract);
	handlers.handle("conda.envs.list", () => backend.list());
	// conda.envs.create / delete / packages.* / channels.* / jobs.cancel are
	// wired in sub-issues 6 – 9 alongside their CondaService implementations.
}
