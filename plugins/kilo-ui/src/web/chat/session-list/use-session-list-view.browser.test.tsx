import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
	DEFAULT_SESSION_LIST_VIEW,
	SESSION_LIST_PINS_STORAGE_KEY,
	SESSION_LIST_VIEW_STORAGE_KEY,
	readSessionListPins,
	readSessionListView,
} from "./session-list-view.js";
import {
	SessionListViewProvider,
	useSessionListPins,
	useSessionListView,
} from "./use-session-list-view.js";

afterEach(() => {
	cleanup();
	localStorage.removeItem(SESSION_LIST_VIEW_STORAGE_KEY);
	localStorage.removeItem(SESSION_LIST_PINS_STORAGE_KEY);
});

describe("useSessionListView", () => {
	it("composes sequential patches and persists the merged view", () => {
		const { result } = renderHook(() => useSessionListView(), {
			wrapper: SessionListViewProvider,
		});

		act(() => {
			result.current.update({ grouping: "workspace" });
			result.current.update({ ordering: "title" });
		});

		expect(result.current.view).toEqual({
			...DEFAULT_SESSION_LIST_VIEW,
			grouping: "workspace",
			ordering: "title",
		});
		expect(readSessionListView()).toEqual(result.current.view);
	});

	it("persists the default view on reset", () => {
		const { result } = renderHook(() => useSessionListView(), {
			wrapper: SessionListViewProvider,
		});

		act(() => {
			result.current.update({ grouping: "updated", status: "working" });
		});
		act(() => {
			result.current.reset();
		});

		expect(result.current.view).toEqual(DEFAULT_SESSION_LIST_VIEW);
		expect(readSessionListView()).toEqual(DEFAULT_SESSION_LIST_VIEW);
	});
});

describe("useSessionListPins", () => {
	it("composes sequential toggles and persists the result", () => {
		const { result } = renderHook(() => useSessionListPins(), {
			wrapper: SessionListViewProvider,
		});

		act(() => {
			result.current.toggle("ses-1");
			result.current.toggle("ses-1");
			result.current.toggle("ses-2");
		});

		expect(result.current.ids).toEqual(["ses-2"]);
		expect(readSessionListPins()).toEqual(["ses-2"]);
	});
});
