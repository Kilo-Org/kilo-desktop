/**
 * Shown at `/settings` when no settings sections are visible (no plugin has
 * contributed one, or every contribution is flag-gated off / Electron-only
 * in browser mode).
 */
export function SettingsEmptyState() {
	return (
		<div className="mx-auto max-w-xl" data-qa-id="settings-empty">
			<h1 className="text-lg font-semibold tracking-tight">Settings</h1>
			<p className="text-muted-foreground mt-1 text-sm">
				Plugins can contribute settings sections via <code>plugin.json</code>.
			</p>
		</div>
	);
}
