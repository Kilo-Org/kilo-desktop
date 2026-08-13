import { useFeatureFlag } from "@anaconda-agentic-desktop/sdk-react";

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
 * fetching, no provider tabs. The nav entry contributed by the plugin
 * manifest stays visible, matching the anaconda-mcp precedent.
 *
 * v1 scaffold (sub-issue 1): the plugin ships with no registered
 * environment providers yet, so the page renders the empty state. Sub-issue
 * 4 introduces the provider tab strip driven by the registered providers,
 * along with the props (and cross-boundary `RegisteredProviderInfo` shape)
 * needed to feed it. Keeping the empty state as the only rendering path in
 * this slice keeps the surface tight — no unreachable JSX or unused public
 * prop types shipping ahead of their real consumer.
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
		<div className="mx-auto max-w-xl px-5 py-8" data-qa-id="environments-page">
			<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="environments-heading">
				Environments
			</h1>
			<p className="text-muted-foreground mt-2 text-sm" data-qa-id="environments-empty-state">
				No environment providers available yet. Conda support is on the way.
			</p>
		</div>
	);
}
