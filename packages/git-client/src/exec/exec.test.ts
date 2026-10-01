import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { ExecError, GitErrorCode, GitErrorRegexes } from "./errors.js";
import { parseBadConfigValueErrorInfo } from "./parse-bad-config-value-error-info.js";
import {
	assertHasGitError,
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	initializeWithRemote,
} from "../test/util.js";

afterEach(cleanupTestDirs);

describe("exec", () => {
	it("can cancel in-progress git command", async () => {
		// git-hash-object will wait until stdin is closed so we can use this as
		// an never-ending process to test the cancellation
		const ac = new AbortController();
		const result = await gitExec(["hash-object", "--stdin"], process.cwd(), {
			signal: ac.signal,
			processCallback(subprocess) {
				subprocess.on("spawn", () => {
					ac.abort();
				});
			},
		}).catch((e: unknown) => e);

		expect(result).toBeInstanceOf(ExecError);
		expect((result as ExecError).code).toBe("ABORT_ERR");
	});

	it("cannot cancel already finished git command", async () => {
		const testRepoPath = await createTestDir("desktop-git-do-nothing");
		const ac = new AbortController();
		const { stdout } = await gitExec(["--version"], testRepoPath, {
			signal: ac.signal,
		});
		ac.abort();
		expect(stdout.includes("git version")).toBe(true);
	});

	it("can launch git", async () => {
		const result = await gitExec(["--version"], process.cwd());
		expect(result.stderr).toBe("");
		expect(result.stdout.includes("git version")).toBe(true);
		expect(result.exitCode).toBe(0);
	});

	it("preserves the trailing newline in stdout", async () => {
		const result = await gitExec(["--version"], process.cwd());
		expect(result.stdout.endsWith("\n")).toBe(true);
	});

	describe("exitCode", () => {
		it("returns exit code when folder is empty", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-blank");
			const result = await gitExec(["show", "HEAD"], testRepoPath);
			expect(result.exitCode).toBe(128);
		});

		it("handles stdin closed errors", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-blank");

			// Pass an unknown arg to Git, forcing it to terminate immediately
			// and then try to write to stdin. ignoreClosedInputStream swallows
			// the resulting EPIPE/EOF on the stdin stream, so the command
			// resolves with git's own exit code instead of crashing the process.
			const result = await gitExec(["--trololol"], testRepoPath, {
				stdin: "\n".repeat(1024 * 1024),
			});
			expect(result.exitCode).toBe(129);
		});

		describe("diff", () => {
			it("returns expected error code for initial commit when creating diff", async () => {
				const testRepoPath = await initialize("blank-no-commits");

				writeFileSync(join(testRepoPath, "new-file.md"), "this is a new file");
				const result = await gitExec(
					["diff", "--no-index", "--patch-with-raw", "-z", "--", "/dev/null", "new-file.md"],
					testRepoPath,
				);

				expect(result.exitCode).toBe(1);
				expect(result.stdout.length > 0).toBe(true);
			});

			it("returns expected error code for repository with history when creating diff", async () => {
				const testRepoPath = await initialize("blank-then-commit");
				writeFileSync(join(testRepoPath, "README.md"), "hello world!");
				await gitExec(["add", "."], testRepoPath);

				const commit = await gitExec(["commit", "-F", "-"], testRepoPath, {
					stdin: "hello world!",
				});
				expect(commit.exitCode).toBe(0);

				writeFileSync(join(testRepoPath, "new-file.md"), "this is a new file");
				const result = await gitExec(
					["diff", "--no-index", "--patch-with-raw", "-z", "--", "/dev/null", "new-file.md"],
					testRepoPath,
				);

				expect(result.exitCode).toBe(1);
				expect(result.stdout.length > 0).toBe(true);
			});

			it("throws error when exceeding the output range", async () => {
				const result = await gitExec(["-h"], process.cwd(), { maxBuffer: 1 }).catch(
					(e: unknown) => e,
				);

				expect(result).toBeInstanceOf(ExecError);
				expect((result as ExecError).cause).toBeInstanceOf(RangeError);
				expect((result as ExecError).code).toBe("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
			});

			it("truncates stdout when maxBuffer is exceeded", async () => {
				const result = await gitExec(["-v"], process.cwd(), { maxBuffer: 3 }).catch(
					(e: unknown) => e,
				);

				expect(result).toBeInstanceOf(ExecError);
				expect((result as ExecError).code).toBe("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
				expect((result as ExecError).stdout.toString()).toBe("git");
			});
		});

		describe("show", () => {
			it("existing file", async () => {
				const testRepoPath = await initialize("desktop-show-existing");
				writeFileSync(join(testRepoPath, "file.txt"), "some content");

				await gitExec(["add", "."], testRepoPath);
				await gitExec(["commit", "-m", '"added a file"'], testRepoPath);

				const result = await gitExec(["show", ":file.txt"], testRepoPath);
				expect(result.exitCode).toBe(0);
				expect(result.stdout.trim()).toBe("some content");
			});

			it("missing from index", async () => {
				const testRepoPath = await initialize("desktop-show-missing-index");
				const result = await gitExec(["show", ":missing.txt"], testRepoPath);
				assertHasGitError(result, GitErrorCode.PathDoesNotExist);
			});

			it("missing from commitish", async () => {
				const testRepoPath = await initialize("desktop-show-missing-commitish");
				writeFileSync(join(testRepoPath, "file.txt"), "some content");

				await gitExec(["add", "."], testRepoPath);
				await gitExec(["commit", "-m", '"added a file"'], testRepoPath);

				const result = await gitExec(["show", "HEAD:missing.txt"], testRepoPath);
				assertHasGitError(result, GitErrorCode.PathDoesNotExist);
			});

			it("invalid object name - empty repository", async () => {
				const testRepoPath = await initialize("desktop-show-invalid-object-empty");
				const result = await gitExec(["show", "HEAD:missing.txt"], testRepoPath);
				assertHasGitError(result, GitErrorCode.InvalidObjectName);
			});

			it("outside repository", async () => {
				const testRepoPath = await initialize("desktop-show-outside");
				writeFileSync(join(testRepoPath, "file.txt"), "some content");

				await gitExec(["add", "."], testRepoPath);
				await gitExec(["commit", "-m", '"added a file"'], testRepoPath);

				const result = await gitExec(["show", "--", "/missing.txt"], testRepoPath);
				assertHasGitError(result, GitErrorCode.OutsideRepository);
			});
		});

		it("returns binary output uncorrupted with the buffer encoding", async () => {
			const testRepoPath = await initialize("desktop-show-binary");
			const bytes = Buffer.from([0xff, 0xfe, 0x01, 0x02, 0x00, 0x7f]);
			writeFileSync(join(testRepoPath, "logo.bin"), bytes);

			await gitExec(["add", "."], testRepoPath);
			await gitExec(["commit", "-m", '"added binary file"'], testRepoPath);

			const result = await gitExec(["show", "HEAD:logo.bin"], testRepoPath, {
				encoding: "buffer",
			});

			expect(result.stdout).toBeInstanceOf(Buffer);
			expect(result.stdout).toEqual(bytes);
		});
	});

	describe("stdin", () => {
		it("can write large buffers", async () => {
			// Ensure 10Mb of zeroes hashes correctly
			const buffer = Buffer.alloc(1024 * 1024 * 10);
			buffer.fill(0);

			const testRepoPath = await createTestDir("desktop-git-test-large-input");
			const result = await gitExec(["hash-object", "--stdin"], testRepoPath, {
				stdin: buffer,
			});

			expect(result.stdout).toBe("6c5d4031e03408e34ae476c5053ee497a91ac37b\n");
		});

		it("can write strings", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-input-string");
			const result = await gitExec(["hash-object", "--stdin"], testRepoPath, {
				stdin: "foo bar",
			});
			expect(result.stdout).toBe("96c906756d7b91c45322617c9295e4a80d52d1c5\n");
		});

		it("can write strings with encoding", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-input-string");

			const result1 = await gitExec(["hash-object", "--stdin"], testRepoPath, {
				stdin: "åäö",
				stdinEncoding: "utf-8",
			});
			expect(result1.stdout).toBe("3889b04ced1aef334c8caaa923559abba286394e\n");

			const result2 = await gitExec(["hash-object", "--stdin"], testRepoPath, {
				stdin: "åäö",
				stdinEncoding: "ascii",
			});
			expect(result2.stdout).toBe("652b06b434a5750d876f9eb55c07c0f1fab93464\n");
		});

		it("assumes utf-8 for stdin by default", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-input-string");
			const result = await gitExec(["hash-object", "--stdin"], testRepoPath, {
				stdin: "åäö",
			});
			expect(result.stdout).toBe("3889b04ced1aef334c8caaa923559abba286394e\n");
		});
	});

	it("can commit changes", async () => {
		const testRepoPath = await createTestDir("desktop-git-test-commit");

		await gitExec(["init"], testRepoPath);
		await gitExec(["config", "user.email", '"test@example.com"'], testRepoPath);
		await gitExec(["config", "user.name", '"Some Test User"'], testRepoPath);

		writeFileSync(join(testRepoPath, "README.md"), "HELLO WORLD!");
		await gitExec(["add", "README.md"], testRepoPath);

		const message = "committed the README";
		const result = await gitExec(["commit", "-F", "-"], testRepoPath, {
			stdin: message,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.includes(message)).toBe(true);
	});

	it("lists untracked file in status", async () => {
		const testRepoPath = await createTestDir("desktop-git-test-status");
		await gitExec(["init"], testRepoPath);

		writeFileSync(join(testRepoPath, "README.md"), "HELLO WORLD!");
		await gitExec(["add", "README.md"], testRepoPath);

		const result = await gitExec(
			["status", "--untracked-files=all", "--porcelain", "-z"],
			testRepoPath,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.includes("README.md")).toBe(true);
	});

	describe("environment", () => {
		it("passes per-call environment variables to git", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-environment");
			const result = await gitExec(["var", "GIT_AUTHOR_IDENT"], testRepoPath, {
				env: {
					GIT_AUTHOR_NAME: "Foo Bar",
					GIT_AUTHOR_EMAIL: "foo@bar.com",
					GIT_AUTHOR_DATE: "Wed, 05 Oct 2016 23:33:27 +0200",
				},
			});
			expect(result.stdout).toBe("Foo Bar <foo@bar.com> 1475703207 +0200\n");
		});

		it("sets TERM to dumb by default", async () => {
			const testRepoPath = await createTestDir("desktop-git-test-term");
			// Shell aliases inherit the child env, making TERM observable.
			const result = await gitExec(["-c", "alias.showenv=!echo $TERM", "showenv"], testRepoPath);
			expect(result.stdout).toBe("dumb\n");
		});
	});

	it("raises error when folder does not exist", async () => {
		const testRepoPath = join(tmpdir(), "desktop-does-not-exist-" + randomBytes(8).toString("hex"));

		const error = await gitExec(["show", "HEAD"], testRepoPath).catch((e: unknown) => e);

		expect((error as Error).message.includes("Git failed to execute.")).toBe(true);
		expect((error as ExecError).code).toBe("ENOENT");
	});

	describe("detects errors", () => {
		it("RemoteAlreadyExists", async () => {
			const repoPath = await initialize("remote-already-exists-test-repo");

			await gitExec(["remote", "add", "new-remote", "https://github.com"], repoPath);
			const result = await gitExec(["remote", "add", "new-remote", "https://gitlab.com"], repoPath);

			assertHasGitError(result, GitErrorCode.RemoteAlreadyExists);
		});

		it("TagAlreadyExists", async () => {
			const repoPath = await initialize("tag-already-exists-test-repo");
			writeFileSync(join(repoPath, "text.md"), "some text");
			await gitExec(["add", "text.md"], repoPath);
			await gitExec(["commit", "-m", "add a text file"], repoPath);

			await gitExec(["tag", "v0.1"], repoPath);
			const result = await gitExec(["tag", "v0.1"], repoPath);

			assertHasGitError(result, GitErrorCode.TagAlreadyExists);
		});

		it("BranchAlreadyExists", async () => {
			const repoPath = await initialize("branch-already-exists", "foo");
			await gitExec(["commit", "-m", "initial", "--allow-empty"], repoPath);

			const result = await gitExec(["branch", "foo"], repoPath);

			assertHasGitError(result, GitErrorCode.BranchAlreadyExists);
		});

		it("UnsafeDirectory", async () => {
			const repoPath = await initialize("unsafe-directory-test");

			const result = await gitExec(["status"], repoPath, {
				env: {
					GIT_TEST_ASSUME_DIFFERENT_OWNER: "1",
					GIT_CONFIG_PARAMETERS: "'safe.directory='",
				},
			});

			assertHasGitError(result, GitErrorCode.UnsafeDirectory);

			const errorEntry = Object.entries(GitErrorRegexes).find(
				([, v]) => v === GitErrorCode.UnsafeDirectory,
			);
			expect(errorEntry).toBeDefined();

			const match = result.stderr.match(errorEntry?.[0] ?? "");
			// toContain because of realpath and we don't care about /private/ on macOS
			expect(match?.[1]?.includes("unsafe-directory-test")).toBe(true);
		});

		describe("BadConfigValue", () => {
			it("detects bad boolean config value", async () => {
				const repoPath = await initialize("bad-config-repo");
				writeFileSync(join(repoPath, "text.md"), "some text");
				await gitExec(["add", "text.md"], repoPath);

				await gitExec(["config", "core.autocrlf", "nab"], repoPath);
				const result = await gitExec(["commit", "-m", "add a text file"], repoPath);

				assertHasGitError(result, GitErrorCode.BadConfigValue);

				const errorInfo = parseBadConfigValueErrorInfo(result.stderr);
				expect(errorInfo).toEqual({ key: "core.autocrlf", value: "nab" });
			});

			it("detects bad numeric config value", async () => {
				const repoPath = await initialize("bad-config-repo-numeric");
				writeFileSync(join(repoPath, "text.md"), "some text");
				await gitExec(["add", "text.md"], repoPath);

				await gitExec(["config", "core.repositoryformatversion", "nan"], repoPath);
				const result = await gitExec(["commit", "-m", "add a text file"], repoPath);

				assertHasGitError(result, GitErrorCode.BadConfigValue);
			});
		});
	});

	describe("conflicts", () => {
		it("can parse an error when there is a conflict while merging", async () => {
			const repoPath = await initialize("desktop-merge-conflict");
			const readmePath = join(repoPath, "Readme.md");

			writeFileSync(readmePath, "# README");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"initial commit"'], repoPath);

			await gitExec(["checkout", "-b", "my-branch"], repoPath);
			writeFileSync(readmePath, "# README from my-branch");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"modify README in my-branch"'], repoPath);

			await gitExec(["checkout", "-"], repoPath);
			writeFileSync(readmePath, "# README from default");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"modifiy README in default branch"'], repoPath);

			const result = await gitExec(["merge", "my-branch"], repoPath);

			assertHasGitError(result, GitErrorCode.MergeConflicts);
		});

		it("can parse an error when there is a conflict while rebasing", async () => {
			const repoPath = await initialize("desktop-rebase-conflict");
			const readmePath = join(repoPath, "Readme.md");

			writeFileSync(readmePath, "# README");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"initial commit"'], repoPath);

			await gitExec(["checkout", "-b", "my-branch"], repoPath);
			writeFileSync(readmePath, "# README from my-branch");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"modify README in my-branch"'], repoPath);

			await gitExec(["checkout", "-"], repoPath);
			writeFileSync(readmePath, "# README from default");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"modifiy README in default branch"'], repoPath);

			const result = await gitExec(["rebase", "my-branch"], repoPath);

			assertHasGitError(result, GitErrorCode.RebaseConflicts);
		});

		it("can parse an error when merging with local changes", async () => {
			const repoPath = await initialize("desktop-merge-with-local-changes");
			const readmePath = join(repoPath, "Readme.md");

			writeFileSync(readmePath, "# README");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"added README"'], repoPath);

			await gitExec(["checkout", "-b", "some-other-branch"], repoPath);
			writeFileSync(readmePath, "# README modified in branch");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"updated README"'], repoPath);

			await gitExec(["checkout", "-"], repoPath);
			writeFileSync(readmePath, "# README modified in master");

			const result = await gitExec(["merge", "some-other-branch"], repoPath);

			assertHasGitError(result, GitErrorCode.MergeWithLocalChanges);
		});

		it("can parse an error when rebasing with local changes", async () => {
			const repoPath = await initialize("desktop-rebase-with-local-changes");
			const readmePath = join(repoPath, "Readme.md");

			writeFileSync(readmePath, "# README");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"added README"'], repoPath);

			await gitExec(["checkout", "-b", "some-other-branch"], repoPath);
			writeFileSync(readmePath, "# README modified in branch");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"updated README"'], repoPath);

			await gitExec(["checkout", "-"], repoPath);
			writeFileSync(readmePath, "# README modified in master");

			const result = await gitExec(["rebase", "some-other-branch"], repoPath);

			assertHasGitError(result, GitErrorCode.RebaseWithLocalChanges);
		});

		it("can parse an error when pulling with merge with local changes", async () => {
			const { path: repoPath, remote } = await initializeWithRemote("desktop-pull-merge");
			const { path: forkRepoPath } = await initializeWithRemote("desktop-pull-merge-fork", remote);
			await gitExec(["config", "pull.rebase", "false"], forkRepoPath);
			const readmePath = join(repoPath, "Readme.md");
			const readmePathInFork = join(forkRepoPath, "Readme.md");

			writeFileSync(readmePath, "# README");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"added README"'], repoPath);

			await gitExec(["push", "origin", "HEAD", "-u"], repoPath);
			await gitExec(["pull", "origin", "HEAD"], forkRepoPath);

			writeFileSync(readmePath, "# README modified from upstream");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"updated README"'], repoPath);
			await gitExec(["push", "origin"], repoPath);

			writeFileSync(readmePathInFork, "# README modified from fork");

			const result = await gitExec(["pull", "origin", "HEAD"], forkRepoPath);

			assertHasGitError(result, GitErrorCode.MergeWithLocalChanges);
		});

		it("can parse an error when pulling with rebase with local changes", async () => {
			const { path: repoPath, remote } = await initializeWithRemote("desktop-pull-rebase");
			const { path: forkRepoPath } = await initializeWithRemote("desktop-pull-rebase-fork", remote);
			await gitExec(["config", "pull.rebase", "true"], forkRepoPath);
			const readmePath = join(repoPath, "Readme.md");
			const readmePathInFork = join(forkRepoPath, "Readme.md");

			writeFileSync(readmePath, "# README");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"added README"'], repoPath);

			await gitExec(["push", "origin", "HEAD", "-u"], repoPath);
			await gitExec(["pull", "origin", "HEAD"], forkRepoPath);

			writeFileSync(readmePath, "# README modified from upstream");
			await gitExec(["add", "."], repoPath);
			await gitExec(["commit", "-m", '"updated README"'], repoPath);
			await gitExec(["push", "origin"], repoPath);

			writeFileSync(readmePathInFork, "# README modified from fork");

			const result = await gitExec(["pull", "origin", "HEAD"], forkRepoPath);

			assertHasGitError(result, GitErrorCode.RebaseWithLocalChanges);
		});
	});

	// Git's builtin fsmonitor daemon exists only on macOS and Windows.
	describe.skipIf(process.platform === "linux")("fsmonitor", () => {
		const watchedRepos: string[] = [];

		afterEach(async () => {
			for (const repoPath of watchedRepos.splice(0)) {
				await gitExec(["fsmonitor--daemon", "stop"], repoPath);
			}
		});

		it("never starts the repository's fsmonitor daemon", async () => {
			const repoPath = await initialize("fsmonitor-enabled");
			watchedRepos.push(repoPath);
			await gitExec(["config", "core.fsmonitor", "true"], repoPath);

			await gitExec(["status", "--untracked-files=all", "--porcelain=2"], repoPath);

			const daemon = await gitExec(["fsmonitor--daemon", "status"], repoPath);
			expect(daemon.stdout).not.toContain("is watching");
			expect(daemon.exitCode).not.toBe(0);
		});
	});
});
