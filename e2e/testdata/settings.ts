export type SettingsSection = {
	id: string;
	title: string;
	/** Behind the Kilo sign-in gate: signed-out profiles see the sign-in card instead of the page header. */
	signInGated?: boolean;
	/**
	 * Root rendered only once the gate lets the user in. Gated pages show their heading in the
	 * gate's loading fallback too, so the heading alone does not prove the page opened.
	 */
	contentTestId?: string;
};

/** The settings categories (`kilo.shell/settings-category`). */
export const SETTINGS_GROUPS = [
	{ id: "general", label: "General" },
	{ id: "ai", label: "AI" },
	// kilo.developer runs behind the `developer` flag, which package:e2e forces on.
	{ id: "developer", label: "Developer" },
] as const;

/**
 * Behind `environments-feature` (forced on by `package:e2e`). Kept out of `SETTINGS_SECTIONS`:
 * opening it starts the conda bridge, so only the environments fixture's conda sandbox opens it.
 */
export const CONDA_ENVIRONMENTS_SECTION: SettingsSection = {
	id: "environments",
	title: "Conda Environments",
	signInGated: true,
	contentTestId: "environments-page",
};

/**
 * Every bundled settings section (`kilo.shell/settings-section`), as origin
 * listed them, except `CONDA_ENVIRONMENTS_SECTION`. Diagnostics (kilo.developer)
 * and External AI apps (kilo.core's `external-api-apps-settings`) are flag-gated;
 * `package:e2e` forces both flags on. Notebooks is sign-in gated.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{ id: "about", title: "About" },
	{ id: "account", title: "Account" },
	{ id: "appearance", title: "Appearance" },
	{ id: "keyboard-shortcuts", title: "Shortcuts" },
	{ id: "diagnostics", title: "Diagnostics" },
	{
		id: "notebooks",
		title: "Notebooks",
		signInGated: true,
		contentTestId: "notebook-settings",
	},
	{ id: "notifications", title: "Notifications" },
	{ id: "privacy", title: "Privacy" },
	{ id: "ai-providers", title: "AI Providers" },
	{ id: "kilo-marketplace", title: "Agent Behavior" },
	{
		id: "local-model-server",
		title: "Local Model Server",
		contentTestId: "local-model-server-page",
	},
	{ id: "external-ai-apps", title: "External AI apps" },
];
