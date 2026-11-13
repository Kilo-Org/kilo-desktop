import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
	MACOS_RUNTIMED_REQUIREMENT,
	verifyRuntimedSignature,
} from "./daemon-peer-authenticator.js";

/**
 * The signing requirement is only ever evaluated by `/usr/bin/codesign`, and a
 * malformed requirement makes codesign exit non-zero — indistinguishable from
 * an untrusted image, so a typo would silently deny every attached daemon.
 * These run the real macOS tooling rather than a stub.
 */
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
const INSTALLED_DAEMONS = [
	{ name: "Stable", path: "/Applications/nteract.app/Contents/MacOS/runtimed" },
	{ name: "Nightly", path: "/Applications/nteract Nightly.app/Contents/MacOS/runtimed" },
] as const;

describe.runIf(darwin)("verifyRuntimedSignature (darwin)", () => {
	it("trusts the stable bundled basename without retaining the nightly signer exception", () => {
		expect(MACOS_RUNTIMED_REQUIREMENT).toContain(
			'certificate leaf[subject.OU] = "Z5788K4JT7" and identifier "runtimed"',
		);
		expect(MACOS_RUNTIMED_REQUIREMENT).not.toContain('identifier "runtimed-nightly"');
	});

	it("compiles as a valid code requirement", async () => {
		await expect(
			execFileAsync("/usr/bin/csreq", [`-r=${MACOS_RUNTIMED_REQUIREMENT}`, "-t"]),
		).resolves.toBeDefined();
	});

	it("rejects an Apple-signed executable outside the trusted teams", async () => {
		expect(await verifyRuntimedSignature("/bin/ls")).toBe(false);
	});

	for (const daemon of INSTALLED_DAEMONS) {
		it.runIf(existsSync(daemon.path))(
			`accepts the daemon shipped in an installed nteract ${daemon.name} app`,
			async () => {
				expect(await verifyRuntimedSignature(daemon.path)).toBe(true);
			},
		);
	}
});
