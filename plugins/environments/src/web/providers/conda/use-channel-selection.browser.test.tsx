import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ANACONDA_MAIN_CHANNEL, CONDA_FORGE_CHANNEL } from "./channel-presentation";
import { useChannelSelection } from "./use-channel-selection";

afterEach(() => {
	cleanup();
});

const PRODUCT_CHANNELS = [CONDA_FORGE_CHANNEL, ANACONDA_MAIN_CHANNEL];

describe("useChannelSelection", () => {
	it("selects every offered channel before the configured channels load", () => {
		const { result } = renderHook(() => useChannelSelection(undefined));
		expect(result.current.selected).toEqual(PRODUCT_CHANNELS);
		expect(result.current.summary).toBe("All channels");
	});

	it("keeps the user's choice when the configured channels arrive", () => {
		const { result, rerender } = renderHook(
			({ configured }: { configured: string[] | undefined }) => useChannelSelection(configured),
			{ initialProps: { configured: undefined } as { configured: string[] | undefined } },
		);
		act(() => result.current.toggle(CONDA_FORGE_CHANNEL));

		rerender({ configured: ["bioconda"] });

		expect(result.current.available).toEqual([...PRODUCT_CHANNELS, "bioconda"]);
		expect(result.current.selected).toEqual([ANACONDA_MAIN_CHANNEL]);
	});

	it("re-seeds the defaults when the channels change while nothing is selected", () => {
		const { result, rerender } = renderHook(
			({ configured }: { configured: string[] | undefined }) => useChannelSelection(configured),
			{ initialProps: { configured: undefined } as { configured: string[] | undefined } },
		);
		act(() => {
			result.current.toggle(CONDA_FORGE_CHANNEL);
			result.current.toggle(ANACONDA_MAIN_CHANNEL);
		});
		expect(result.current.selected).toEqual([]);

		rerender({ configured: ["bioconda"] });

		expect(result.current.selected).toEqual([...PRODUCT_CHANNELS, "bioconda"]);
	});
});
