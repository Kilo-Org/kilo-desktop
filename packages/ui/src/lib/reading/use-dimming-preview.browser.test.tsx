import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDimmingPreview } from "./use-dimming-preview";

describe("useDimmingPreview", () => {
	it("shows the dragged value until a saved one arrives", () => {
		const { result, rerender } = renderHook(({ saved }) => useDimmingPreview(saved), {
			initialProps: { saved: 60 },
		});

		act(() => result.current.onDimmingInput(90));
		expect(result.current.dimming).toBe(90);

		rerender({ saved: 90 });
		expect(result.current.dimming).toBe(90);
	});

	it("doesn't bring back a spent preview when the saved value returns to its old one", () => {
		const { result, rerender } = renderHook(({ saved }) => useDimmingPreview(saved), {
			initialProps: { saved: 60 },
		});
		act(() => result.current.onDimmingInput(100));
		rerender({ saved: 100 });

		rerender({ saved: 60 });

		expect(result.current.dimming).toBe(60);
	});
});
