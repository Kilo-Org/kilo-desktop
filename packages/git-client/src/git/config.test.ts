import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import { cleanupTestDirs, createTestDir, noopLogger } from "../test/util.js";
import { getGlobalConfigValue } from "./config.js";
import type { GlobalConfigExec } from "./config.js";

afterEach(cleanupTestDirs);

/**
 * The real executor seam: a git-client whose `GIT_CONFIG_GLOBAL` points at a
 * stub file, so global-config reads never touch the developer's real
 * `~/.gitconfig` — and the fixture fully determines the outcome. The
 * client-level override also beats any ambient `GIT_CONFIG_GLOBAL` a CI job
 * sets, keeping the fixture authoritative everywhere.
 */
async function execWithIsolatedGlobalConfig(gitconfig: string): Promise<GlobalConfigExec> {
	const dir = await createTestDir("desktop-git-test-config-global");
	const globalConfigPath = join(dir, ".gitconfig");
	await writeFile(globalConfigPath, gitconfig);
	const client = createGitClient({
		path: dir,
		env: { GIT_CONFIG_GLOBAL: globalConfigPath },
		logger: noopLogger,
	});
	return (args, name, options) => client.exec(args, name, options);
}

describe("git/config", () => {
	describe("getGlobalConfigValue", () => {
		it("returns the configured value of a global key", async () => {
			const exec = await execWithIsolatedGlobalConfig(`[init]
	defaultBranch = trunk
`);

			await expect(getGlobalConfigValue(exec, "init.defaultBranch")).resolves.toBe("trunk");
		});

		it("returns null when the key is not configured", async () => {
			const exec = await execWithIsolatedGlobalConfig("");

			await expect(getGlobalConfigValue(exec, "init.defaultBranch")).resolves.toBe(null);
		});

		it("returns only the value piece when the -z output carries a trailing delimiter", async () => {
			const exec = await execWithIsolatedGlobalConfig(`[init]
	defaultBranch = trunk
`);

			const value = await getGlobalConfigValue(exec, "init.defaultBranch");

			expect(value).toBe("trunk");
			expect(value).not.toContain("\0");
		});
	});
});
