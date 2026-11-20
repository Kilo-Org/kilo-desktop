import { afterEach, describe, expect, it } from "vitest";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { Workbooks } from "../contracts";
import { bootWorkbooks } from "../test/hosts";
import { nextStep, openQuestions, planSteps, whereILeftOff } from "./progress";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

describe("progress", () => {
	it("reads plan steps and their status from the Plan's markdown", () => {
		const steps = planSteps(
			[
				"- [x] **1. Template**: write it · done: ok (abc)",
				"- [ ] **2. Skeleton**: build · in progress",
				"- [ ] **3. Store**: keep · blocked: waiting",
				"- [ ] **4. UI**: draw",
				"- [ ] not a step",
			].join("\n"),
		);

		expect(steps).toEqual([
			{ number: 1, title: "Template", status: "done" },
			{ number: 2, title: "Skeleton", status: "in_progress" },
			{ number: 3, title: "Store", status: "blocked" },
			{ number: 4, title: "UI", status: "todo" },
		]);
		expect(nextStep(steps)?.number).toBe(2);
		expect(nextStep(steps.filter((step) => step.status !== "in_progress"))?.number).toBe(4);
		expect(nextStep([])).toBeUndefined();
	});

	it("reads Where I left off and counts open questions", () => {
		expect(
			whereILeftOff("## Where I left off\n\n_by whoever_\n\n- Nothing yet.\n\n## Goal\n\n- x"),
		).toEqual([]);
		expect(whereILeftOff("## Where I left off\n\n- 2026-01-01: did A\n- next B")).toEqual([
			"2026-01-01: did A",
			"next B",
		]);
		expect(whereILeftOff("No section")).toEqual([]);
		expect(openQuestions("- **Windows?** maybe\n- **Done.** no\ntext")).toBe(1);
	});

	it("summarises a workbook from Pages", async () => {
		const { host } = await bootWorkbooks();
		hosts.push(host);
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "W",
			values: { goal: "g" },
		});

		await expect(host.invoke(Workbooks, "progress", { workbookId: workbook.id })).resolves.toEqual({
			whereILeftOff: [],
			steps: [{ number: 1, title: "Refine the Brief and draft this Plan", status: "todo" }],
			next: { number: 1, title: "Refine the Brief and draft this Plan" },
			openTasks: 3,
			openQuestions: 0,
			openReview: 0,
		});
	});
});
