import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SessionActivityProvider, useSessionActivity } from "./SessionActivityProvider.js";
import { createSessionActivityStore } from "./session-activity-store.js";

describe("SessionActivityProvider", () => {
	it("exposes store state to consumers", () => {
		const store = createSessionActivityStore({ storage: null });
		store.getState().setOpenSession("ses-1");

		const wrapper = ({ children }: { children: ReactNode }) => (
			<SessionActivityProvider store={store}>{children}</SessionActivityProvider>
		);

		const { result } = renderHook(() => useSessionActivity((state) => state.openSessionId), {
			wrapper,
		});

		expect(result.current).toBe("ses-1");
	});

	it("throws when used outside the provider", () => {
		expect(() => renderHook(() => useSessionActivity((state) => state.openSessionId))).toThrow(
			"useSessionActivity requires SessionActivityProvider",
		);
	});
});
