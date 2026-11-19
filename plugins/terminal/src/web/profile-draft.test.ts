import { describe, expect, it } from "vitest";

import { customTerminalProfileSchema } from "../contracts/profiles";
import {
	draftFromProfile,
	emptyProfileDraft,
	parseProfileDraft,
	type ProfileDraft,
} from "./profile-draft";

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
	...emptyProfileDraft("p1"),
	label: "Fish",
	path: "/opt/homebrew/bin/fish",
	...overrides,
});

describe("parseProfileDraft", () => {
	it("reads args one per line, ignoring blank lines", () => {
		expect(parseProfileDraft(draft({ args: "-l\n\n  --private  \n" }))).toEqual({
			ok: true,
			profile: {
				id: "p1",
				label: "Fish",
				path: "/opt/homebrew/bin/fish",
				args: ["-l", "--private"],
			},
		});
	});

	it("reads KEY=VALUE env lines, with an empty value unsetting the variable", () => {
		expect(parseProfileDraft(draft({ env: "FOO=bar=baz\nUNSET=\n\n" }))).toEqual({
			ok: true,
			profile: {
				id: "p1",
				label: "Fish",
				path: "/opt/homebrew/bin/fish",
				env: { FOO: "bar=baz", UNSET: null },
			},
		});
	});

	it("rejects env lines without a name", () => {
		expect(parseProfileDraft(draft({ env: "FOO=1\nnot a pair" }))).toEqual({
			ok: false,
			errors: { env: 'Line 2 needs the form NAME=value: "not a pair"' },
		});
		expect(parseProfileDraft(draft({ env: "=value" }))).toMatchObject({
			ok: false,
			errors: { env: expect.any(String) },
		});
	});

	it("keeps only the chosen kind: an executable or a detected shell", () => {
		expect(parseProfileDraft(draft({ kind: "source", source: "git-bash" }))).toEqual({
			ok: true,
			profile: { id: "p1", label: "Fish", source: "git-bash" },
		});
		expect(parseProfileDraft(draft({ path: "  " }))).toEqual({
			ok: false,
			errors: { path: "Enter the shell's path or name." },
		});
		expect(customTerminalProfileSchema.safeParse({ id: "x", label: "X" }).success).toBe(false);
		expect(
			customTerminalProfileSchema.safeParse({
				id: "x",
				label: "X",
				path: "/bin/sh",
				source: "pwsh",
			}).success,
		).toBe(false);
	});

	it("rejects a relative path with a folder in it", () => {
		for (const path of ["bin/zsh", ".\\pwsh.exe", "../sh"]) {
			expect(parseProfileDraft(draft({ path }))).toEqual({
				ok: false,
				errors: { path: "Use an absolute path or a bare name found on PATH." },
			});
		}
		for (const path of [
			"zsh",
			"/bin/zsh",
			"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
			"pwsh.exe",
		]) {
			expect(parseProfileDraft(draft({ path })).ok).toBe(true);
		}
	});

	it("names the fields with schema errors", () => {
		expect(parseProfileDraft(draft({ label: "" }))).toEqual({
			ok: false,
			errors: { label: expect.any(String) },
		});
	});

	it("round-trips a saved profile through a draft", () => {
		const profile = {
			id: "p2",
			label: "Login zsh",
			path: "zsh",
			args: ["-l"],
			env: { ZDOTDIR: "/tmp", OLD: null },
		};
		expect(parseProfileDraft(draftFromProfile(profile))).toEqual({ ok: true, profile });
		expect(draftFromProfile({ id: "p3", label: "PS", source: "pwsh" })).toMatchObject({
			kind: "source",
			source: "pwsh",
			path: "",
		});
	});
});
