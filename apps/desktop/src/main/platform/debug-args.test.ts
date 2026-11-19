import { describe, expect, it } from "vitest";

import { hasForbiddenDebugArgs } from "./debug-args.js";

/**
 * Stand-in for `app.commandLine.hasSwitch`: Chromium normalizes `-`/`--` and
 * (on Windows) case before parsing, so the fake answers from a normalized set.
 */
function fakeHasSwitch(...present: string[]): (name: string) => boolean {
	const set = new Set(present.map((name) => name.toLowerCase()));
	return (name) => set.has(name.toLowerCase());
}

const noSwitches = fakeHasSwitch();

describe("hasForbiddenDebugArgs", () => {
	it("flags Chromium remote-debugging switches via the command-line parser", () => {
		expect(hasForbiddenDebugArgs([], fakeHasSwitch("remote-debugging-port"))).toBe(true);
		expect(hasForbiddenDebugArgs([], fakeHasSwitch("remote-debugging-pipe"))).toBe(true);
		expect(hasForbiddenDebugArgs([], fakeHasSwitch("remote-allow-origins"))).toBe(true);
	});

	it("flags Node inspector arguments in any argv form", () => {
		expect(hasForbiddenDebugArgs(["--inspect"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["--inspect=127.0.0.1:9229"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["--inspect-brk"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["--inspect-wait"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["-inspect"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["--INSPECT"], noSwitches)).toBe(true);
	});

	it("flags legacy Node --debug family and --js-flags", () => {
		expect(hasForbiddenDebugArgs(["--debug-brk"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["--js-flags=--expose-gc"], noSwitches)).toBe(true);
		expect(hasForbiddenDebugArgs(["--js-flags", "--allow-natives-syntax"], noSwitches)).toBe(true);
	});

	it("ignores benign launch arguments", () => {
		expect(hasForbiddenDebugArgs(["/kilo"], noSwitches)).toBe(false);
		expect(
			hasForbiddenDebugArgs(
				["--user-data-dir=/tmp/profile", "kilo-desktop://app/#/plugins/chat"],
				noSwitches,
			),
		).toBe(false);
	});

	it("does not match substrings or unrelated switches", () => {
		expect(hasForbiddenDebugArgs(["--not-remote-debugging-port-really"], noSwitches)).toBe(false);
		expect(hasForbiddenDebugArgs(["--inspection-mode=full"], noSwitches)).toBe(false);
		expect(hasForbiddenDebugArgs(["--debugger-friendly"], noSwitches)).toBe(false);
	});
});
