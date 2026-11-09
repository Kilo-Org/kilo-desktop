const FORBIDDEN_NODE_SWITCH = /^(?:inspect(?:-[a-z-]+)?|debug(?:-brk|-port)?|js-flags)$/;

const FORBIDDEN_CHROMIUM_SWITCHES = [
	"remote-debugging-port",
	"remote-debugging-pipe",
	"remote-allow-origins",
] as const;

// Chromium switches via hasSwitch (its own parser); Node switches from argv,
// which Chromium's parser does not recognize.
export function hasForbiddenDebugArgs(
	argv: readonly string[],
	hasSwitch: (name: string) => boolean,
): boolean {
	if (FORBIDDEN_CHROMIUM_SWITCHES.some((name) => hasSwitch(name))) return true;
	return argv.some((argument) => {
		const name = /^--?([^=]+)/.exec(argument)?.[1];
		return name !== undefined && FORBIDDEN_NODE_SWITCH.test(name.toLowerCase());
	});
}
