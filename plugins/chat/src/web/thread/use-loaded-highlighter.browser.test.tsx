import type { DiffsHighlighter } from "@pierre/diffs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const diffs = vi.hoisted(() => ({
	getHighlighterIfLoaded: vi.fn<() => DiffsHighlighter | undefined>(),
	getSharedHighlighter: vi.fn<() => Promise<DiffsHighlighter>>(),
}));
vi.mock("@pierre/diffs", () => diffs);

const { useLoadedHighlighter } = await import("./use-loaded-highlighter");

const highlighter = { id: "shared" } as unknown as DiffsHighlighter;

function Probe({ code }: { code: string }) {
	const loaded = useLoadedHighlighter("py", "github-dark", code);
	return <span data-testid="probe">{loaded ? "loaded" : "plain"}</span>;
}

beforeEach(() => {
	diffs.getHighlighterIfLoaded.mockReturnValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe("useLoadedHighlighter", () => {
	it("returns the shared highlighter once its own load has it", async () => {
		diffs.getSharedHighlighter.mockImplementation(async () => {
			diffs.getHighlighterIfLoaded.mockReturnValue(highlighter);
			return highlighter;
		});
		const view = render(<Probe code="x = 1" />);
		await vi.waitFor(() => expect(view.getByTestId("probe").textContent).toBe("loaded"));
	});

	it("recovers on a later render after its own load missed", async () => {
		diffs.getSharedHighlighter.mockRejectedValue(new Error("chunk failed"));
		const view = render(<Probe code="x = 1" />);
		await act(async () => {
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(diffs.getSharedHighlighter).toHaveBeenCalled());
		expect(view.getByTestId("probe").textContent).toBe("plain");

		// Another block's load brings the grammar and theme into the shared highlighter.
		diffs.getHighlighterIfLoaded.mockReturnValue(highlighter);
		view.rerender(<Probe code="x = 12" />);

		expect(view.getByTestId("probe").textContent).toBe("loaded");
	});
});
