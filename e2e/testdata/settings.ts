import { registeredPluginIds } from "../utils/registered-specs.js";
import { repoRoot } from "../utils/paths.js";

export type SettingsSection = {
	id: string;
	title: string;
	/** The plugin that contributes the section; expected only once that plugin is registered. */
	owner: string;
	/** Behind `KiloAuthGate`: signed-out profiles see the sign-in card instead of the page header. */
	signInGated?: boolean;
	/**
	 * Root rendered only once the gate lets the user in. Gated pages show their heading in the
	 * gate's loading fallback too, so the heading alone does not prove the page opened.
	 */
	contentTestId?: string;
};

const ALL_SETTINGS_GROUPS = [
	{ id: "general", label: "General", owner: "kilo.shell" },
	{ id: "ai", label: "AI", owner: "kilo.agent" },
	{ id: "developer", label: "Developer", owner: "kilo.developer" },
] as const;

const ALL_SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{ id: "about", title: "About", owner: "kilo.updates" },
	{ id: "account", title: "Account", owner: "kilo.account" },
	{ id: "appearance", title: "Appearance", owner: "kilo.shell" },
	{ id: "keyboard-shortcuts", title: "Shortcuts", owner: "kilo.shell" },
	// kilo.developer runs behind the `developer` flag, which package:e2e forces on.
	{ id: "diagnostics", title: "Diagnostics", owner: "kilo.developer" },
	// Behind the LaunchDarkly `environments-feature` flag, which package:e2e does not force on,
	// so whether the section renders depends on LaunchDarkly. Uncomment once package:e2e
	// adds the flag to VITE_FEATURE_FLAG_OVERRIDES.
	// {
	// 	id: "environments",
	// 	title: "Conda Environments",
	// 	owner: "kilo.environments",
	// 	signInGated: true,
	// 	contentTestId: "environments-page",
	// },
	{
		id: "notebooks",
		title: "Notebooks",
		owner: "kilo.notebook",
		signInGated: true,
		contentTestId: "notebook-settings",
	},
	{ id: "notifications", title: "Notifications", owner: "kilo.workbench" },
	{ id: "privacy", title: "Privacy", owner: "kilo.telemetry" },
	{ id: "kilo-marketplace", title: "Agent Behavior", owner: "kilo.marketplace" },
	{ id: "kilo-providers", title: "AI Providers", owner: "kilo.agent" },
	{
		id: "local-model-server",
		title: "Local Model Server",
		owner: "kilo.local-inference",
		signInGated: true,
		contentTestId: "local-model-server-page",
	},
	{ id: "external-ai-apps", title: "External AI apps", owner: "kilo.agent" },
];

const registered = registeredPluginIds(repoRoot);

/** Groups whose plugin is registered in this build-up step. */
export const SETTINGS_GROUPS = ALL_SETTINGS_GROUPS.filter((group) => registered.has(group.owner));

/** Sections whose plugin is registered in this build-up step. */
export const SETTINGS_SECTIONS = ALL_SETTINGS_SECTIONS.filter((section) =>
	registered.has(section.owner),
);
