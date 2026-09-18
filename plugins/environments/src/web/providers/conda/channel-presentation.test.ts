import { describe, expect, it } from "vitest";

import {
	defaultChannelSelection,
	getChannelPresentation,
	selectableChannels,
} from "./channel-presentation.js";

describe("selectableChannels", () => {
	it("offers conda-forge and Anaconda MAIN when none are configured", () => {
		expect(selectableChannels([])).toEqual(["conda-forge", "defaults"]);
	});

	it("keeps custom channels without duplicating Anaconda aliases", () => {
		expect(selectableChannels(["main", "conda-forge", "bioconda"])).toEqual([
			"conda-forge",
			"defaults",
			"bioconda",
		]);
	});
});

describe("getChannelPresentation", () => {
	it("presents conda-forge as the community channel", () => {
		expect(getChannelPresentation("conda-forge")).toEqual({
			kind: "conda-forge",
			title: "conda-forge",
			description: "Community-maintained, open-source. No sign-in needed.",
			requiresSignIn: false,
		});
	});

	it("presents Anaconda channels as sign-in gated with the MAIN badge", () => {
		for (const channel of ["defaults", "anaconda", "main", "r", "msys2", "pro"]) {
			const presentation = getChannelPresentation(channel);
			expect(presentation).toMatchObject({
				kind: "anaconda",
				title: "Anaconda",
				badge: "MAIN",
				requiresSignIn: true,
			});
		}
	});

	it("detects Anaconda channels from repository URLs", () => {
		expect(getChannelPresentation("https://repo.anaconda.com/pkgs/main").requiresSignIn).toBe(true);
		expect(getChannelPresentation("https://conda.anaconda.org/anaconda/").requiresSignIn).toBe(
			true,
		);
		expect(getChannelPresentation("https://conda.anaconda.org/conda-forge").requiresSignIn).toBe(
			false,
		);
	});

	it("falls back to a neutral presentation for custom channels", () => {
		expect(getChannelPresentation("bioconda")).toEqual({
			kind: "other",
			title: "bioconda",
			description: "Configured in your conda settings.",
			requiresSignIn: false,
		});
	});
});

describe("defaultChannelSelection", () => {
	it("selects every channel for signed-in users", () => {
		expect(defaultChannelSelection(["defaults", "conda-forge"], true)).toEqual([
			"defaults",
			"conda-forge",
		]);
	});

	it("skips sign-in-gated channels for signed-out users", () => {
		expect(defaultChannelSelection(["defaults", "conda-forge", "bioconda"], false)).toEqual([
			"conda-forge",
			"bioconda",
		]);
	});
});
