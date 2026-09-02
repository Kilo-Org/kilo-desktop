import { useFeatureFlag, useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { EnvironmentsStatusService } from "../contracts/status.js";

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
 * Two-gate guard:
 * 1. **Feature flag** (`environments-feature`) — off by default.
 * 2. **Provider boot status** (`environments.status`) — when the flag is on
 *    but no provider booted (e.g. bridge payload missing), the page shows an
 *    informational placeholder instead of rendering panels whose `sdk.invoke`
 *    calls would fail with `FeatureError NOT_FOUND`.
 *
 * v1 ships a single provider (Conda). Rather than pretending to be a
 * multi-tab strip before there is a second provider, the page renders the
 * Conda tab as a labelled section — the structure that graduates to a
 * true tab strip once a second provider (uv, pip, ...) is registered.
 */
export function EnvironmentsPage() {
	const featureEnabled = useFeatureFlag<boolean>(FEATURE_FLAG_KEY, false);
	const sdk = useSdk<EnvironmentsStatusService>("environments");
	const statusQuery = useSdkQuery(sdk, "environments.status");

	if (!featureEnabled) {
		return (
			<div
				className="flex h-full min-h-0 flex-col"
				data-qa-id="environments-page"
				data-state="flag-off"
			>
				<div className="mx-auto w-full max-w-xl px-5 py-8">
					<p className="text-muted-foreground text-sm" data-qa-id="environments-flag-off-message">
						This feature is not enabled for your account.
					</p>
				</div>
			</div>
		);
	}

	// Wait for the status query before mounting provider panels. In Electron
	// mode mainRegister completes before the renderer mounts, so this resolves
	// instantly. Rendering early would let CondaEnvironmentsPanel call
	// conda.envs.list against an unregistered handler, flashing a transient
	// error before the "unavailable" placeholder takes over.
	if (statusQuery.isLoading) return null;

	const providersAvailable = statusQuery.data?.providersAvailable ?? false;
	if (!providersAvailable) {
		return (
			<div
				className="flex h-full min-h-0 flex-col"
				data-qa-id="environments-page"
				data-state="unavailable"
			>
				<div className="mx-auto w-full max-w-xl px-5 py-8">
					<p
						className="text-muted-foreground text-sm"
						data-qa-id="environments-unavailable-message"
					>
						Environments is unavailable. The conda bridge payload was not found. Check the
						application logs for details.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-qa-id="environments-page">
			{/*
			 * Labelled via `aria-label` rather than `aria-labelledby`: the visual
			 * "Conda" heading is gone (a single provider needs no sub-heading), so
			 * there is no element left to point at. When a second provider lands
			 * this becomes a tab strip and each panel regains a visible label.
			 */}
			<section
				className="flex min-h-0 flex-1 flex-col"
				aria-label="Conda"
				data-qa-id="environments-provider-conda"
			>
				<CondaEnvironmentsPanel />
			</section>
		</div>
	);
}
