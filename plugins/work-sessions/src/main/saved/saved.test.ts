import { describe, expect, it } from "vitest";

import { SavedItems, type AddSavedItemInput } from "../../contracts/model";
import { bootWorkSessions, storageWithWorkspaces } from "../test-boot";

async function boot(storage = storageWithWorkspaces()) {
	let id = 0;
	let clock = 10_000;
	const booted = await bootWorkSessions({
		storage,
		options: { saved: () => ({ createId: () => `saved_${++id}`, now: () => (clock += 1_000) }) },
	});
	const saved = booted.get.get(SavedItems)!;
	const { id: workSessionId } = await booted.workSessions.methods.create({});
	const text = (value: string, anchor = value): AddSavedItemInput => ({
		source: "kilo.chat/chat-text",
		workSessionId,
		ref: { type: "kilo.core/chat", id: "ses_1" },
		title: "Fix login",
		text: value,
		anchor,
	});
	return { ...booted, saved, workSessionId, text };
}

describe("Saved (main)", () => {
	it("adds items newest first and keeps them across restarts", async () => {
		const { saved, text, storage } = await boot();

		await saved.methods.add(text("First passage"));
		await saved.methods.add(text("Second passage"));

		expect(saved.getState().items.map((item) => item.text)).toEqual([
			"Second passage",
			"First passage",
		]);
		expect(saved.getState().addedTotal).toBe(2);
		const restarted = await bootWorkSessions({ storage });
		expect(
			restarted.get
				.get(SavedItems)!
				.getState()
				.items.map((item) => item.text),
		).toEqual(["Second passage", "First passage"]);
	});

	it("answers the saved item for an exact duplicate instead of adding another", async () => {
		const { saved, text } = await boot();

		const first = await saved.methods.add(text("Same", "anchor-1"));
		const again = await saved.methods.add(text("Same", "anchor-1"));
		await saved.methods.add(text("Same", "anchor-2"));

		expect(again.id).toBe(first.id);
		expect(saved.getState().items).toHaveLength(2);
	});

	it("removes an item and restores it with its id and place on Undo", async () => {
		const { saved, text } = await boot();
		const older = await saved.methods.add(text("Older"));
		await saved.methods.add(text("Newer"));
		const events: string[] = [];
		saved.on("removed", ({ item }) => events.push(`removed ${item.text}`));
		saved.on("added", ({ item }) => events.push(`added ${item.text}`));

		const { removed } = await saved.methods.remove({ id: older.id });
		expect(saved.getState().items.map((item) => item.text)).toEqual(["Newer"]);
		await saved.methods.restore({ item: removed! });

		expect(saved.getState().items.map((item) => item.id)).toEqual(["saved_2", older.id]);
		expect(events).toEqual(["removed Older", "added Older"]);
		expect(await saved.methods.remove({ id: "missing" })).toEqual({ removed: null });
		expect(saved.getState().addedTotal).toBe(2);
	});

	it("drops a deleted work session's items", async () => {
		const { saved, text, workSessions, workSessionId } = await boot();
		await saved.methods.add(text("Goes with the session"));

		await workSessions.methods.remove({ id: workSessionId });

		expect(saved.getState().items).toEqual([]);
	});

	it("refuses items for a work session that doesn't exist, and text over the limit", async () => {
		const { saved, text } = await boot();

		await expect(saved.methods.add({ ...text("x"), workSessionId: "gone" })).rejects.toThrow(
			"no longer exists",
		);
		await expect(saved.methods.add(text("x".repeat(10_001)))).rejects.toThrow();
	});

	it("looks items up by id", async () => {
		const { saved, text } = await boot();
		const item = await saved.methods.add(text("Find me"));

		expect(SavedItems.lookup?.(saved.getState(), item.id)).toMatchObject({ text: "Find me" });
	});
});
