import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ANACONDA_MAIN_CHANNEL, CONDA_FORGE_CHANNEL } from "./channel-presentation";
import { useChannelSelection, type ConfiguredChannels } from "./use-channel-selection";

afterEach(() => {
	cleanup();
});

const LOADING: ConfiguredChannels = { status: "loading" };
const loaded = (channels: string[]): ConfiguredChannels => ({ status: "loaded", channels });
const PRODUCT_CHANNELS = [ANACONDA_MAIN_CHANNEL, CONDA_FORGE_CHANNEL];

function renderSelection(initial: ConfiguredChannels, extra?: readonly string[]) {
	return renderHook(
		({ configured }: { configured: ConfiguredChannels }) => useChannelSelection(configured, extra),
		{ initialProps: { configured: initial } },
	);
}

describe("useChannelSelection", () => {
	it("offers nothing and is not ready while the configured channels load", () => {
		const { result } = renderSelection(LOADING);

		expect(result.current.status).toBe("loading");
		expect(result.current.ready).toBe(false);
		expect(result.current.available).toEqual([]);
		expect(result.current.channelsArg).toBeUndefined();
	});

	it("falls back to defaults and conda-forge only when none are configured", () => {
		const { result } = renderSelection(loaded([]));

		expect(result.current.ready).toBe(true);
		expect(result.current.available).toEqual(PRODUCT_CHANNELS);
		expect(result.current.selected).toEqual(PRODUCT_CHANNELS);
		expect(result.current.summary).toBe("All channels");
	});

	it("offers and selects exactly the configured channels once they load", () => {
		const { result, rerender } = renderSelection(LOADING);

		rerender({ configured: loaded(["conda-forge", "bioconda"]) });

		expect(result.current.available).toEqual(["conda-forge", "bioconda"]);
		expect(result.current.selected).toEqual(["conda-forge", "bioconda"]);
		expect(result.current.channelsArg).toEqual(["conda-forge", "bioconda"]);
	});

	it("exposes a failed channel list without falling back to the fixed channels", () => {
		const error = new Error("PROVIDER_NOT_READY: bridge exited");
		const { result } = renderSelection({ status: "failed", error });

		expect(result.current.status).toBe("failed");
		expect(result.current.ready).toBe(false);
		expect(result.current.error).toBe(error);
		expect(result.current.available).toEqual([]);
		expect(result.current.channelsArg).toBeUndefined();
	});

	it("offers and selects an install link's channel first, even before the list loads", () => {
		const { result, rerender } = renderSelection(LOADING, ["bioconda"]);
		expect(result.current.available).toEqual(["bioconda"]);
		expect(result.current.selected).toEqual(["bioconda"]);

		rerender({ configured: loaded(["defaults", "bioconda"]) });

		expect(result.current.available).toEqual(["bioconda", "defaults"]);
		expect(result.current.selected).toEqual(["bioconda", "defaults"]);
		expect(result.current.linkChannels).toEqual(["bioconda"]);
	});

	it("keeps the user's choice when the channels change", () => {
		const { result, rerender } = renderSelection(loaded(["defaults", "conda-forge"]));
		act(() => result.current.toggle(CONDA_FORGE_CHANNEL));

		rerender({ configured: loaded(["defaults", "conda-forge", "bioconda"]) });

		expect(result.current.available).toEqual([...PRODUCT_CHANNELS, "bioconda"]);
		expect(result.current.selected).toEqual([ANACONDA_MAIN_CHANNEL]);
	});

	it("keeps channel priority when a channel is toggled back on", () => {
		const { result } = renderSelection(loaded(["defaults", "conda-forge", "bioconda"]));
		act(() => result.current.toggle(ANACONDA_MAIN_CHANNEL));
		act(() => result.current.toggle(ANACONDA_MAIN_CHANNEL));

		expect(result.current.selected).toEqual([...PRODUCT_CHANNELS, "bioconda"]);
	});

	it("re-seeds the defaults when the channels change while nothing is selected", () => {
		const { result, rerender } = renderSelection(loaded([]));
		act(() => {
			result.current.toggle(CONDA_FORGE_CHANNEL);
			result.current.toggle(ANACONDA_MAIN_CHANNEL);
		});
		expect(result.current.selected).toEqual([]);

		rerender({ configured: loaded(["bioconda"]) });

		expect(result.current.selected).toEqual(["bioconda"]);
	});
});
