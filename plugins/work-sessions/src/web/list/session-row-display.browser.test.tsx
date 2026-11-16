import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SessionRelativeTime, SessionRowGlyph } from "./session-row-display";

afterEach(cleanup);

describe("session row glyph", () => {
	it("names each state for assistive tech", async () => {
		render(
			<>
				<SessionRowGlyph rowState="approval" isActive={false} workingSince={undefined} />
				<SessionRowGlyph rowState="input" isActive={false} workingSince={undefined} />
				<SessionRowGlyph rowState="working" isActive={false} workingSince={Date.now()} />
				<SessionRowGlyph rowState="done" isActive workingSince={undefined} />
			</>,
		);

		for (const label of ["Requires approval", "Requires input", "Working", "Unread"]) {
			await expect.element(page.getByRole("status", { name: label })).toBeVisible();
		}
		await expect.element(page.getByTestId("session-list-done-dot")).toBeVisible();
	});

	it("tells how long a session has been working", async () => {
		render(<SessionRowGlyph rowState="working" isActive workingSince={Date.now() - 90_000} />);

		await page.getByRole("status", { name: "Working" }).hover();

		await expect.element(page.getByText("Working · 1m")).toBeVisible();
	});

	it("draws only the icon where the state is already written out", async () => {
		const { container } = render(
			<SessionRowGlyph rowState="input" isActive={false} workingSince={undefined} decorative />,
		);

		expect(container.querySelector("[role=status]")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});

	it("renders nothing without a state", () => {
		const { container } = render(
			<SessionRowGlyph rowState={null} isActive={false} workingSince={undefined} />,
		);

		expect(container.innerHTML).toBe("");
	});

	it("shows a relative time", async () => {
		render(<SessionRelativeTime timestamp={Date.now() - 3 * 3_600_000} />);

		await expect.element(page.getByText("3h")).toBeVisible();
	});
});
