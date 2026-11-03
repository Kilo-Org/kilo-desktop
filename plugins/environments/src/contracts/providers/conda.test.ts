import { describe, expect, it } from "vitest";

import {
	agentChannelSchema,
	channelSchema,
	condaChannelsAddInputSchema,
	condaChannelsListResultSchema,
	condaChannelsRemoveInputSchema,
	condaDistributionSchema,
	condaEnvSchema,
	condaEnvsCheckPrefixInputSchema,
	condaEnvsCheckPrefixResultSchema,
	condaEnvsCloneInputSchema,
	condaEnvsCloneResultSchema,
	condaEnvsCreateFromFileInputSchema,
	condaEnvsCreateFromFileResultSchema,
	condaEnvsCreateInputSchema,
	condaEnvsCreateResultSchema,
	condaEnvsDeleteInputSchema,
	condaEnvsDeleteResultSchema,
	condaEnvsDistributionsResultSchema,
	condaEnvsPickFileInputSchema,
	condaEnvsPickFileResultSchema,
	condaEnvsReadFileInputSchema,
	condaEnvsReadFileResultSchema,
	condaPackageSchema,
	condaPackagesInstallInputSchema,
	condaPackagesInstallResultSchema,
	condaPackagesListInputSchema,
	condaPackagesListResultSchema,
	condaPackagesRemoveInputSchema,
	condaPackagesRemoveResultSchema,
	condaPackagesUpdateInputSchema,
	condaPackagesUpdateResultSchema,
	condaRepodataFindInputSchema,
	condaRepodataFindResultSchema,
	condaRepodataPackageSchema,
	ENVIRONMENT_NAME_PATTERN,
	environmentNameSchema,
	envPrefixSchema,
	envTargetSchema,
	matchSpecSchema,
	REPODATA_FIND_DEFAULT_LIMIT,
	REPODATA_FIND_MAX_LIMIT,
	repodataQuerySchema,
	subdirSchema,
} from "./conda.js";
import { Conda, condaExecutable } from "../index.js";

describe("environmentNameSchema", () => {
	it("accepts conda-legal names", () => {
		for (const name of ["py311", "web-dev", "data.science", "e", "A_B-1.0"]) {
			expect(environmentNameSchema.parse(name)).toBe(name);
		}
	});

	it("rejects empty, leading-dot, whitespace, or path-separator names", () => {
		for (const bad of [
			"",
			".hidden",
			"has space",
			"has/slash",
			"has\\backslash",
			"-leading-dash",
			"_leading-underscore",
		]) {
			expect(environmentNameSchema.safeParse(bad).success).toBe(false);
		}
	});

	it("caps the length at 128 characters to avoid unbounded paths", () => {
		expect(environmentNameSchema.safeParse("a".repeat(128)).success).toBe(true);
		expect(environmentNameSchema.safeParse("a".repeat(129)).success).toBe(false);
	});

	it("exposes the same pattern for ad-hoc validation", () => {
		expect(ENVIRONMENT_NAME_PATTERN.test("py311")).toBe(true);
		expect(ENVIRONMENT_NAME_PATTERN.test("has space")).toBe(false);
	});
});

describe("envPrefixSchema", () => {
	it("accepts absolute POSIX and Windows paths", () => {
		for (const p of ["/opt/conda", "/opt/conda/envs/dev", "C:\\Users\\me\\conda", "D:/envs/dev"]) {
			expect(envPrefixSchema.parse(p)).toBe(p);
		}
	});

	it("rejects empty strings", () => {
		expect(envPrefixSchema.safeParse("").success).toBe(false);
	});

	it("rejects values that look like a conda CLI flag", () => {
		expect(envPrefixSchema.safeParse("--prefix").success).toBe(false);
		expect(envPrefixSchema.safeParse("-n").success).toBe(false);
	});

	it("rejects relative paths", () => {
		expect(envPrefixSchema.safeParse("relative/path").success).toBe(false);
		expect(envPrefixSchema.safeParse("../../etc").success).toBe(false);
		expect(envPrefixSchema.safeParse("conda").success).toBe(false);
	});

	it("rejects strings containing control characters", () => {
		expect(envPrefixSchema.safeParse("/opt/conda\x00/evil").success).toBe(false);
		expect(envPrefixSchema.safeParse("/opt/conda\n--all").success).toBe(false);
		expect(envPrefixSchema.safeParse("/opt/conda\t/env").success).toBe(false);
	});
});

