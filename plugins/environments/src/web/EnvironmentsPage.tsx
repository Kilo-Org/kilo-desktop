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
		<div
			className="mx-auto flex h-full max-w-5xl flex-col px-5 py-8"
			data-qa-id="environments-page"
		>
			<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="environments-heading">
				Environments
			</h1>

			{/*
			 * Labelled via `aria-label` rather than `aria-labelledby`: the visual
			 * "Conda" heading is gone (a single provider needs no sub-heading), so
			 * there is no element left to point at. When a second provider lands
			 * this becomes a tab strip and each panel regains a visible label.
			 */}
			<section
				className="mt-6 flex min-h-0 flex-1 flex-col"
				aria-label="Conda"
				data-qa-id="environments-provider-conda"
			>
				<CondaEnvironmentsPanel />
			</section>
		</div>
	);
}
