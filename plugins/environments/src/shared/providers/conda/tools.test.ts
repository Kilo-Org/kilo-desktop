import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import { registerCondaTools } from "./tools.js";

function registry() {
	const sdk = createFakeSdk({ featureId: "environments" });
	registerCondaTools(sdk);
	return sdk.services.toolRegistry;
}

/** Matches the model-facing channel refusal message from the contract. */
const CHANNEL_REFUSAL = /cannot be a URL or a local path/i;

/** Every agent-initiated tool that accepts a `channels` argument. */
const CHANNEL_TOOLS = [
	"conda.envs.create",
	"conda.packages.install",
	"conda.packages.update",
	"conda.repodata.find",
] as const;

/** Non-named channels the agent must not be able to point conda at. */
const NON_NAMED_CHANNELS = [
	"https://evil.example/conda",
	"file:///tmp/channel",
	"/tmp/channel",
	"~/channel",
	"C:\\channel",
] as const;

describe("agent conda tools refuse non-named channels (C1 gate 2)", () => {
	it.each(CHANNEL_TOOLS)("%s refuses a URL or local-path channel", async (tool) => {
		for (const channel of NON_NAMED_CHANNELS) {
			await expect(
				registry().invoke("environments", tool, {
					name: "dev",
					packages: ["numpy"],
					channels: [channel],
				}),
			).rejects.toThrow(CHANNEL_REFUSAL);
		}
	});

	it("lets named channels pass channel validation", async () => {
		// The refusal is the only thing under test here; any later failure
		// (unregistered main handler, sign-in) is fine.
		await expect(
			registry().invoke("environments", "conda.packages.install", {
				name: "dev",
				packages: ["numpy"],
				channels: ["defaults", "conda-forge"],
			}),
		).rejects.not.toThrow(CHANNEL_REFUSAL);
	});

	it("exposes channel add/remove and refuses non-named channels", async () => {
		const tools = registry()
			.all()
			.map((tool) => tool.name);
		expect(tools).toContain("conda.channels.add");
		expect(tools).toContain("conda.channels.remove");

		for (const tool of ["conda.channels.add", "conda.channels.remove"] as const) {
			for (const channel of NON_NAMED_CHANNELS) {
				await expect(registry().invoke("environments", tool, { channel })).rejects.toThrow(
					CHANNEL_REFUSAL,
				);
			}
			// A named channel clears the guard; any later failure (unregistered
			// main handler) is fine.
			await expect(
				registry().invoke("environments", tool, { channel: "conda-forge" }),
			).rejects.not.toThrow(CHANNEL_REFUSAL);
		}
	});
});

describe("Anaconda channel preference", () => {
	it.each(["conda.envs.create", "conda.packages.install", "conda.packages.update"])(
		"%s always advertises the preference",
		(name) => {
			const tool = registry()
				.all()
				.find((candidate) => candidate.name === name);
			expect(tool?.description).toMatch(/prefer Anaconda's channels/i);
		},
	);
});

describe("no-channels ask flow", () => {
	it.each(["conda.envs.create", "conda.packages.install", "conda.packages.update"])(
		"%s offers `defaults` as a yes/no and names no alternative channel",
		(name) => {
			const tool = registry()
				.all()
				.find((candidate) => candidate.name === name);
			expect(tool?.description).toMatch(/no_channels_configured/);
			expect(tool?.description).toMatch(/do not pick or propose a channel yourself/i);
			expect(tool?.description).toMatch(/do not offer or name any other channel/i);
			expect(tool?.description).toMatch(/Shall I use `defaults`\?/);
		},
	);

	it("conda.channels.list explains that an empty list means nothing is configured", () => {
		const tool = registry()
			.all()
			.find((candidate) => candidate.name === "conda.channels.list");
		expect(tool?.description).toMatch(/EMPTY array means no channels are configured/);
	});
});