describe("envTargetSchema", () => {
	it("accepts a name-only target", () => {
		expect(envTargetSchema.parse({ name: "dev" })).toEqual({ name: "dev" });
	});

	it("accepts a prefix-only target", () => {
		expect(envTargetSchema.parse({ prefix: "/opt/conda" })).toEqual({ prefix: "/opt/conda" });
	});

	it("accepts both name and prefix", () => {
		const target = { name: "dev", prefix: "/opt/conda/envs/dev" };
		expect(envTargetSchema.parse(target)).toEqual(target);
	});

	it("rejects an empty target (neither name nor prefix)", () => {
		expect(envTargetSchema.safeParse({}).success).toBe(false);
	});

	it("rejects when name is invalid but prefix is absent", () => {
		expect(envTargetSchema.safeParse({ name: "" }).success).toBe(false);
		expect(envTargetSchema.safeParse({ name: "has space" }).success).toBe(false);
	});

	it("accepts when name is absent but prefix is valid", () => {
		expect(envTargetSchema.safeParse({ prefix: "/opt/conda" }).success).toBe(true);
	});
});

describe("matchSpecSchema", () => {
	it("accepts raw conda MatchSpec strings", () => {
		for (const spec of [
			"numpy",
			"numpy>=1.24",
			"conda-forge::pandas=2.*=py311_*",
			"python==3.11.*",
			"pip",
		]) {
			expect(matchSpecSchema.parse(spec)).toBe(spec);
		}
	});

	it("rejects empty, multi-line, or space-padded MatchSpecs", () => {
		expect(matchSpecSchema.safeParse("").success).toBe(false);
		expect(matchSpecSchema.safeParse("numpy\n>=1").success).toBe(false);
		expect(matchSpecSchema.safeParse("numpy\t>=1").success).toBe(false);
		expect(matchSpecSchema.safeParse(" numpy").success).toBe(false);
		expect(matchSpecSchema.safeParse("numpy ").success).toBe(false);
	});

	it("rejects values that could be mistaken for a conda CLI flag", () => {
		// argparse in conda accepts options interspersed with positionals, so
		// any packages arg starting with `-` can smuggle a flag through the
		// argv boundary. Reject at the schema level.
		expect(matchSpecSchema.safeParse("--prefix").success).toBe(false);
		expect(matchSpecSchema.safeParse("--dry-run").success).toBe(false);
		expect(matchSpecSchema.safeParse("-c").success).toBe(false);
	});

	it("rejects a local file path or URL as a package", () => {
		// A path/URL spec makes conda install the referenced artifact directly
		// and run its link scripts, bypassing any channel trust decision —
		// high risk, unsupported by the managed tools.
		for (const spec of [
			"/Users/me/Downloads/pandas-3.0.6-py314hd1d6bd3_1.tar.bz2",
			"~/pkg.tar.bz2",
			"./pkg.conda",
			"../pkg",
			"file:///tmp/pkg",
			"https://evil.example/pkg-1.0-0.conda",
			"C:\\pkgs\\pkg.tar.bz2",
		]) {
			expect(matchSpecSchema.safeParse(spec).success).toBe(false);
		}
	});

	it("explains the local-file refusal with the high-risk message", () => {
		const result = matchSpecSchema.safeParse("/Users/me/pkg.tar.bz2");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toMatch(/high security risk/i);
		}
	});
});

describe("channelSchema", () => {
	it("accepts short names, URLs, and file:// paths", () => {
		for (const ch of [
			"conda-forge",
			"defaults",
			"https://conda.anaconda.org/anaconda",
			"file:///tmp/local-channel",
		]) {
			expect(channelSchema.parse(ch)).toBe(ch);
		}
	});

	it("rejects empty or multi-line channel strings", () => {
		expect(channelSchema.safeParse("").success).toBe(false);
		expect(channelSchema.safeParse("conda-forge\nextras").success).toBe(false);
		expect(channelSchema.safeParse(" conda-forge").success).toBe(false);
	});

	it("rejects values that could be mistaken for a conda CLI flag", () => {
		// Same rationale as matchSpecSchema — a channel arg starting with
		// `-` would smuggle a flag through the argv boundary. Legitimate
		// channels are short names, URLs, or file:// paths — none start
		// with a dash.
		expect(channelSchema.safeParse("--override-channels").success).toBe(false);
		expect(channelSchema.safeParse("-c").success).toBe(false);
	});
});

describe("agentChannelSchema", () => {
	it("accepts named channels", () => {
		for (const ch of ["defaults", "main", "conda-forge", "bioconda"]) {
			expect(agentChannelSchema.parse(ch)).toBe(ch);
		}
	});

	it("refuses URL and local-path channels (C1 gate 2)", () => {
		// A prompt injection that supplies one of these points conda at an
		// attacker-controlled or local source whose packages run link scripts.
		for (const ch of [
			"https://evil.example/conda",
			"file:///tmp/channel",
			"/tmp/channel",
			"~/channel",
			"./channel",
			"../channel",
			"C:\\channel",
		]) {
			expect(agentChannelSchema.safeParse(ch).success).toBe(false);
		}
	});

	it("explains the refusal", () => {
		const result = agentChannelSchema.safeParse("file:///tmp/channel");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toMatch(/cannot be a URL or a local path/i);
		}
	});
});

