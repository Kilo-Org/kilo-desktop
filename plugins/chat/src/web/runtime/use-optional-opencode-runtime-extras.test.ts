import { describe, expect, it, vi } from "vitest";

import {
	useOlderHistoryStatus,
	useOptionalOpenCodeRuntimeExtras,
} from "./use-optional-opencode-runtime-extras";

const useAuiState = vi.hoisted(() => vi.fn());

vi.mock("@assistant-ui/react", () => ({
	useAuiState: (selector: (state: { thread: { extras: unknown } }) => unknown) =>
		useAuiState(selector),
}));

describe("useOptionalOpenCodeRuntimeExtras", () => {
	it("returns undefined when thread extras are missing", () => {
		useAuiState.mockImplementation((selector) => selector({ thread: { extras: undefined } }));

		expect(useOptionalOpenCodeRuntimeExtras()).toBeUndefined();
	});

	it("returns extras when reply helpers are present", () => {
		const extras = extrasWith({});
		useAuiState.mockImplementation((selector) => selector({ thread: { extras } }));

		expect(useOptionalOpenCodeRuntimeExtras()).toBe(extras);
	});
});

describe("useOlderHistoryStatus", () => {
	it.each([
		[undefined, "complete"],
		[{ type: "complete" }, "complete"],
		[{ type: "available", cursor: "c" }, "loading"],
		[{ type: "loading", cursor: "c" }, "loading"],
		[{ type: "failed", cursor: "c", error: new Error("x") }, "failed"],
	])("reports %o as %s", (olderHistory, status) => {
		const extras = extrasWith({ olderHistory });
		useAuiState.mockImplementation((selector) => selector({ thread: { extras } }));

		expect(useOlderHistoryStatus()).toBe(status);
	});
});

function extrasWith(state: object) {
	return {
		replyToQuestion: vi.fn(),
		rejectQuestion: vi.fn(),
		replyToPermission: vi.fn(),
		session: null,
		state,
		permissions: {},
		questions: {},
		fork: vi.fn(),
		revert: vi.fn(),
		unrevert: vi.fn(),
		cancel: vi.fn(),
		refresh: vi.fn(),
	};
}
