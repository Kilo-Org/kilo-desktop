/**
 * A settings section gated on a flag `package:e2e` forces on through
 * VITE_FEATURE_FLAG_OVERRIDES. Other flags come from LaunchDarkly (the
 * preview and stable builds carry a client-side ID), so no flag is reliably
 * off in e2e.
 */
export const flagsData = {
	flagOn: { flag: "external-api-apps-settings", sectionId: "external-ai-apps" },
	serviceKey: "kilo.flags/launchdarkly",
} as const;
