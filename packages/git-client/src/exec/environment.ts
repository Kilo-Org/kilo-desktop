import process from "node:process";

import { EnvMap } from "./env-map.js";

/**
 * Sane defaults applied on top of the inherited environment so git never treats
 * us as a smart terminal (`TERM: "dumb"`) and
 * never blocks on interactive credential prompts. Client-level and per-call env
 * overrides win over these defaults.
 */
const DEFAULT_ENV: Record<string, string | undefined> = {
	TERM: "dumb",
	GIT_TERMINAL_PROMPT: "0",
};

/**
 * Merge the environment for a git invocation.
 *
 * Precedence (lowest wins first): the inherited process environment, our
 * defaults, the client-level env, the per-call env. The merge goes through
 * `EnvMap` so on Windows environment keys stay case-insensitive while the
 * original casing of the first-seen key is preserved.
 *
 * An `undefined` value means "do not set this variable"; such entries are
 * removed from the result so every consumer gets a spawn-safe object.
 */
export function buildEnv(
	clientEnv: Record<string, string | undefined>,
	callEnv: Record<string, string | undefined> = {},
	processEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const env = new EnvMap([
		...Object.entries(processEnv),
		...Object.entries(DEFAULT_ENV),
		...Object.entries(clientEnv),
		...Object.entries(callEnv),
	]);

	return Object.fromEntries(
		[...env.entries()].filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}
