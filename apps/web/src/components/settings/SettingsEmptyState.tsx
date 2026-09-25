import { SettingsIcon } from "lucide-react";

import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

/**
 * Shown at `/settings` when no settings sections are visible (no plugin has
 * contributed one, or every contribution is flag-gated off / Electron-only
 * in browser mode).
 */
export function SettingsEmptyState() {
	return (
		<div className="mx-auto w-full max-w-3xl" data-qa-id="settings-empty">
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SettingsIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No settings available</EmptyTitle>
					<EmptyDescription>
						Plugins can contribute settings sections via <code>plugin.json</code>.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}
