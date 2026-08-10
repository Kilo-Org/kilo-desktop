import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAgentSelection } from "./use-agent-selection.js";

afterEach(() => {
	cleanup();
});

describe("useAgentSelection", () => {
	it("defaults to Code, keeps overrides in memory, and resets to Code", () => {
		const { result } = renderHook(() => useAgentSelection());

		expect(result.current.agent).toBe("code");

		act(() => result.current.setAgent("plan"));
		expect(result.current.agent).toBe("plan");

		act(() => result.current.resetAgent());
		expect(result.current.agent).toBe("code");
	});
});
