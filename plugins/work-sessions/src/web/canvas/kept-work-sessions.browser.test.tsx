import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { PaneProps } from "../../contracts";
import { pane, paneKindPlugin, panesOf, renderWorkSessions, workSession } from "../../testing";

let mounts = 0;

/** A pane with state a remount would lose. */
function CounterPane({ workSessionId }: PaneProps) {
	const [count, setCount] = useState(0);
	const [mounted] = useState(() => ++mounts);
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

	it("lets a closed work session go", async () => {
		const { window } = await renderTwoSessions();

		await window().methods.closeWorkSession(undefined);

		await expect.element(page.getByTestId("session-workbench")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("counter-a")).not.toBeInTheDocument();
	});
});
