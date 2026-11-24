import { describe, expect, it } from "vitest";

import { WorkSessions } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Drafts } from "../../contracts";
import { workSession } from "../../test/fake-work-sessions";
import { bootChatMain, settle } from "../test-boot";

describe("composer drafts", () => {
	it("keeps each agent pane's unsent text apart from the work session's own", async () => {
		const { chatSdk } = await bootChatMain();
		const drafts = chatSdk.domainObjects.get(Drafts)!;

		await drafts.methods.setText({ workSessionId: "wses_1", text: "Install this skill" });
		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_a", text: "First" });
		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_b", text: "Second" });

		expect(drafts.getState().drafts).toEqual({
			wses_1: { text: "Install this skill", panes: { pane_a: "First", pane_b: "Second" } },
		});
		expect(drafts.lookup("wses_1")).toMatchObject({ text: "Install this skill" });
	});

	it("drops a pane's text once it is empty, and the work session once nothing is left", async () => {
		const { chatSdk } = await bootChatMain();
		const drafts = chatSdk.domainObjects.get(Drafts)!;
		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_a", text: "First" });
		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_b", text: "Second" });

		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_a", text: "" });
		expect(drafts.getState().drafts).toEqual({ wses_1: { text: "", panes: { pane_b: "Second" } } });

		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_b", text: "" });
		await drafts.methods.setText({ workSessionId: "wses_1", paneId: "pane_b", text: "" });
		expect(drafts.getState().drafts).toEqual({});
	});

	it("forgets a removed work session's drafts", async () => {
		const { chatSdk, kernel } = await bootChatMain({
			workSessions: { workSessions: [workSession(), workSession({ id: "wses_2" })] },
		});
		const drafts = chatSdk.domainObjects.get(Drafts)!;
		await drafts.methods.setText({ workSessionId: "wses_1", text: "Keep" });
		await drafts.methods.setText({ workSessionId: "wses_2", text: "Drop" });

		await kernel.kernelSdk.domainObjects
			.get(WorkSessions)!
			.methods.remove({ id: "wses_2", removeCopy: false });
		await settle();

		expect(drafts.getState().drafts).toEqual({ wses_1: { text: "Keep" } });
	});

	it("is kept by kilo.chat alone", async () => {
		const { as } = await bootChatMain();
		const drafts = as("kilo.core").get(Drafts)!;

		await expect(drafts.methods.setText({ workSessionId: "wses_1", text: "Hi" })).rejects.toThrow(
			"Only kilo.chat keeps composer drafts.",
		);
	});
});
