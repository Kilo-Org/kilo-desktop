import type { RegisteredProviderInfo } from "../main/EnvironmentProvider.js";

/**
 * `/environments` route (plugin.json `routes[0]`).
 *
 * v1 scaffold (sub-issue 1): the plugin ships with no registered
 * environment providers yet, so the page renders the empty state. Sub-issue
 * 4 wires the conda provider in and replaces the empty state with a tab
 * strip driven by the registered providers.
 *
 * The `providers` prop is defaulted to `[]` so the tab-strip rendering
 * pathway can land here in sub-issue 4 without moving the empty state; the
 * shell always mounts the component with no props (`PluginPageProps` are
 * ignored — see plan).
 */
export interface EnvironmentsPageProps {
	readonly providers?: readonly RegisteredProviderInfo[];
}

export function EnvironmentsPage({ providers = [] }: EnvironmentsPageProps) {
	if (providers.length === 0) {
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

	// Sub-issue 4 replaces this branch with a provider tab strip; keeping it
	// unreachable-but-typed here makes the future diff a UI-only change.
	return (
		<div className="mx-auto max-w-xl px-5 py-8" data-qa-id="environments-page">
			<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="environments-heading">
				Environments
			</h1>
			<ul className="text-muted-foreground mt-2 text-sm" data-qa-id="environments-provider-list">
				{providers.map((provider) => (
					<li key={provider.id}>{provider.displayName}</li>
				))}
			</ul>
		</div>
	);
}
