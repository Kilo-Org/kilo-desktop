import type { ReactNode } from "react";

import { SettingsPageHeader, useFeatureFlag, useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";

import type { EnvironmentsStatusService } from "../contracts/status.js";

import {
	EnvironmentsPanel as CondaEnvironmentsPanel,
	EnvironmentsPanelLoading as CondaEnvironmentsPanelLoading,
} from "./providers/conda/EnvironmentsPanel.js";

/**
 * LaunchDarkly feature-flag key that gates the entire environments plugin.
 * Kept in sync with `FEATURE_FLAG_KEY` in
 * `plugins/environments/src/main/index.ts` — flipping this key on the
 * LaunchDarkly side enables both the main-side registration and the renderer
 * page in one step.
 */
const FEATURE_FLAG_KEY = "environments-feature";

/**
 * Environments settings section (plugin.json `contributes.settings`). Every
 * state renders a `SettingsPageHeader`; the detail view overrides its title.
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

	const providersAvailable = statusQuery.data?.providersAvailable ?? false;

	if (!featureEnabled) {
		return (
			<EnvironmentsLayout state="flag-off">
				<SettingsPageHeader />
				<p className="text-muted-foreground text-sm" data-qa-id="environments-flag-off-message">
					This feature is not enabled for your account.
				</p>
			</EnvironmentsLayout>
		);
	}

	// Wait for the status query before mounting provider panels. Rendering
	// early would let CondaEnvironmentsPanel call conda.envs.list against an
	// unregistered handler, flashing a transient error before the
	// "unavailable" placeholder takes over. The skeleton matches the panel's
	// own loading state so the two waits read as one.
	if (statusQuery.isLoading) {
		return (
			<EnvironmentsLayout state="loading">
				<CondaEnvironmentsPanelLoading />
			</EnvironmentsLayout>
		);
	}

	if (!providersAvailable) {
		return (
			<EnvironmentsLayout state="unavailable">
				<SettingsPageHeader />
				<p className="text-muted-foreground text-sm" data-qa-id="environments-unavailable-message">
					Conda Environments is unavailable. The conda bridge payload was not found. Check the
					application logs for details.
				</p>
			</EnvironmentsLayout>
		);
	}

	return (
		<EnvironmentsLayout>
			{/*
			 * Labelled via `aria-label` rather than `aria-labelledby`: the visual
			 * "Conda" heading is gone (a single provider needs no sub-heading), so
			 * there is no element left to point at. When a second provider lands
			 * this becomes a tab strip and each panel regains a visible label.
			 */}
			<section
				className="flex min-w-0 flex-col"
				aria-label="Conda"
				data-qa-id="environments-provider-conda"
			>
				<CondaEnvironmentsPanel />
			</section>
		</EnvironmentsLayout>
	);
}

function EnvironmentsLayout({
	state,
	children,
}: {
	state?: "loading" | "flag-off" | "unavailable";
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="environments-page" data-state={state}>
			{children}
		</div>
	);
}
