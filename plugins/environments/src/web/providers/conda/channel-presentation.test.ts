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
			description: "Community-maintained, open-source.",
		});
	});

	it("presents Anaconda channels as sign-in gated with the Main badge", () => {
		for (const channel of ["defaults", "anaconda", "main", "r", "msys2", "pro"]) {
			const presentation = getChannelPresentation(channel);
			expect(presentation).toMatchObject({
				kind: "anaconda",
				title: "Anaconda",
				badge: "Main",
			});
		}
	});

	it("detects Anaconda channels from repository URLs", () => {
		expect(getChannelPresentation("https://repo.anaconda.com/pkgs/main").kind).toBe("anaconda");
		expect(getChannelPresentation("https://conda.anaconda.org/anaconda/").kind).toBe("anaconda");
		expect(getChannelPresentation("https://conda.anaconda.org/conda-forge").kind).toBe("other");
	});

	it("falls back to a neutral presentation for custom channels", () => {
		expect(getChannelPresentation("bioconda")).toEqual({
			kind: "other",
			title: "bioconda",
			description: "Configured in your conda settings.",
		});
	});
});

describe("defaultChannelSelection", () => {
	it("selects every channel for signed-in users", () => {
		expect(defaultChannelSelection(["defaults", "conda-forge"])).toEqual([
			"defaults",
			"conda-forge",
		]);
	});

	it("selects every offered channel", () => {
		expect(defaultChannelSelection(["defaults", "conda-forge", "bioconda"])).toEqual([
			"defaults",
			"conda-forge",
			"bioconda",
		]);
	});
});
