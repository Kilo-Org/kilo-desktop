import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OPTIMISTIC_AGENT_CATALOG } from "./agent-catalog.js";
import { useAgentSelection } from "./use-agent-selection.js";

afterEach(() => {
	cleanup();
});

describe("useAgentSelection", () => {
	it("defaults to Code, keeps overrides in memory, and resets to Code", () => {
		const { result } = renderHook(() => useAgentSelection(undefined));

		expect(result.current.agent).toBe("code");

		act(() => result.current.setAgent("plan"));
		expect(result.current.agent).toBe("plan");

		act(() => result.current.resetAgent());
		expect(result.current.agent).toBe("code");
	});

	it("updates the dispatch getter synchronously", () => {
		const { result } = renderHook(() => useAgentSelection(undefined));
		let dispatchedAgent: string | undefined;

		act(() => {
			result.current.setAgent("plan");
			dispatchedAgent = result.current.getAgent();
		});

		expect(dispatchedAgent).toBe("plan");
		expect(result.current.agent).toBe("plan");
	});

	it("reconciles an optimistic choice against the resolved catalog", () => {
		type Props = { resolved: boolean };
		const { result, rerender } = renderHook(
			({ resolved }: Props) =>
				useAgentSelection(
					resolved
						? {
								agents: OPTIMISTIC_AGENT_CATALOG.agents.filter((entry) => entry.name === "plan"),
							}
						: undefined,
				),
			{ initialProps: { resolved: false } },
		);

		act(() => result.current.setAgent("debug"));
		expect(result.current.agent).toBe("debug");

		rerender({ resolved: true });
		expect(result.current.agent).toBe("plan");
	});
});
