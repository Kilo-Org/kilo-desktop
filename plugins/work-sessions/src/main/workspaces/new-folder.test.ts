import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newFolderPath, withNewFolders } from "./new-folder";

let parent: string;
let existing: string;

beforeEach(() => {
	parent = realpathSync.native(mkdtempSync(path.join(tmpdir(), "kilo-new-folder-")));
	existing = path.join(parent, "existing");
	mkdirSync(existing);
});

afterEach(() => {
	rmSync(parent, { recursive: true, force: true });
});

describe("withNewFolders", () => {
	it("passes the folders through when none need making", () => {
		const save = vi.fn((folders: unknown) => folders);
		const folders = [{ path: existing, isPrimary: true }];

		withNewFolders(folders, [], save);

		expect(save).toHaveBeenCalledWith(folders);
	});

	it("makes each requested folder empty and saves it alongside existing folders", () => {
		const save = vi.fn((folders: unknown) => folders);
		const fresh = path.join(parent, "Fresh");

		withNewFolders(
			[
				{ path: fresh, isPrimary: true },
				{ path: existing, isPrimary: false },
			],
			[fresh],
			save,
		);

		expect(readdirSync(fresh)).toEqual([]);
		expect(save).toHaveBeenCalledWith([
			{ path: fresh, isPrimary: true },
			{ path: existing, isPrimary: false },
		]);
	});

	it("removes the folders it made when the workspace can't be saved", () => {
		const first = path.join(parent, "first");
		const second = path.join(parent, "second");

		expect(() =>
			withNewFolders(
				[
					{ path: first, isPrimary: true },
					{ path: second, isPrimary: false },
				],
				[first, second],
				() => {
					throw new Error("disk full");
				},
			),
		).toThrow("disk full");
		expect(existsSync(first)).toBe(false);
		expect(existsSync(second)).toBe(false);
	});

	it("removes earlier folders when a later one already exists", () => {
		const fresh = path.join(parent, "fresh");

		expect(() =>
			withNewFolders(
				[
					{ path: fresh, isPrimary: true },
					{ path: existing, isPrimary: false },
				],
				[fresh, existing],
				vi.fn(),
			),
		).toThrow(
			expect.objectContaining({
				code: "VALIDATION",
				message: 'A folder named "existing" already exists in that location.',
			}),
		);
		expect(existsSync(fresh)).toBe(false);
	});

	it.each([".", "..", "nul\0byte"])(
		"refuses %j as a folder name without touching the disk",
		(name) => {
			const requested = path.join(parent, name);

			expect(() =>
				withNewFolders([{ path: requested, isPrimary: true }], [requested], vi.fn()),
			).toThrow(expect.objectContaining({ code: "VALIDATION" }));
			expect(readdirSync(parent)).toEqual(["existing"]);
		},
	);

	it("refuses a new folder whose location is missing or relative", () => {
		for (const requested of [path.join(parent, "missing", "Fresh"), "relative/Fresh"]) {
			expect(() =>
				withNewFolders([{ path: requested, isPrimary: true }], [requested], vi.fn()),
			).toThrow(
				expect.objectContaining({
					code: "VALIDATION",
					message: "Choose an existing folder location.",
				}),
			);
		}
	});

	it("refuses a new folder that isn't one of the workspace's folders", () => {
		const stray = path.join(parent, "stray");

		expect(() => withNewFolders([{ path: existing, isPrimary: true }], [stray], vi.fn())).toThrow(
			expect.objectContaining({ code: "VALIDATION" }),
		);
		expect(existsSync(stray)).toBe(false);
	});
});

describe("newFolderPath", () => {
	it("joins a trimmed name onto the resolved location", () => {
		expect(newFolderPath(parent, " App ")).toBe(path.join(parent, "App"));
	});

	it("refuses a name that's taken, unusable or escapes the location", () => {
		expect(() => newFolderPath(parent, "existing")).toThrow(
			'A folder named "existing" already exists in that location.',
		);
		expect(() => newFolderPath(parent, "../escape")).toThrow(
			expect.objectContaining({ code: "VALIDATION" }),
		);
		expect(() => newFolderPath(path.join(parent, "missing"), "app")).toThrow(
			"Choose an existing folder location.",
		);
	});
});
