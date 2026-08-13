import { cleanup, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatModelSelectionProvider, useChatModelSelection } from "./ChatModelSelectionContext.js";

afterEach(cleanup);

describe("useChatModelSelection", () => {
	it("returns the nearest provider value", () => {
		const value = {
			model: undefined,
			setModel: vi.fn(),
			effort: undefined,
			setEffort: vi.fn(),
			name: undefined,
			efforts: undefined,
			catalog: undefined,
			isCatalogPending: false,
			isCatalogError: false,
		};
		function Wrapper({ children }: { children: ReactNode }) {
			return <ChatModelSelectionProvider value={value}>{children}</ChatModelSelectionProvider>;
		}

		const { result } = renderHook(useChatModelSelection, { wrapper: Wrapper });

		expect(result.current).toBe(value);
	});

	it("rejects use outside the provider", () => {
		expect(() => renderHook(useChatModelSelection)).toThrowError(
			"useChatModelSelection requires ChatModelSelectionProvider",
		);
	});
});
