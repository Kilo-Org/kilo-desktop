import { describe, expect, it } from "vitest";

import {
	classifyChannel,
	findPermissionToolArgs,
	isMutatingCondaTool,
	isPerActionCondaMutation,
	summarizeCondaInvocation,
} from "./conda-tool-invocation.js";

describe("classifyChannel", () => {
	it("trusts main and defaults", () => {
		expect(classifyChannel("main")).toBe("trusted");
		expect(classifyChannel("defaults")).toBe("trusted");
		expect(classifyChannel(" MAIN ")).toBe("trusted");
	});

	it("recognises conda-forge but does not trust it", () => {
		expect(classifyChannel("conda-forge")).toBe("known");
	});

	it("treats anything else, including URLs and local paths, as unknown", () => {
		expect(classifyChannel("https://evil.example/conda")).toBe("unknown");
		expect(classifyChannel("file:///tmp/channel")).toBe("unknown");
		expect(classifyChannel("bioconda")).toBe("unknown");
	});
});

describe("findPermissionToolArgs", () => {
	const messages = [
		{
			id: "msg-1",
			content: [
				{ type: "text", text: "hi" },
				{ type: "tool-call", toolCallId: "call-1", toolName: "desktop_x", args: { name: "env" } },
			],
		},
	];

	it("returns the args of the matching tool call", () => {
		expect(findPermissionToolArgs(messages, { messageID: "msg-1", callID: "call-1" })).toEqual({
			name: "env",
		});
	});

	it("matches by call id regardless of the message id", () => {
		expect(findPermissionToolArgs(messages, { messageID: "other", callID: "call-1" })).toEqual({
			name: "env",
		});
	});

	it("returns undefined when there is no tool or no match", () => {
		expect(findPermissionToolArgs(messages, undefined)).toBeUndefined();
		expect(
			findPermissionToolArgs(messages, { messageID: "msg-1", callID: "nope" }),
		).toBeUndefined();
		expect(
			findPermissionToolArgs(undefined, { messageID: "msg-1", callID: "call-1" }),
		).toBeUndefined();
	});
});

