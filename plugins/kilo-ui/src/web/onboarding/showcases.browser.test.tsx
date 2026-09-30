import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SignInShowcase } from "./SignInStep.js";
import { WorkspacePreview } from "./WorkspaceStep.js";

afterEach(cleanup);

const folder = (name: string, isPrimary = false) => ({ path: `/Users/me/code/${name}`, isPrimary });

describe("WorkspacePreview", () => {
	it("waits on a dashed 'Add a folder' stand-in until folders are chosen", async () => {
		const { baseElement, container } = render(
			<WorkspacePreview form={{ name: "", color: "#5EA0F7", folders: [] }} />,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Add a folder")).toBeVisible();
		await expect.element(screen.getByText("My workspace")).toBeVisible();
		const wires = [...container.querySelectorAll('[data-qa-id="onboarding-workspace-wires"] path')];
		expect(wires).toHaveLength(2);
		await expect
			.poll(() => wires.map((wire) => getComputedStyle(wire).strokeDasharray))
			.toEqual(wires.map(() => "3px, 4px"));
	});

	it("wires in the chosen folders, primary first, and names the workspace after it", async () => {
		const { baseElement, container } = render(
			<WorkspacePreview
				form={{
					name: "",
					color: "#A78BFA",
					folders: [folder("acme-api"), folder("acme-web", true)],
				}}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("acme-api")).toBeVisible();
		await expect.element(screen.getByText("Add a folder")).not.toBeInTheDocument();
		// The tile label and the first pill both read "acme-web".
		expect(screen.getByText("acme-web").all()).toHaveLength(2);
		const wires = [...container.querySelectorAll('[data-qa-id="onboarding-workspace-wires"] path')];
		expect(wires).toHaveLength(3);
		expect(wires.some((wire) => getComputedStyle(wire).strokeDasharray === "3px, 4px")).toBe(false);
	});
});

describe("SignInShowcase", () => {
	it("starts on one model per lab with no group header", async () => {
		const { baseElement, container } = render(<SignInShowcase />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("500+ models from every major lab")).toBeVisible();
		const names = [...container.querySelectorAll('[data-qa-id="showcase-model-name"]')];
		expect(names.map((name) => name.textContent)).toEqual([
			"Claude",
			"GPT",
			"Gemini",
			"Grok",
			"Mistral",
			"DeepSeek",
		]);
		await expect.element(screen.getByText("Kilo Gateway")).not.toBeInTheDocument();
		await expect.element(screen.getByText("500+ models from every major lab")).toBeVisible();
	});
});