describe("value schemas", () => {
	it("condaEnvSchema round-trips a named env", () => {
		const env = { name: "py311", prefix: "/opt/envs/py311" };
		expect(condaEnvSchema.parse(env)).toEqual(env);
	});

	it("condaEnvSchema tolerates the empty name that base / anonymous envs return", () => {
		const env = { name: "", prefix: "/opt/miniconda3" };
		expect(condaEnvSchema.parse(env)).toEqual(env);
	});

	it("condaPackageSchema round-trips one `conda list --json` entry", () => {
		const pkg = { name: "numpy", version: "1.26.4", build: "py311h1234_0", channel: "conda-forge" };
		expect(condaPackageSchema.parse(pkg)).toEqual(pkg);
	});

	it("condaPackageSchema rejects rows missing any of the pinned fields", () => {
		expect(
			condaPackageSchema.safeParse({ name: "numpy", version: "1.26.4", build: "py311h1234_0" })
				.success,
		).toBe(false);
	});

	it("condaDistributionSchema round-trips a distribution entry", () => {
		const dist = { prefix: "/opt/miniconda3", priority: 10 };
		expect(condaDistributionSchema.parse(dist)).toEqual(dist);
	});

	it("condaDistributionSchema rejects empty prefix", () => {
		expect(condaDistributionSchema.safeParse({ prefix: "", priority: 5 }).success).toBe(false);
	});
});

