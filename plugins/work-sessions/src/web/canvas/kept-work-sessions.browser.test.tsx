import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PaneProps } from "../../contracts";
import { pane, paneKindPlugin, panesOf, renderWorkSessions, workSession } from "../../testing";

/** A pane with state a remount would lose. */
function CounterPane({ workSessionId }: PaneProps) {
	const [count, setCount] = useState(0);
	const [mounted] = useState(() => crypto.randomUUID());
	return (
		<button
			type="button"
			data-qa-id={`counter-${workSessionId}`}
			data-mount={mounted}
			onClick={() => setCount(count + 1)}
		>
			{workSessionId} {count}
		</button>
	);
}

const counter = paneKindPlugin("acme.counter", [
	{ id: "counter", metadata: { title: "Counter" }, component: CounterPane },
]);

async function renderTwoSessions() {
	const rendered = await renderWorkSessions({
		workSessions: [workSession("a"), workSession("b")],
		panes: {
			a: panesOf([pane("pa", "acme.counter/counter")]),
			b: panesOf([pane("pb", "acme.counter/counter")]),
		},
		open: "a",
		guests: [counter],
	});
	await expect.element(page.getByTestId("counter-a")).toBeVisible();
	return rendered;
}

describe("kept work sessions", () => {
	it("shows a work session changed back to as it was left, without building its panes again", async () => {
		const { window } = await renderTwoSessions();
		await page.getByTestId("counter-a").click();
		await page.getByTestId("counter-a").click();
		const mount = page.getByTestId("counter-a").element().getAttribute("data-mount");

		await window().methods.openWorkSession({ workSessionId: "b" });
		await expect.element(page.getByTestId("counter-b")).toBeVisible();
		// Hidden: out of the page, or there but not shown.
		await expect
			.poll(
				() =>
					document.querySelector<HTMLElement>('[data-qa-id="counter-a"]')?.checkVisibility() ??
					false,
			)
			.toBe(false);
		await window().methods.openWorkSession({ workSessionId: "a" });

		await expect.element(page.getByTestId("counter-a")).toHaveTextContent("a 2");
		expect(page.getByTestId("counter-a").element().getAttribute("data-mount")).toBe(mount);
	});

	it("keeps iframe documents alive when switching to another work session and back", async () => {
		const frameLoaded = vi.fn();
		function FramePane({ workSessionId }: PaneProps) {
			return (
				<iframe
					data-qa-id={`frame-${workSessionId}`}
					title={`Frame ${workSessionId}`}
					srcDoc='<input aria-label="Note" value="Initial">'
					onLoad={workSessionId === "a" ? frameLoaded : undefined}
				/>
			);
		}
		const framed = paneKindPlugin("acme.frame", [
			{ id: "frame", metadata: { title: "Frame" }, component: FramePane },
		]);
		const { window } = await renderWorkSessions({
			workSessions: [workSession("a"), workSession("b")],
			panes: {
				a: panesOf([pane("pa", "acme.frame/frame")]),
				b: panesOf([pane("pb", "acme.frame/frame")]),
			},
			open: "a",
			guests: [framed],
		});

		await expect.element(page.getByTestId("frame-a")).toBeVisible();
		await vi.waitFor(() => expect(frameLoaded).toHaveBeenCalledTimes(1));
		const frame = document.querySelector<HTMLIFrameElement>('[data-qa-id="frame-a"]')!;
		const frameDocument = frame.contentDocument!;
		frameDocument.querySelector("input")!.value = "Keep this across switch";

		await window().methods.openWorkSession({ workSessionId: "b" });
		await expect.element(page.getByTestId("frame-b")).toBeVisible();
		expect(frame.isConnected).toBe(true);

		await window().methods.openWorkSession({ workSessionId: "a" });
		await expect.element(page.getByTestId("frame-a")).toBeVisible();

		expect(document.querySelector('[data-qa-id="frame-a"]')).toBe(frame);
		expect(frame.contentDocument).toBe(frameDocument);
		expect(frameDocument.querySelector("input")).toHaveValue("Keep this across switch");
		expect(frameLoaded).toHaveBeenCalledTimes(1);
	});

	it("lets a closed work session go", async () => {
		const { window } = await renderTwoSessions();

		await window().methods.closeWorkSession(undefined);

		await expect.element(page.getByTestId("session-workbench")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("counter-a")).not.toBeInTheDocument();
	});
});
