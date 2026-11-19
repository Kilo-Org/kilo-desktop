import { describe, expect, it, vi } from "vitest";

import { GitError, GitNotDetectedError } from "@kilo-desktop/git-client";

import { GIT_NOT_FOUND_MESSAGE } from "../repository/worktree-manager";
import { cloneGitUrl, parseGitUrl } from "./git-url-clone";

/** A `GitError` as `client.exec` throws it for a failed `git clone`. */
function gitFailure(stderr: string): GitError {
	return new GitError(
		{
			stdout: "",
			stderr,
			exitCode: 128,
			gitError: null,
			gitErrorDescription: null,
			path: "/projects",
		} as unknown as ConstructorParameters<typeof GitError>[0],
		["clone"],
		stderr,
	);
}

describe("parseGitUrl", () => {
	it.each([
		["https://gitlab.com/group/project.git", "https://gitlab.com/group/project.git"],
		["  ssh://git@host.example:2222/team/repo.git ", "ssh://git@host.example:2222/team/repo.git"],
		["git@bitbucket.org:team/repo.git", "git@bitbucket.org:team/repo.git"],
		["git://example.org/repo", "git://example.org/repo"],
	])("accepts %j", (input, expected) => {
		expect(parseGitUrl(input)).toBe(expected);
	});

	it.each([
		"",
		"owner/repo",
		"/local/path",
		"file:///tmp/repo",
		"--upload-pack=evil",
		"https://",
		"https://host/a b",
	])("rejects %j", (input) => {
		expect(parseGitUrl(input)).toBeNull();
	});
});

describe("cloneGitUrl", () => {
	it("runs git clone with prompts disabled from the destination's parent", async () => {
		const exec = vi.fn().mockResolvedValue({ exitCode: 0 });

		await cloneGitUrl(
			{ exec },
			{ url: " https://gitlab.com/g/p.git ", destination: "/projects/p" },
		);

		expect(exec).toHaveBeenCalledWith(
			["clone", "--", "https://gitlab.com/g/p.git", "/projects/p"],
			"clone",
			expect.objectContaining({ cwd: "/projects", env: { GIT_TERMINAL_PROMPT: "0" } }),
		);
	});

	it("rejects an invalid URL without running git", async () => {
		const exec = vi.fn();

		await expect(
			cloneGitUrl({ exec }, { url: "--upload-pack=x", destination: "/projects/p" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(exec).not.toHaveBeenCalled();
	});

	it.each([
		[
			"remote: The project you were looking for could not be found.\nfatal: repository 'https://gitlab.com/g/p.git/' not found",
			"NOT_FOUND",
			"Couldn't find a Git repository at https://gitlab.com/g/p.git.",
		],
		[
			"fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled",
			"BUSINESS",
			"gitlab.com asked for a sign-in, so the repository is private or the URL is wrong.",
		],
		["fatal: Could not resolve host: gitlab.com", "BUSINESS", "Couldn't reach gitlab.com."],
	])("explains %j", async (stderr, code, message) => {
		const exec = vi.fn().mockRejectedValue(gitFailure(stderr));

		await expect(
			cloneGitUrl({ exec }, { url: "https://gitlab.com/g/p.git", destination: "/projects/p" }),
		).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
	});

	it("names the host of an scp-style URL in SSH failures", async () => {
		const exec = vi
			.fn()
			.mockRejectedValue(gitFailure("git@bitbucket.org: Permission denied (publickey)."));

		await expect(
			cloneGitUrl({ exec }, { url: "git@bitbucket.org:team/repo.git", destination: "/p/repo" }),
		).rejects.toMatchObject({
			message: expect.stringContaining("sign in to bitbucket.org over SSH"),
		});
	});

	it("explains a missing git binary", async () => {
		const exec = vi.fn().mockRejectedValue(new GitNotDetectedError());

		await expect(
			cloneGitUrl({ exec }, { url: "https://gitlab.com/g/p.git", destination: "/projects/p" }),
		).rejects.toMatchObject({ code: "BUSINESS", message: GIT_NOT_FOUND_MESSAGE });
	});
});