describe("conda.envs I/O", () => {
	it("condaEnvsCreateInputSchema accepts { name } alone", () => {
		expect(condaEnvsCreateInputSchema.parse({ name: "py311" })).toEqual({ name: "py311" });
	});

	it("condaEnvsCreateInputSchema accepts name + channels + packages", () => {
		const input = {
			name: "py311",
			channels: ["conda-forge"],
			packages: ["python=3.11", "numpy>=1.24"],
		};
		expect(condaEnvsCreateInputSchema.parse(input)).toEqual(input);
	});

	it("condaEnvsCreateInputSchema rejects empty channels / packages arrays as caller bugs", () => {
		expect(condaEnvsCreateInputSchema.safeParse({ name: "py311", packages: [] }).success).toBe(
			false,
		);
		expect(condaEnvsCreateInputSchema.safeParse({ name: "py311", channels: [] }).success).toBe(
			false,
		);
	});

	it("condaEnvsCreateInputSchema rejects a local file path in packages", () => {
		expect(
			condaEnvsCreateInputSchema.safeParse({
				name: "py311",
				packages: ["file:///tmp/pkg.tar.bz2"],
			}).success,
		).toBe(false);
	});

	it("condaEnvsCreateInputSchema accepts an absolute prefix", () => {
		const input = { name: "py311", prefix: "/opt/conda/envs/py311" };
		expect(condaEnvsCreateInputSchema.parse(input)).toEqual(input);
		const win = { name: "py311", prefix: "C:\\Users\\me\\envs\\py311" };
		expect(condaEnvsCreateInputSchema.parse(win)).toEqual(win);
	});

	it("condaEnvsCreateInputSchema rejects relative, flag-like, or control-char prefixes", () => {
		for (const bad of [
			"relative/path",
			"../../etc",
			"--prefix",
			"-p",
			"/opt/conda\u0000/evil",
			"/opt/conda\n--all",
		]) {
			expect(condaEnvsCreateInputSchema.safeParse({ name: "py311", prefix: bad }).success).toBe(
				false,
			);
		}
	});

	it("condaEnvsCreateResultSchema carries jobId + environment", () => {
		const result = {
			jobId: "j-1",
			environment: { name: "py311", prefix: "/opt/envs/py311" },
		};
		expect(condaEnvsCreateResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsDelete accepts name-only target", () => {
		expect(condaEnvsDeleteInputSchema.parse({ name: "py311" })).toEqual({ name: "py311" });
	});

	it("condaEnvsDelete accepts prefix-only target", () => {
		expect(condaEnvsDeleteInputSchema.parse({ prefix: "/opt/conda" })).toEqual({
			prefix: "/opt/conda",
		});
	});

	it("condaEnvsDeleteResult carries name and optional prefix", () => {
		expect(condaEnvsDeleteResultSchema.parse({ jobId: "j-2", name: "py311" })).toEqual({
			jobId: "j-2",
			name: "py311",
		});
		expect(
			condaEnvsDeleteResultSchema.parse({
				jobId: "j-2",
				name: "conda",
				prefix: "/opt/conda",
			}),
		).toEqual({ jobId: "j-2", name: "conda", prefix: "/opt/conda" });
	});

	it("condaEnvsClone I/O round-trip", () => {
		const input = { sourceName: "base-env", name: "cloned-env" };
		expect(condaEnvsCloneInputSchema.parse(input)).toEqual(input);
		const result = {
			jobId: "j-5",
			environment: { name: "cloned-env", prefix: "/opt/envs/cloned-env" },
		};
		expect(condaEnvsCloneResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsCreateFromFile I/O round-trip", () => {
		const handle = "123e4567-e89b-12d3-a456-426614174000";
		expect(condaEnvsCreateFromFileInputSchema.parse({ stagedHandle: handle })).toEqual({
			stagedHandle: handle,
		});
		expect(
			condaEnvsCreateFromFileInputSchema.parse({ stagedHandle: handle, name: "myenv" }),
		).toEqual({ stagedHandle: handle, name: "myenv" });
		const result = {
			jobId: "j-6",
			environment: { name: "myenv", prefix: "/opt/envs/myenv" },
		};
		expect(condaEnvsCreateFromFileResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsCreateFromFileInputSchema requires a UUID-shaped staged handle", () => {
		const valid = "123e4567-e89b-12d3-a456-426614174000";
		expect(condaEnvsCreateFromFileInputSchema.safeParse({ stagedHandle: valid }).success).toBe(
			true,
		);
		for (const bad of ["", "/tmp/env.yml", "not-a-uuid", "../../etc/passwd", `${valid}x`]) {
			expect(condaEnvsCreateFromFileInputSchema.safeParse({ stagedHandle: bad }).success).toBe(
				false,
			);
		}
	});

	it("condaEnvsCreateFromFileInputSchema rejects a raw file path — only a staged handle is accepted", () => {
		expect(condaEnvsCreateFromFileInputSchema.safeParse({ file: "/tmp/env.yml" }).success).toBe(
			false,
		);
	});

	it("condaEnvsDistributionsResultSchema round-trips", () => {
		const result = {
			distributions: [
				{ prefix: "/opt/miniconda3", priority: 10 },
				{ prefix: "/home/user/anaconda3", priority: 5 },
			],
		};
		expect(condaEnvsDistributionsResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsDistributionsResultSchema accepts empty list", () => {
		expect(condaEnvsDistributionsResultSchema.parse({ distributions: [] })).toEqual({
			distributions: [],
		});
	});
});

describe("conda.envs.clone I/O", () => {
	it("condaEnvsCloneInputSchema requires sourceName and name", () => {
		const input = { sourceName: "py311", name: "py311-copy" };
		expect(condaEnvsCloneInputSchema.parse(input)).toEqual(input);
	});

	it("condaEnvsCloneInputSchema rejects missing fields", () => {
		expect(condaEnvsCloneInputSchema.safeParse({ sourceName: "py311" }).success).toBe(false);
		expect(condaEnvsCloneInputSchema.safeParse({ name: "py311-copy" }).success).toBe(false);
		expect(condaEnvsCloneInputSchema.safeParse({}).success).toBe(false);
	});

	it("condaEnvsCloneInputSchema validates names with environment name rules", () => {
		expect(
			condaEnvsCloneInputSchema.safeParse({ sourceName: "has space", name: "ok" }).success,
		).toBe(false);
		expect(condaEnvsCloneInputSchema.safeParse({ sourceName: "ok", name: ".dotted" }).success).toBe(
			false,
		);
	});

	it("condaEnvsCloneResultSchema carries jobId + environment", () => {
		const result = {
			jobId: "j-10",
			environment: { name: "py311-copy", prefix: "/opt/envs/py311-copy" },
		};
		expect(condaEnvsCloneResultSchema.parse(result)).toEqual(result);
	});
});

describe("conda.envs.readFile I/O", () => {
	it("condaEnvsReadFileInputSchema accepts .yml and .yaml paths (case-insensitive)", () => {
		for (const filePath of [
			"/tmp/environment.yml",
			"/tmp/environment.yaml",
			"/tmp/ENVIRONMENT.YAML",
			"/Users/me/My Documents/env.yml",
		]) {
			expect(condaEnvsReadFileInputSchema.parse({ filePath })).toEqual({ filePath });
		}
	});

	it("condaEnvsReadFileInputSchema rejects non-YAML extensions", () => {
		for (const bad of ["/tmp/env.txt", "/tmp/env.json", "/tmp/env", "/tmp/env.yml.exe"]) {
			expect(condaEnvsReadFileInputSchema.safeParse({ filePath: bad }).success).toBe(false);
		}
	});

	it("condaEnvsReadFileInputSchema rejects flag-like paths", () => {
		// environmentFilePathSchema underneath rejects a leading `-` so the
		// path cannot pass for a conda CLI flag downstream.
		for (const bad of ["--file.yml", "-f.yaml"]) {
			expect(condaEnvsReadFileInputSchema.safeParse({ filePath: bad }).success).toBe(false);
		}
	});

	it("condaEnvsReadFileInputSchema rejects null bytes, CR/LF, tabs, and padded paths", () => {
		for (const bad of [
			"/tmp/env\u0000.yml",
			"/tmp/env\n.yml",
			"/tmp/env\r.yml",
			"/tmp/env\t.yml",
			" /tmp/env.yml",
			"/tmp/env.yml ",
		]) {
			expect(condaEnvsReadFileInputSchema.safeParse({ filePath: bad }).success).toBe(false);
		}
	});

	it("condaEnvsReadFileInputSchema caps length at PATH_MAX", () => {
		const okPath = `/${"a".repeat(4090)}.yml`;
		expect(okPath.length).toBeLessThanOrEqual(4096);
		expect(condaEnvsReadFileInputSchema.safeParse({ filePath: okPath }).success).toBe(true);
		const longPath = `/${"a".repeat(4092)}.yml`;
		expect(longPath.length).toBeGreaterThan(4096);
		expect(condaEnvsReadFileInputSchema.safeParse({ filePath: longPath }).success).toBe(false);
	});

	it("condaEnvsReadFileResultSchema carries content plus a server-minted staged handle", () => {
		const handle = "123e4567-e89b-12d3-a456-426614174000";
		expect(
			condaEnvsReadFileResultSchema.parse({ content: "name: x\n", stagedHandle: handle }),
		).toEqual({ content: "name: x\n", stagedHandle: handle });
		// The handle is required — a preview that cannot stage is not importable.
		expect(condaEnvsReadFileResultSchema.safeParse({ content: "name: x\n" }).success).toBe(false);
	});
});

describe("conda.envs.pickFile I/O", () => {
	it("condaEnvsPickFileInputSchema accepts an empty object", () => {
		expect(condaEnvsPickFileInputSchema.parse({})).toEqual({});
	});

	it("condaEnvsPickFileResultSchema returns a file path", () => {
		const result = { filePath: "/path/to/environment.yml" };
		expect(condaEnvsPickFileResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsPickFileResultSchema returns null when user cancels", () => {
		const result = { filePath: null };
		expect(condaEnvsPickFileResultSchema.parse(result)).toEqual(result);
	});
});

describe("conda.packages I/O", () => {
	it("condaPackagesListInputSchema accepts a name target", () => {
		expect(condaPackagesListInputSchema.parse({ name: "py311" })).toEqual({ name: "py311" });
	});

	it("condaPackagesListInputSchema accepts a prefix target", () => {
		expect(condaPackagesListInputSchema.parse({ prefix: "/opt/conda" })).toEqual({
			prefix: "/opt/conda",
		});
	});

	it("condaPackagesListInputSchema rejects an empty target", () => {
		expect(condaPackagesListInputSchema.safeParse({}).success).toBe(false);
	});

	it("condaPackagesListResultSchema round-trips an empty list", () => {
		const result = { envName: "py311", packages: [] };
		expect(condaPackagesListResultSchema.parse(result)).toEqual(result);
	});

	it("condaPackagesInstallInputSchema requires a non-empty packages array", () => {
		expect(condaPackagesInstallInputSchema.safeParse({ name: "py311", packages: [] }).success).toBe(
			false,
		);
		const input = { name: "py311", packages: ["numpy>=1.24"], channels: ["conda-forge"] };
		expect(condaPackagesInstallInputSchema.parse(input)).toEqual(input);
	});

	it("condaPackagesInstallInputSchema accepts prefix + packages", () => {
		const input = { prefix: "/opt/conda", packages: ["numpy>=1.24"] };
		expect(condaPackagesInstallInputSchema.parse(input)).toEqual(input);
	});

	it("condaPackagesInstallInputSchema rejects a local file path in packages", () => {
		// The install tool validates against this schema, so the refusal has to
		// reach the boundary the agent's call crosses.
		expect(
			condaPackagesInstallInputSchema.safeParse({
				name: "dev",
				packages: ["/Users/me/Downloads/pandas-3.0.6-py314hd1d6bd3_1.tar.bz2"],
			}).success,
		).toBe(false);
	});

	it("condaPackagesInstallResultSchema round-trips job + envName + installed", () => {
		const result = {
			jobId: "j-3",
			envName: "py311",
			installed: [
				{ name: "numpy", version: "1.26.4", build: "py311h1234_0", channel: "conda-forge" },
			],
		};
		expect(condaPackagesInstallResultSchema.parse(result)).toEqual(result);
	});

	it("condaPackagesRemoveInputSchema accepts name + packages", () => {
		expect(condaPackagesRemoveInputSchema.parse({ name: "py311", packages: ["numpy"] })).toEqual({
			name: "py311",
			packages: ["numpy"],
		});
	});

	it("condaPackagesRemoveInputSchema accepts prefix + packages", () => {
		expect(
			condaPackagesRemoveInputSchema.parse({ prefix: "/opt/conda", packages: ["numpy"] }),
		).toEqual({ prefix: "/opt/conda", packages: ["numpy"] });
	});

	it("condaPackagesRemoveInputSchema rejects empty packages array", () => {
		expect(condaPackagesRemoveInputSchema.safeParse({ name: "py311", packages: [] }).success).toBe(
			false,
		);
	});

	it("condaPackagesRemoveResultSchema returns removed package names", () => {
		const result = { jobId: "j-4", envName: "py311", removed: ["numpy", "scipy"] };
		expect(condaPackagesRemoveResultSchema.parse(result)).toEqual(result);
	});

	it("condaPackagesUpdateInputSchema accepts a targeted packages update", () => {
		const input = { name: "py311", packages: ["numpy"] };
		expect(condaPackagesUpdateInputSchema.parse(input)).toEqual(input);
	});

	it("condaPackagesUpdateInputSchema accepts an updateAll request", () => {
		const input = { name: "py311", updateAll: true };
		expect(condaPackagesUpdateInputSchema.parse(input)).toEqual(input);
	});

	it("condaPackagesUpdateInputSchema accepts prefix + channels with packages", () => {
		const input = { prefix: "/opt/conda", packages: ["numpy>=1.24"], channels: ["conda-forge"] };
		expect(condaPackagesUpdateInputSchema.parse(input)).toEqual(input);
	});

	it("condaPackagesUpdateInputSchema rejects neither packages nor updateAll", () => {
		expect(condaPackagesUpdateInputSchema.safeParse({ name: "py311" }).success).toBe(false);
	});

	it("condaPackagesUpdateInputSchema rejects both packages and updateAll", () => {
		expect(
			condaPackagesUpdateInputSchema.safeParse({
				name: "py311",
				packages: ["numpy"],
				updateAll: true,
			}).success,
		).toBe(false);
	});

	it("condaPackagesUpdateInputSchema rejects a missing env target", () => {
		expect(condaPackagesUpdateInputSchema.safeParse({ packages: ["numpy"] }).success).toBe(false);
	});

	it("condaPackagesUpdateInputSchema rejects an empty packages array", () => {
		expect(condaPackagesUpdateInputSchema.safeParse({ name: "py311", packages: [] }).success).toBe(
			false,
		);
	});

	it("condaPackagesUpdateResultSchema round-trips job + envName + updated", () => {
		const result = {
			jobId: "j-5",
			envName: "py311",
			updated: [
				{ name: "numpy", version: "1.26.4", build: "py311h1234_0", channel: "conda-forge" },
			],
		};
		expect(condaPackagesUpdateResultSchema.parse(result)).toEqual(result);
	});
});

describe("conda.channels I/O", () => {
	it("list result preserves order", () => {
		const list = ["conda-forge", "defaults", "https://conda.anaconda.org/anaconda"];
		expect(condaChannelsListResultSchema.parse(list)).toEqual(list);
	});

	it("add / remove input schemas require exactly one channel string", () => {
		expect(condaChannelsAddInputSchema.parse({ channel: "conda-forge" })).toEqual({
			channel: "conda-forge",
		});
		expect(condaChannelsAddInputSchema.parse({ channel: "conda-forge", position: 1 })).toEqual({
			channel: "conda-forge",
			position: 1,
		});
		expect(
			condaChannelsAddInputSchema.safeParse({ channel: "conda-forge", position: 0 }).success,
		).toBe(false);
		expect(condaChannelsRemoveInputSchema.parse({ channel: "conda-forge" })).toEqual({
			channel: "conda-forge",
		});
		expect(condaChannelsAddInputSchema.safeParse({ channel: "" }).success).toBe(false);
	});
});

describe("conda.repodata I/O", () => {
	const numpyPackage = {
		name: "numpy",
		version: "1.26.4",
		build: 2,
		channel: "https://conda.anaconda.org/conda-forge",
		summary: "Array computing with Python",
		home: "https://numpy.org",
		versions: [
			{ version: "1.26.4", size: 7_000_000 },
			{ version: "1.25.0", size: 6_500_000 },
		],
	};

	it("condaRepodataFindInputSchema accepts an empty filter and applies the default limit", () => {
		// An empty filter is a deliberate whole-index walk; `limit` is what keeps
		// it survivable.
		expect(condaRepodataFindInputSchema.parse({})).toEqual({
			limit: REPODATA_FIND_DEFAULT_LIMIT,
		});
	});

	it("condaRepodataFindInputSchema accepts names, channels, and subdirs", () => {
		const input = {
			names: ["numpy", "pip"],
			channels: ["conda-forge"],
			subdirs: ["osx-arm64", "noarch"],
		};
		expect(condaRepodataFindInputSchema.parse(input)).toEqual({
			...input,
			limit: REPODATA_FIND_DEFAULT_LIMIT,
		});
	});

	it("condaRepodataFindInputSchema rejects an empty names array", () => {
		// The bridge reads `names: []` as "return nothing"; omission means "no
		// filter". Rejecting `[]` keeps that distinction from being expressed by
		// accident.
		expect(condaRepodataFindInputSchema.safeParse({ names: [] }).success).toBe(false);
	});

	it("condaRepodataFindInputSchema accepts an explicit limit and rejects out-of-range values", () => {
		expect(condaRepodataFindInputSchema.parse({ limit: 5 }).limit).toBe(5);
		expect(condaRepodataFindInputSchema.safeParse({ limit: REPODATA_FIND_MAX_LIMIT }).success).toBe(
			true,
		);
		for (const bad of [0, -1, 1.5, REPODATA_FIND_MAX_LIMIT + 1]) {
			expect(condaRepodataFindInputSchema.safeParse({ limit: bad }).success).toBe(false);
		}
	});

	it("condaRepodataFindInputSchema rejects names that could be mistaken for a conda CLI flag", () => {
		for (const bad of ["--override-channels", "-c", "--json"]) {
			expect(condaRepodataFindInputSchema.safeParse({ names: [bad] }).success).toBe(false);
		}
	});

	it("condaRepodataFindInputSchema rejects multi-line or space-padded names", () => {
		for (const bad of ["num\npy", "num\tpy", " numpy", "numpy "]) {
			expect(condaRepodataFindInputSchema.safeParse({ names: [bad] }).success).toBe(false);
		}
	});

	it("condaRepodataFindInputSchema caps a name at 256 characters", () => {
		expect(condaRepodataFindInputSchema.safeParse({ names: ["a".repeat(256)] }).success).toBe(true);
		expect(condaRepodataFindInputSchema.safeParse({ names: ["a".repeat(257)] }).success).toBe(
			false,
		);
	});

	it("repodataQuerySchema accepts partial search terms", () => {
		for (const good of ["num", "NumPy", "scikit-", "a", "a".repeat(256)]) {
			expect(repodataQuerySchema.parse(good)).toBe(good);
		}
	});

	it("repodataQuerySchema rejects the empty string — omission already means no filter", () => {
		expect(repodataQuerySchema.safeParse("").success).toBe(false);
	});

	it("repodataQuerySchema rejects flag-like, padded, and multi-line terms", () => {
		for (const bad of ["--override-channels", "-c", " numpy", "numpy ", "num\npy", "num\tpy"]) {
			expect(repodataQuerySchema.safeParse(bad).success).toBe(false);
		}
	});

	it("repodataQuerySchema caps a term at 256 characters", () => {
		expect(repodataQuerySchema.safeParse("a".repeat(257)).success).toBe(false);
	});

	it("condaRepodataFindInputSchema rejects names and query together", () => {
		// The two filter modes are mutually exclusive: `names` goes to the
		// bridge exactly, `query` ranks the cached index in the main process.
		expect(condaRepodataFindInputSchema.safeParse({ names: ["numpy"], query: "num" }).success).toBe(
			false,
		);
	});

	it("condaRepodataFindInputSchema accepts query alone and applies the default limit", () => {
		expect(condaRepodataFindInputSchema.parse({ query: "num" })).toEqual({
			query: "num",
			limit: REPODATA_FIND_DEFAULT_LIMIT,
		});
	});

	it("subdirSchema rejects flag-like and padded subdirs", () => {
		expect(subdirSchema.parse("osx-arm64")).toBe("osx-arm64");
		expect(subdirSchema.safeParse("-64").success).toBe(false);
		expect(subdirSchema.safeParse(" noarch").success).toBe(false);
	});

	it("subdirSchema rejects embedded control chars that could smuggle a flag across the argv boundary", () => {
		// An interior newline passes the trim() guard (no leading/trailing
		// padding) and does not start with '-', so only the single-line guard
		// stops "noarch\n--override-channels" from reaching conda's argv.
		for (const bad of ["noarch\n--override-channels", "osx-arm64\t--json", "noarch\rlinux-64"]) {
			expect(subdirSchema.safeParse(bad).success).toBe(false);
		}
	});

	it("condaRepodataPackageSchema round-trips one aggregated package", () => {
		expect(condaRepodataPackageSchema.parse(numpyPackage)).toEqual(numpyPackage);
	});

	it("condaRepodataPackageSchema accepts the bridge's empty-string and null defaults", () => {
		// RepodataPackage defaults channel/summary/home to "" and version to
		// None, so none of those may be `.min(1)` or non-nullable.
		const bare = {
			name: "weird",
			version: null,
			build: 0,
			channel: "",
			summary: "",
			home: "",
			versions: [],
		};
		expect(condaRepodataPackageSchema.parse(bare)).toEqual(bare);
	});

	it("condaRepodataPackageSchema requires build to be an integer build number", () => {
		// The bridge sends `build_number`, not a build string like py311h1234_0.
		expect(
			condaRepodataPackageSchema.safeParse({ ...numpyPackage, build: "py311h1234_0" }).success,
		).toBe(false);
		expect(condaRepodataPackageSchema.safeParse({ ...numpyPackage, build: 1.5 }).success).toBe(
			false,
		);
	});

	it("condaRepodataPackageSchema rejects rows missing a pinned field", () => {
		const { versions: _versions, ...withoutVersions } = numpyPackage;
		expect(condaRepodataPackageSchema.safeParse(withoutVersions).success).toBe(false);
	});

	it("condaRepodataFindResultSchema round-trips populated and empty results", () => {
		const populated = { packages: [numpyPackage], truncated: true };
		expect(condaRepodataFindResultSchema.parse(populated)).toEqual(populated);
		expect(condaRepodataFindResultSchema.parse({ packages: [], truncated: false })).toEqual({
			packages: [],
			truncated: false,
		});
	});

	it("condaRepodataFindResultSchema requires the truncated flag", () => {
		expect(condaRepodataFindResultSchema.safeParse({ packages: [] }).success).toBe(false);
	});
});

describe("conda.envs.checkPrefix schemas", () => {
	it("requires an absolute prefix", () => {
		expect(condaEnvsCheckPrefixInputSchema.parse({ prefix: "/opt/conda/envs/dev" })).toEqual({
			prefix: "/opt/conda/envs/dev",
		});
		expect(condaEnvsCheckPrefixInputSchema.safeParse({ prefix: "envs/dev" }).success).toBe(false);
		expect(condaEnvsCheckPrefixInputSchema.safeParse({}).success).toBe(false);
	});

	it("round-trips available and unavailable results", () => {
		expect(condaEnvsCheckPrefixResultSchema.parse({ available: true })).toEqual({
			available: true,
		});
		expect(
			condaEnvsCheckPrefixResultSchema.parse({ available: false, reason: "exists-environment" }),
		).toEqual({ available: false, reason: "exists-environment" });
	});

	it("requires a known reason when unavailable", () => {
		expect(condaEnvsCheckPrefixResultSchema.safeParse({ available: false }).success).toBe(false);
		expect(
			condaEnvsCheckPrefixResultSchema.safeParse({ available: false, reason: "nope" }).success,
		).toBe(false);
	});
});

describe("the conda domain object", () => {
	it("offers every method origin's conda contract had", () => {
		expect(new Set(Object.keys(Conda.methods))).toEqual(
			new Set([
				"listEnvironments",
				"distributions",
				"createEnvironment",
				"cloneEnvironment",
				"createEnvironmentFromFile",
				"deleteEnvironment",
				"pickEnvironmentFile",
				"readEnvironmentFile",
				"prefixOptions",
				"checkPrefix",
				"listPackages",
				"installPackages",
				"removePackages",
				"updatePackages",
				"previewUpdate",
				"previewInstall",
				"listChannels",
				"addChannel",
				"removeChannel",
				"findRepodata",
				"cancelJob",
			]),
		);
	});

	it("reads no input for a list and answers environments", () => {
		expect(Conda.methods.listEnvironments.input.parse(undefined)).toBeUndefined();
		expect(Conda.methods.listEnvironments.output.parse([])).toEqual([]);
	});
});

describe("condaExecutable", () => {
	it("finds executables in bin, or Library\\bin with .exe on Windows", () => {
		expect(condaExecutable("/tmp/env/", "llama-server", "other")).toBe("/tmp/env/bin/llama-server");
		expect(condaExecutable("C:\\envs\\x", "llama-server", "win32")).toBe(
			"C:\\envs\\x\\Library\\bin\\llama-server.exe",
		);
		expect(condaExecutable("C:\\envs\\x", "tool.exe", "win32")).toBe(
			"C:\\envs\\x\\Library\\bin\\tool.exe",
		);
		expect(() => condaExecutable("/tmp/env", "../evil", "other")).toThrow("Invalid executable");
	});
});