describe("summarizeCondaInvocation", () => {
	it("ignores non-conda tools", () => {
		expect(summarizeCondaInvocation("bash", { channels: ["evil"] })).toBeUndefined();
		expect(summarizeCondaInvocation("desktop_environments_conda_envs_list", {})).toBeUndefined();
	});

	it("summarises environment, packages, and channels", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_install", {
				name: "analysis",
				packages: ["numpy", "pandas"],
			}),
		).toEqual({
			environment: "analysis",
			packages: ["numpy", "pandas"],
			channels: [],
			channelsUnspecified: true,
			warnings: [],
		});
	});

	it("flags tools that accept channels but got none as using the defaults", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_create", { name: "e" })
				?.channelsUnspecified,
		).toBe(true);
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_update", {
				name: "e",
				packages: ["x"],
			})?.channelsUnspecified,
		).toBe(true);
		// Explicit channels win.
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_create", {
				name: "e",
				channels: ["main"],
			})?.channelsUnspecified,
		).toBe(false);
		// Tools without a channels argument never claim defaults.
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_delete", { name: "e" })
				?.channelsUnspecified,
		).toBe(false);
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_remove", {
				name: "e",
				packages: ["x"],
			})?.channelsUnspecified,
		).toBe(false);
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_clone", { name: "e" })
				?.channelsUnspecified,
		).toBe(false);
	});

	it("falls back to prefix for the environment", () => {
		const summary = summarizeCondaInvocation("desktop_environments_conda_envs_create", {
			prefix: "/envs/x",
		});
		expect(summary?.environment).toBe("/envs/x");
	});

	it("de-duplicates a repeated channel so its warning (and React key) is unique", () => {
		const summary = summarizeCondaInvocation("desktop_environments_conda_envs_create", {
			name: "e",
			channels: ["https://evil.example/conda", "https://evil.example/conda", "main"],
		});
		expect(summary?.channels).toEqual(["https://evil.example/conda", "main"]);
		expect(summary?.warnings).toEqual(["Unknown channel: https://evil.example/conda"]);
	});

	it("surfaces a URL/path package spec as a non-default source", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_install", {
				name: "e",
				packages: ["numpy", "https://evil.example/pkg-1.0-0.conda"],
			})?.warnings,
		).toEqual(["Non-default package source: https://evil.example/pkg-1.0-0.conda"]);
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_install", {
				name: "e",
				packages: ["file:///tmp/pkg"],
			})?.warnings,
		).toEqual(["Non-default package source: file:///tmp/pkg"]);
	});

	it("surfaces a non-default channel qualifier in a package spec", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_install", {
				name: "e",
				packages: ["evil::numpy"],
			})?.warnings,
		).toEqual(["Unknown channel: evil"]);
	});

	it("does not warn for default sources in a package spec", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_install", {
				name: "e",
				packages: ["numpy", "conda-forge::pandas"],
			})?.warnings,
		).toEqual([]);
	});

	it("identifies the mutating conda tools the consent gate covers", () => {
		expect(isMutatingCondaTool("desktop_environments_conda_packages_install")).toBe(true);
		expect(isMutatingCondaTool("desktop_environments_conda_envs_delete")).toBe(true);
		expect(isMutatingCondaTool("desktop_environments_conda_envs_list")).toBe(false);
		expect(isMutatingCondaTool("desktop_environments_conda_setup_open")).toBe(false);
		expect(isMutatingCondaTool("bash")).toBe(false);
	});

	it("treats both the gated MCP tools and conda-CLI bash commands as per-action", () => {
		// MCP tool path — no standing allow.
		expect(isPerActionCondaMutation("desktop_environments_conda_packages_install", ["*"])).toBe(
			true,
		);
		// CLI substitution path — a bash request running a conda mutation.
		expect(isPerActionCondaMutation("bash", ["conda install numpy"])).toBe(true);
		expect(isPerActionCondaMutation("bash", ["/opt/anaconda3/bin/mamba env create -f e.yml"])).toBe(
			true,
		);
		// Read-only tool and a non-conda bash command keep the standing allow.
		expect(isPerActionCondaMutation("desktop_environments_conda_envs_list", ["*"])).toBe(false);
		expect(isPerActionCondaMutation("bash", ["rm -rf /tmp/x"])).toBe(false);
	});

	it("warns on unknown channels only (not main/defaults/conda-forge)", () => {
		const trusted = summarizeCondaInvocation("desktop_environments_conda_envs_create", {
			name: "e",
			channels: ["main", "defaults", "conda-forge"],
		});
		expect(trusted?.warnings).toEqual([]);

		const unknown = summarizeCondaInvocation("desktop_environments_conda_envs_create", {
			name: "e",
			channels: ["main", "https://evil.example/conda"],
		});
		expect(unknown?.warnings).toEqual(["Unknown channel: https://evil.example/conda"]);

		// A `file://` (or bare path) channel is a non-default source too.
		const fileChannel = summarizeCondaInvocation("desktop_environments_conda_envs_create", {
			name: "e",
			channels: ["file:///tmp/channel"],
		});
		expect(fileChannel?.warnings).toEqual(["Unknown channel: file:///tmp/channel"]);
	});

	it("warns that delete removes the whole environment", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_delete", { name: "e" })?.warnings,
		).toEqual([
			"Removes the entire environment and all of its packages. This is irreversible — review carefully before allowing.",
		]);
	});

	it("warns that updateAll rewrites every package in the environment", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_update", {
				name: "e",
				updateAll: true,
			})?.warnings,
		).toEqual(["Updates all packages in the environment; this can break it."]);
	});

	it("does not warn for a targeted package update", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_packages_update", {
				name: "e",
				packages: ["numpy"],
			})?.warnings,
		).toEqual([]);
	});

	it("returns undefined when args are unavailable", () => {
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_create", undefined),
		).toBeUndefined();
		expect(
			summarizeCondaInvocation("desktop_environments_conda_envs_create", "nope"),
		).toBeUndefined();
	});
});
