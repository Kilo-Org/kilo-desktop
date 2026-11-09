import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import type { GitClient } from "../client.js";
import { cleanupTestDirs, createTestDir, gitExec, initialize, noopLogger } from "../test/util.js";

afterEach(cleanupTestDirs);

/**
 * A git-client bound to `path` whose `GIT_CONFIG_GLOBAL` points at a stub
 * file holding the given `.gitconfig` contents, so global-config reads never
 * touch the developer's real `~/.gitconfig` — and the fixture fully
 * determines the outcome. The client-level override also beats any ambient
 * `GIT_CONFIG_GLOBAL` a CI job sets, keeping the fixture authoritative
 * everywhere and leaving process.env untouched (plain `*.test.ts` files may
 * share vitest workers).
 */
async function clientWithGlobalConfig(path: string, gitconfig: string): Promise<GitClient> {
	const dir = await createTestDir("desktop-git-test-init-global");
	const globalConfigPath = join(dir, ".gitconfig");
	await writeFile(globalConfigPath, gitconfig);
	return createGitClient({
		path,
		env: { GIT_CONFIG_GLOBAL: globalConfigPath },
		logger: noopLogger,
	});
}

describe("git/init", () => {
	describe("initRepository", () => {
		it("initializes a plain directory with the default branch main", async () => {
			const dir = await createTestDir("desktop-git-test-init-plain");
			const client = await clientWithGlobalConfig(dir, "");

			await client.initRepository();

			expect((await stat(join(dir, ".git"))).isDirectory()).toBe(true);
			expect((await gitExec(["symbolic-ref", "HEAD"], dir)).stdout).toBe("refs/heads/main\n");
		});

		it("honors the configured global init.defaultBranch", async () => {
			const dir = await createTestDir("desktop-git-test-init-trunk");
			const client = await clientWithGlobalConfig(dir, "[init]\n\tdefaultBranch = trunk\n");

			await client.initRepository();

			expect((await gitExec(["symbolic-ref", "HEAD"], dir)).stdout).toBe("refs/heads/trunk\n");
		});

		it("reinitializing an existing repository is a no-op that resolves", async () => {
			const repoPath = await initialize("init-existing", "main");
			const client = await clientWithGlobalConfig(repoPath, "");

			await client.initRepository();

			// The existing HEAD is left untouched.
			expect((await gitExec(["symbolic-ref", "HEAD"], repoPath)).stdout).toBe("refs/heads/main\n");
		});

		it("honors the cwd option over the client's path", async () => {
			const parent = await createTestDir("desktop-git-test-init-cwd");
			const dir = join(parent, "target");
			await mkdir(dir);
			const client = await clientWithGlobalConfig(parent, "");

			await client.initRepository({ cwd: dir });

			expect((await stat(join(dir, ".git"))).isDirectory()).toBe(true);
		});
	});
});
