import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";

import { AccountPanel } from "../../contracts";

/**
 * Settings → Account: one bordered panel per contribution to
 * `kilo.shell/account-panel`, in priority order. Account plugins (Kilo,
 * Anaconda) own their panels' content; the shell only frames them.
 */
export function AccountSettings() {
	const panels = useExtensions(AccountPanel);

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="account-page">
			<SettingsPageHeader />
			<section
				className="flex min-w-0 flex-col gap-4"
				aria-label="Accounts"
				data-qa-id="account-rows"
			>
				{panels.map((panel) => (
					<section
						key={panel.key}
						// `empty:hidden`: a panel may render nothing; don't leave an empty frame behind.
						className="border-border bg-card min-w-0 overflow-hidden rounded-lg border empty:hidden"
						data-qa-id={`account-panel-${panel.key}`}
					>
						<RenderContribution contribution={panel} />
					</section>
				))}
				{panels.length === 0 ? (
					<p className="text-muted-foreground text-sm" data-qa-id="account-none">
						No accounts are available to sign in to.
					</p>
				) : null}
			</section>
		</div>
	);
}
