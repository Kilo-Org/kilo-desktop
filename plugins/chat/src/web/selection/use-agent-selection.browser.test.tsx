import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OPTIMISTIC_AGENT_CATALOG } from "./agent-catalog";
import { useAgentSelection } from "./use-agent-selection";

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("useAgentSelection", () => {
	it("defaults to Code, keeps overrides in memory, and resets to Code", () => {
		const { result } = renderHook(() => useAgentSelection(undefined));

		expect(result.current.agent).toBe("code");

		act(() => result.current.setAgent("plan"));
		expect(result.current.agent).toBe("plan");
		expect(localStorage.length).toBe(0);

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

	it("restores the selected agent when returning to a chat", () => {
		const { result, rerender } = renderHook(
			({ threadId }: { threadId: string }) => useAgentSelection(undefined, threadId),
			{ initialProps: { threadId: "thread-a" } },
		);

		act(() => result.current.setAgent("plan"));
		rerender({ threadId: "thread-b" });
		expect(result.current.agent).toBe("code");

		rerender({ threadId: "thread-a" });
		expect(result.current.agent).toBe("plan");
	});

	it("hydrates from Kilo while preserving an unsent local override", () => {
		const { result } = renderHook(() => useAgentSelection(undefined, "thread-a"));

		act(() => result.current.hydrateThreadAgent("thread-a", "plan"));
		expect(result.current.agent).toBe("plan");

		act(() => result.current.setAgent("debug"));
		act(() => result.current.hydrateThreadAgent("thread-a", "code"));
		expect(result.current.agent).toBe("debug");
	});

	it("promotes a draft selection when Kilo creates its session", () => {
		const { result, rerender } = renderHook(
			({ threadId }: { threadId: string | undefined }) => useAgentSelection(undefined, threadId),
			{ initialProps: { threadId: undefined as string | undefined } },
		);

		act(() => result.current.setAgent("plan"));
		act(() => result.current.promoteDraftAgent("thread-new"));
		rerender({ threadId: "thread-new" });

		expect(result.current.agent).toBe("plan");
	});

	it("hydrates a promoted reset draft from the Kilo session", () => {
		const { result, rerender } = renderHook(
			({ threadId }: { threadId: string | undefined }) => useAgentSelection(undefined, threadId),
			{ initialProps: { threadId: undefined as string | undefined } },
		);

		act(() => result.current.resetDraftAgent());
		act(() => result.current.promoteDraftAgent("thread-new"));
		rerender({ threadId: "thread-new" });
		act(() => result.current.hydrateThreadAgent("thread-new", "plan"));

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
