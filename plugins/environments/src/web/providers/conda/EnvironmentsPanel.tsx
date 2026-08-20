import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { CondaService } from "../../../contracts/providers/conda.js";

/**
 * Renderer panel for the conda provider's Environments tab.
 *
 * Reads `conda.envs.list` via `useSdkQuery` (see `packages/sdk-react`),
 * which pipes through the plugin's `mainRegister` handler and, in
 * production, calls `conda env list --json` inside the plugin-scoped base.
 *
 * v1 renders a read-only list: on-disk prefix + display name (base envs
 * surface as "base"). Create/delete controls and live-progress banners
 * arrive in a follow-up PR once the backend tools are proven end-to-end.
 *
 * The panel uses `data-qa-id` attributes for browser and e2e tests
 * following the repo convention (see `docs/TESTING.md`).
 */
export function EnvironmentsPanel() {
	const sdk = useSdk<CondaService>("environments");
	const envs = useSdkQuery(sdk, "conda.envs.list");

	if (envs.isPending) {
		return (
			<p className="text-muted-foreground text-sm" data-qa-id="environments-conda-loading">
				Loading environments…
			</p>
		);
	}

	if (envs.isError) {
		return (
			<p className="text-destructive text-sm" role="alert" data-qa-id="environments-conda-error">
				Could not load environments: {envs.error.message}
			</p>
		);
	}

	const rows = envs.data ?? [];

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm" data-qa-id="environments-conda-empty">
				No conda environments found.
			</p>
		);
	}

	return (
		<ul className="m-0 grid list-none gap-2 p-0" aria-label="Conda environments">
			{rows.map((env) => (
				<li key={env.prefix} className="rounded-md border p-3" data-qa-id="environments-conda-row">
					<div className="font-medium" data-qa-id="environments-conda-name">
						{env.name || "base"}
					</div>
					<div
						className="text-muted-foreground mt-0.5 truncate font-mono text-xs"
						data-qa-id="environments-conda-prefix"
					>
						{env.prefix}
					</div>
				</li>
			))}
		</ul>
	);
}
