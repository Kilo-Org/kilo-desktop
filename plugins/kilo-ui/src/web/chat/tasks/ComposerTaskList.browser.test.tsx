import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { TaskStatus } from "../components/assistant-ui/elements/task-list.js";

const projection = vi.hoisted(() => ({
	current: undefined as
		| {
				items?: { id: string; text: string; status: TaskStatus }[];
		  }
		| undefined,
	defaultValue: {
		items: [
			{ id: "task-0", text: "Read the code", status: "done" as TaskStatus },
			{ id: "task-1", text: "Add the list", status: "active" as TaskStatus },
		],
	},
}));

vi.mock("./use-task-thread-projection.js", () => ({
	useTaskThreadProjection: () => projection.current,
}));

import { ComposerTaskList } from "./ComposerTaskList.js";

afterEach(cleanup);

beforeEach(() => {
	projection.current = projection.defaultValue;
});

describe("ComposerTaskList", () => {
	it("stays hidden when task state is unavailable", () => {
		projection.current = {};
		const { baseElement } = render(<ComposerTaskList />);

		expect(baseElement.querySelector('[data-qa-id="kilo-composer-tasks"]')).toBeNull();
	});

	it("shows the latest working list expanded without a revision", async () => {
		const { baseElement } = render(<ComposerTaskList />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-composer-tasks")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-composer-tasks-toggle"))
			.toHaveAttribute("aria-expanded", "true");
		await expect.element(screen.getByText("Read the code")).toBeVisible();
		await expect.element(screen.getByText("Add the list")).toBeVisible();
		await expect.element(screen.getByText("1/2 Completed")).toBeVisible();
		expect(baseElement.textContent).not.toContain("rev");
	});

	it("collapses and expands the task rows", async () => {
		const { baseElement } = render(<ComposerTaskList />);
		const screen = page.elementLocator(baseElement);
		const toggle = screen.getByTestId("kilo-composer-tasks-toggle");

		await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
		await expect
			.element(screen.getByTestId("kilo-composer-tasks-active"))
			.toHaveTextContent("Add the list");

		await toggle.click();
		await expect.element(screen.getByTestId("kilo-composer-tasks-active")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Add the list")).toBeVisible();

		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
	});

	it("hides the list after all work has settled", () => {
		projection.current = {
			items: [
				{ id: "task-0", text: "Read the code", status: "done" },
				{ id: "task-1", text: "Skipped", status: "cancelled" },
			],
		};
		const { baseElement } = render(<ComposerTaskList />);

		expect(baseElement.querySelector('[data-qa-id="kilo-composer-tasks"]')).toBeNull();
	});
});
