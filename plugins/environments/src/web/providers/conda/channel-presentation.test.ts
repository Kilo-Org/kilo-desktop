import { describe, expect, it } from "vitest";

import {
	defaultChannelSelection,
	getChannelPresentation,
	selectableChannels,
} from "./channel-presentation";

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

describe("getChannelPresentation for an install link's channel", () => {
	it("shows the link's channel as given, apart from the product channels", () => {
		expect(getChannelPresentation("msys2", { fromLink: true })).toEqual({
			kind: "other",
			title: "msys2",
			description: "From the install link.",
		});
		expect(
			getChannelPresentation("https://repo.anaconda.com/pkgs/main", { fromLink: true }),
		).toMatchObject({
			title: "https://repo.anaconda.com/pkgs/main",
			description: "From the install link.",
		});
		expect(getChannelPresentation("bioconda", { fromLink: true })).toMatchObject({
			title: "bioconda",
			description: "From the install link.",
		});
	});

	it("keeps the product presentation when the link names a product channel", () => {
		expect(getChannelPresentation("defaults", { fromLink: true })).toEqual(
			getChannelPresentation("defaults"),
		);
		expect(getChannelPresentation("conda-forge", { fromLink: true })).toEqual(
			getChannelPresentation("conda-forge"),
		);
	});
});
