import { describe, expect, it } from "vitest";

import {
	channelSchema,
	condaChannelsAddInputSchema,
	condaChannelsListResultSchema,
	condaChannelsRemoveInputSchema,
	condaContract,
	condaDistributionSchema,
	condaEnvSchema,
	condaEnvsCloneInputSchema,
	condaEnvsCloneResultSchema,
	condaEnvsCreateFromFileInputSchema,
	condaEnvsCreateFromFileResultSchema,
	condaEnvsCreateInputSchema,
	condaEnvsCreateResultSchema,
	condaEnvsDeleteInputSchema,
	condaEnvsDeleteResultSchema,
	condaEnvsDistributionsResultSchema,
	condaPackageSchema,
	condaPackagesInstallInputSchema,
	condaPackagesInstallResultSchema,
	condaPackagesListInputSchema,
	condaPackagesListResultSchema,
	condaPackagesRemoveInputSchema,
	condaPackagesRemoveResultSchema,
	ENVIRONMENT_NAME_PATTERN,
	environmentNameSchema,
	matchSpecSchema,
} from "./conda.js";

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

	it("condaEnvsCreateResultSchema carries jobId + environment", () => {
		const result = {
			jobId: "j-1",
			environment: { name: "py311", prefix: "/opt/envs/py311" },
		};
		expect(condaEnvsCreateResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsDelete I/O round-trip", () => {
		expect(condaEnvsDeleteInputSchema.parse({ name: "py311" })).toEqual({ name: "py311" });
		expect(condaEnvsDeleteResultSchema.parse({ jobId: "j-2", name: "py311" })).toEqual({
			jobId: "j-2",
			name: "py311",
		});
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
		expect(condaEnvsCreateFromFileInputSchema.parse({ file: "/tmp/env.yml" })).toEqual({
			file: "/tmp/env.yml",
		});
		expect(
			condaEnvsCreateFromFileInputSchema.parse({ file: "/tmp/env.yml", name: "myenv" }),
		).toEqual({ file: "/tmp/env.yml", name: "myenv" });
		const result = {
			jobId: "j-6",
			environment: { name: "myenv", prefix: "/opt/envs/myenv" },
		};
		expect(condaEnvsCreateFromFileResultSchema.parse(result)).toEqual(result);
	});

	it("condaEnvsCreateFromFileInputSchema rejects empty file path", () => {
		expect(condaEnvsCreateFromFileInputSchema.safeParse({ file: "" }).success).toBe(false);
	});

	it("condaEnvsCreateFromFileInputSchema rejects paths that could be mistaken for a conda CLI flag", () => {
		// Same rationale as matchSpecSchema / channelSchema: argparse accepts
		// options interspersed with positionals, so a leading `-` could smuggle
		// a flag through the argv boundary.
		for (const bad of ["--dry-run", "-c", "--file"]) {
			expect(condaEnvsCreateFromFileInputSchema.safeParse({ file: bad }).success).toBe(false);
		}
	});

	it("condaEnvsCreateFromFileInputSchema rejects null bytes, newlines, tabs, and padded paths", () => {
		for (const bad of [
			"/tmp/env.yml\0/etc/passwd",
			"/tmp/env.yml\nrm -rf /",
			"/tmp/env\t.yml",
			" /tmp/env.yml",
			"/tmp/env.yml ",
		]) {
			expect(condaEnvsCreateFromFileInputSchema.safeParse({ file: bad }).success).toBe(false);
		}
	});

	it("condaEnvsCreateFromFileInputSchema allows interior spaces and caps length at PATH_MAX", () => {
		// Interior spaces are legitimate in real paths and must not be rejected.
		expect(
			condaEnvsCreateFromFileInputSchema.safeParse({ file: "/Users/me/My Documents/env.yml" })
				.success,
		).toBe(true);
		expect(
			condaEnvsCreateFromFileInputSchema.safeParse({ file: `/${"a".repeat(4095)}` }).success,
		).toBe(true);
		expect(
			condaEnvsCreateFromFileInputSchema.safeParse({ file: `/${"a".repeat(4096)}` }).success,
		).toBe(false);
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

describe("conda.packages I/O", () => {
	it("condaPackagesListInputSchema requires envName", () => {
		expect(condaPackagesListInputSchema.parse({ envName: "py311" })).toEqual({ envName: "py311" });
		expect(condaPackagesListInputSchema.safeParse({}).success).toBe(false);
	});

	it("condaPackagesListResultSchema round-trips an empty list", () => {
		const result = { envName: "py311", packages: [] };
		expect(condaPackagesListResultSchema.parse(result)).toEqual(result);
	});

	it("condaPackagesInstallInputSchema requires a non-empty packages array", () => {
		expect(
			condaPackagesInstallInputSchema.safeParse({ envName: "py311", packages: [] }).success,
		).toBe(false);
		const input = { envName: "py311", packages: ["numpy>=1.24"], channels: ["conda-forge"] };
		expect(condaPackagesInstallInputSchema.parse(input)).toEqual(input);
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

	it("condaPackagesRemoveInputSchema mirrors install for its inputs", () => {
		expect(condaPackagesRemoveInputSchema.parse({ envName: "py311", packages: ["numpy"] })).toEqual(
			{ envName: "py311", packages: ["numpy"] },
		);
		expect(
			condaPackagesRemoveInputSchema.safeParse({ envName: "py311", packages: [] }).success,
		).toBe(false);
	});

	it("condaPackagesRemoveResultSchema returns removed package names", () => {
		const result = { jobId: "j-4", envName: "py311", removed: ["numpy", "scipy"] };
		expect(condaPackagesRemoveResultSchema.parse(result)).toEqual(result);
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
		expect(condaChannelsRemoveInputSchema.parse({ channel: "conda-forge" })).toEqual({
			channel: "conda-forge",
		});
		expect(condaChannelsAddInputSchema.safeParse({ channel: "" }).success).toBe(false);
	});
});

describe("condaContract", () => {
	it("declares every v1 tool the delivery plan pins", () => {
		expect(new Set(Object.keys(condaContract))).toEqual(
			new Set([
				"conda.envs.list",
				"conda.envs.distributions",
				"conda.envs.create",
				"conda.envs.clone",
				"conda.envs.createFromFile",
				"conda.envs.delete",
				"conda.packages.list",
				"conda.packages.install",
				"conda.packages.remove",
				"conda.channels.list",
				"conda.channels.add",
				"conda.channels.remove",
				"conda.jobs.cancel",
			]),
		);
	});

	it("uses matching input/output schemas so the compile-time InferContract type stays honest", () => {
		expect(condaContract["conda.envs.list"].input.parse(undefined)).toBeUndefined();
		expect(condaContract["conda.envs.list"].output.parse([])).toEqual([]);
	});
});
