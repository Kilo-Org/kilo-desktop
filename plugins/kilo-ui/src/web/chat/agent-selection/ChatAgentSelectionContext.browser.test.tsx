import { cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatAgentSelectionProvider, useChatAgentSelection } from "./ChatAgentSelectionContext.js";

afterEach(() => {
	cleanup();
});

const value = {
	agent: "code",
	setAgent: vi.fn(),
	catalog: undefined,
	isCatalogPending: false,
	isCatalogError: false,
};

describe("useChatAgentSelection", () => {
	it("returns the provided selection status when rendered within the provider", () => {
		const wrapper = ({ children }: { children: ReactNode }) => (
			<ChatAgentSelectionProvider value={value}>{children}</ChatAgentSelectionProvider>
		);

		const { result } = renderHook(() => useChatAgentSelection(), { wrapper });

		expect(result.current.agent).toBe("code");
	});

	it("throws when used outside of a ChatAgentSelectionProvider", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		function Consumer() {
			useChatAgentSelection();
			return null;
		}
		try {
			expect(() => render(<Consumer />)).toThrow(
				/useChatAgentSelection requires ChatAgentSelectionProvider/,
			);
		} finally {
			error.mockRestore();
		}
	});
});
