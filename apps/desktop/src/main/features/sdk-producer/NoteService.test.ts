import { describe, expect, it } from "vitest";

import { NoteService } from "./NoteService.js";

describe("NoteService", () => {
	it("starts empty", () => {
		const svc = new NoteService();
		expect(svc.list()).toEqual([]);
	});

	it("adds a note and returns it", () => {
		const svc = new NoteService();
		const note = svc.add("hello");
		expect(note.text).toBe("hello");
		expect(note.id).toBeDefined();
		expect(note.createdAt).toBeGreaterThan(0);
		expect(svc.list()).toHaveLength(1);
	});

	it("deletes a note by id", () => {
		const svc = new NoteService();
		const note = svc.add("to delete");
		const result = svc.delete(note.id);
		expect(result.deleted).toBe(true);
		expect(svc.list()).toHaveLength(0);
	});

	it("returns deleted: false for unknown id", () => {
		const svc = new NoteService();
		svc.add("existing");
		const result = svc.delete("nonexistent");
		expect(result.deleted).toBe(false);
		expect(svc.list()).toHaveLength(1);
	});

	it("clears all notes", () => {
		const svc = new NoteService();
		svc.add("one");
		svc.add("two");
		svc.add("three");
		const result = svc.clear();
		expect(result.count).toBe(3);
		expect(svc.list()).toHaveLength(0);
	});

	it("echoes a message with prefix and timestamp", () => {
		const svc = new NoteService();
		const result = svc.echo("test");
		expect(result.echoed).toBe("[sdk-producer] test");
		expect(result.timestamp).toBeGreaterThan(0);
	});
});
