export type SettingsSection = {
	id: string;
	title: string;
	/** Behind `KiloAuthGate`: signed-out profiles see the sign-in card instead of the page header. */
	signInGated?: boolean;
	/**
	 * Root rendered only once the gate lets the user in. Gated pages show their heading in the
	 * gate's loading fallback too, so the heading alone does not prove the page opened.
	 */
	contentTestId?: string;
};

export const SETTINGS_GROUPS = [
	{ id: "general", label: "General" },
	{ id: "ai", label: "AI" },
] as const;

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{ id: "about", title: "About" },
	{ id: "account", title: "Account" },
	{ id: "appearance", title: "Appearance" },
	// Behind the LaunchDarkly `environments-feature` flag, which is off in e2e builds, so the
	// section is not rendered. Uncomment once the flag is enabled for e2e.
	// {
	// 	id: "environments",
	// 	title: "Conda Environments",
	// 	signInGated: true,
	// 	contentTestId: "environments-page",
	// },
	{
		id: "notebooks",
		title: "Notebooks",
		signInGated: true,
		contentTestId: "notebook-settings",
	},
	{ id: "notifications", title: "Notifications" },
	{ id: "privacy", title: "Privacy" },
	{ id: "kilo-marketplace", title: "Agent Behavior" },
	{ id: "kilo-providers", title: "AI Providers" },
	{
		id: "local-model-server",
		title: "Local Model Server",
		signInGated: true,
		contentTestId: "local-model-server-page",
	},
	{ id: "external-ai-apps", title: "External AI apps" },
];

/** Launch env that starts the e2e app signed out of Kilo (see `testAuthIdentity` in `apps/desktop/src/main/Application.ts`). */
export const SIGNED_OUT_LAUNCH_ENV = { KILO_E2E_SIGNED_OUT: "1" };
