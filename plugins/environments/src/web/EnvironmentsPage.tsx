/**
 * `/environments` route (plugin.json `routes[0]`).
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
