import { useFeatureFlag } from "@anaconda-agentic-desktop/sdk-react";

import { EnvironmentsPanel as CondaEnvironmentsPanel } from "./providers/conda/EnvironmentsPanel.js";

/**
 * LaunchDarkly feature-flag key that gates the entire environments plugin.
 * Kept in sync with `FEATURE_FLAG_KEY` in
 * `plugins/environments/src/main/index.ts` — flipping this key on the
 * LaunchDarkly side enables both the main-side registration and the renderer
 * page in one step.
 */
const FEATURE_FLAG_KEY = "environments-feature";

/**
 * `/environments` route (plugin.json `routes[0]`).
 *
 * Gated on the `environments-feature` flag. When off (default), a
 * "not enabled" placeholder renders instead of the page — no data
 * fetching, no provider tabs.
 *
 * v1 ships a single provider (Conda). Rather than pretending to be a
 * multi-tab strip before there is a second provider, the page renders the
 * Conda tab as a labelled section — the structure that graduates to a
 * true tab strip once a second provider (uv, pip, ...) is registered.
 * When that happens, this component reads the providers registered in a
 * renderer-side registry (a mirror of `main/ProviderRegistry`) and maps
 * each entry to its panel component.
 */
export function EnvironmentsPage() {
	const featureEnabled = useFeatureFlag<boolean>(FEATURE_FLAG_KEY, false);

	if (!featureEnabled) {
		return (
			<div
				className="mx-auto max-w-xl px-5 py-8"
				data-qa-id="environments-page"
				data-state="flag-off"
			>
				<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="environments-heading">
					Environments
				</h1>
				<p
					className="text-muted-foreground mt-2 text-sm"
					data-qa-id="environments-flag-off-message"
				>
					This feature is not enabled for your account.
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl px-5 py-8" data-qa-id="environments-page">
			<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="environments-heading">
				Environments
			</h1>
			<p className="text-muted-foreground mt-1 text-sm">
				Manage conda environments installed in the plugin-scoped base.
			</p>

			<section
				className="mt-6"
				aria-labelledby="environments-provider-conda-heading"
				data-qa-id="environments-provider-conda"
			>
				<h2
					id="environments-provider-conda-heading"
					className="mb-3 text-sm font-medium tracking-wide uppercase"
				>
					Conda
				</h2>
				<CondaEnvironmentsPanel />
			</section>
		</div>
	);
}
