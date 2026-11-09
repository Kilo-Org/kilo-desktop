import type { ReactNode } from "react";

import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";

import { useCondaStatus } from "./conda.js";
import { KiloSignInGate } from "./KiloSignInGate.js";
import {
	EnvironmentsPanel as CondaEnvironmentsPanel,
	EnvironmentsPanelLoading as CondaEnvironmentsPanelLoading,
} from "./providers/conda/EnvironmentsPanel.js";

/**
 * Environments settings section (plugin.json `contributes.settings`). Every
 * state renders a `SettingsPageHeader`; the detail view overrides its title.
 *
 * Guards, from `kilo.environments/conda`'s status:
 * 1. **Feature flag** (`environments-feature`) — off by default; the section
 *    is hidden then, so this shows only on a direct visit.
 * 2. **Bridge** — when the flag is on but the bundled bridge is missing, the
 *    page shows an informational placeholder instead of panels whose calls
 *    would fail.
 * 3. **Kilo sign-in** — signed out, the page is replaced by a sign-in prompt.
 *
 * v1 ships a single provider (Conda). Rather than pretending to be a
 * multi-tab strip before there is a second provider, the page renders the
 * Conda tab as a labelled section — the structure that graduates to a
 * true tab strip once a second provider (uv, pip, ...) is registered.
 */
export function EnvironmentsPage() {
	const status = useCondaStatus();

	// The feature flag is checked outside the Kilo gate so a signed-out user
	// sees "not enabled for your account" without a sign-in prompt they can't
	// act on (the flag-off state changes nothing with sign-in).
	if (status === "disabled") {
		return (
			<EnvironmentsLayout state="flag-off">
				<SettingsPageHeader />
				<p className="text-muted-foreground text-sm" data-qa-id="environments-flag-off-message">
					This feature is not enabled for your account.
				</p>
			</EnvironmentsLayout>
		);
	}

	return (
		<KiloSignInGate featureName="Conda Environments" pendingFallback={<EnvironmentsPageLoading />}>
			<EnvironmentsPageContent status={status} />
		</KiloSignInGate>
	);
}

/**
 * Shared by the auth-gate wait and the provider-status wait so the page shows
 * one continuous skeleton from mount until the panel's data lands.
 */
function EnvironmentsPageLoading() {
	return (
		<EnvironmentsLayout state="loading">
			<CondaEnvironmentsPanelLoading />
		</EnvironmentsLayout>
	);
}

function EnvironmentsPageContent({ status }: { status: "unavailable" | "ready" | null }) {
	// Wait for the status before mounting provider panels, so they never call
	// a domain that is not there yet. The skeleton matches the panel's own
	// loading state so the two waits read as one.
	if (status === null) return <EnvironmentsPageLoading />;

	if (status === "unavailable") {
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
