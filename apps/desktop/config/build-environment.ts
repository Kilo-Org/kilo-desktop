import type { AppEnvironment } from "./app-identity.js";
import type { PublishableReleaseChannel } from "./release.js";

type ViteCommand = "build" | "serve";

/** Select the checked-in Vite environment used by this invocation. */
export function getBuildEnvironment(
	command: ViteCommand,
	releaseChannel: PublishableReleaseChannel,
): AppEnvironment {
	return command === "serve" ? "development" : releaseChannel;
}

/** Fail during bundling rather than leaving login broken at runtime. */
export function requireViteEnvironmentVariable(
	environment: AppEnvironment,
	values: Readonly<Record<string, string>>,
	key: string,
): string {
	const value = values[key]?.trim();
	if (!value) {
		throw new Error(`${key} must be configured in apps/desktop/.env.${environment}.`);
	}
	return value;
}

/** Convert values returned by Vite's loadEnv into compile-time replacements. */
export function createViteEnvironmentDefinitions(
	values: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
	);
}
