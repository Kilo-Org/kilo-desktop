/**
 * Renderer entry for the `environments` plugin.
 *
 * `EnvironmentsPage` is the page component named by the manifest route
 * (`plugin.json` `routes[].component`) — the shell resolves it here and
 * mounts it when `/environments` is visited. `EnvironmentsNavIcon` is the
 * sidebar icon.
 *
 * `webRegister` runs in both Electron and browser mode (see
 * {@link FeatureRegistration.webRegister}). It is intentionally empty in
 * the sub-issue 1 scaffold; per-provider WebMCP tool registrations
 * (`conda.envs.list`, `conda.packages.install`, …) land alongside their
 * handlers in sub-issues 4 – 9 by delegating to
 * `providers/<id>/tools.registerTools(sdk)`.
 */
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

export { EnvironmentsPage } from "./EnvironmentsPage.js";
export { EnvironmentsNavIcon } from "./EnvironmentsNavIcon.js";

export function webRegister(_sdk: SDK): void {
	// Intentionally empty — per-provider tool registrations follow in later
	// slices via `providers/<id>/tools.ts`.
}
