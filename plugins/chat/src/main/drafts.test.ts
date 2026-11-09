import { describe, expect, it } from "vitest";

import { ComposerDrafts } from "../contracts";
import { bootChatMain } from "./test-helpers";

describe("composer drafts", () => {
	it("keeps each agent pane's unsent text apart from the session's own", async () => {
		const { asChat } = await bootChatMain();
		const drafts = asChat.drafts;

		await drafts.methods.set({ sessionId: "wses_1", text: "Install this skill" });
		await drafts.methods.set({ sessionId: "wses_1", paneId: "pane_a", text: "First" });
		await drafts.methods.set({ sessionId: "wses_1", paneId: "pane_b", text: "Second" });

		expect(drafts.getState().drafts).toEqual({
			wses_1: { text: "Install this skill", panes: { pane_a: "First", pane_b: "Second" } },
		});
	});

	it("drops a pane's text once it is empty, and the session once nothing is left", async () => {
		const { asChat } = await bootChatMain();
		const drafts = asChat.drafts;
		await drafts.methods.set({ sessionId: "wses_1", paneId: "pane_a", text: "First" });
		await drafts.methods.set({ sessionId: "wses_1", paneId: "pane_b", text: "Second" });

		await drafts.methods.set({ sessionId: "wses_1", paneId: "pane_a", text: "" });
		expect(drafts.getState().drafts).toEqual({ wses_1: { text: "", panes: { pane_b: "Second" } } });

		await drafts.methods.set({ sessionId: "wses_1", paneId: "pane_b", text: "" });
		expect(drafts.getState().drafts).toEqual({});
	});

	it("is kept by kilo.chat alone", async () => {
		const { kernel } = await bootChatMain();
		const drafts = kernel.sdkFor("kilo.account").domains.get(ComposerDrafts)!;

		await expect(drafts.methods.set({ sessionId: "wses_1", text: "Hi" })).rejects.toThrow(
			"Only kilo.chat keeps composer drafts.",
		);
	});
});
