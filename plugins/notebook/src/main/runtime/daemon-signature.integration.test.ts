import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { MACOS_RUNTIMED_REQUIREMENT, verifyRuntimedSignature } from "./daemon-peer-authenticator";

/**
 * The signing requirement is only ever evaluated by `/usr/bin/codesign`, and a
 * malformed requirement makes codesign exit non-zero — indistinguishable from
 * an untrusted image, so a typo would silently deny every attached daemon.
 * These run the real macOS tooling rather than a stub.
 */
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
const NTERACT_NIGHTLY_DAEMON = "/Applications/nteract Nightly.app/Contents/MacOS/runtimed";

describe.runIf(darwin)("verifyRuntimedSignature (darwin)", () => {
	it("compiles as a valid code requirement", async () => {
		await expect(
			execFileAsync("/usr/bin/csreq", [`-r=${MACOS_RUNTIMED_REQUIREMENT}`, "-t"]),
		).resolves.toBeDefined();
	});

	it("rejects an Apple-signed executable outside the trusted teams", async () => {
		expect(await verifyRuntimedSignature("/bin/ls")).toBe(false);
	});

	it.runIf(existsSync(NTERACT_NIGHTLY_DAEMON))(
		"accepts the daemon shipped in an installed nteract Nightly app",
		async () => {
			expect(await verifyRuntimedSignature(NTERACT_NIGHTLY_DAEMON)).toBe(true);
		},
	);
});
