import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KiloSkillConfig } from "./KiloSkillConfig.js";

describe("KiloSkillConfig", () => {
	let tempDirectory: string;
	let skillDirectory: string;
	let review: string;
	let other: string;

	async function skillFolder(name: string): Promise<string> {
		const folder = path.join(tempDirectory, "plugins", name);
		await mkdir(folder, { recursive: true });
		await writeFile(path.join(folder, "SKILL.md"), `---\nname: ${name}\n---\nDo ${name}.\n`);
		return folder;
	}

	const linkTarget = async (id: string) =>
		path.resolve(skillDirectory, await readlink(path.join(skillDirectory, id)));

	beforeEach(async () => {
		tempDirectory = await mkdtemp(path.join(tmpdir(), "kilo-skill-config-"));
		skillDirectory = path.join(tempDirectory, "config", "kilo", "skills");
		review = await skillFolder("review");
		other = await skillFolder("other");
	});

	afterEach(async () => {
		await rm(tempDirectory, { recursive: true, force: true });
	});

	it("links a skill folder under its id, so Kilo finds its SKILL.md", async () => {
		const config = new KiloSkillConfig(skillDirectory);

		await expect(config.install("acme.tools", "review", review)).resolves.toEqual({
			kind: "written",
			reason: "created",
		});

		expect((await lstat(path.join(skillDirectory, "review"))).isSymbolicLink()).toBe(true);
		await expect(
			readFile(path.join(skillDirectory, "review", "SKILL.md"), "utf8"),
		).resolves.toContain("Do review.");
		await expect(config.install("acme.tools", "review", review)).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});
	});

	it("repoints its own link when the skill moves, and removes it", async () => {
		const config = new KiloSkillConfig(skillDirectory);
		await config.install("acme.tools", "review", review);

		await expect(config.install("acme.tools", "review", other)).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		expect(await linkTarget("review")).toBe(other);

		await expect(config.remove("acme.tools", "review")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		await expect(lstat(path.join(skillDirectory, "review"))).rejects.toThrow(/ENOENT/);
		await expect(readFile(path.join(review, "SKILL.md"), "utf8")).resolves.toContain("Do review.");
		await expect(config.listOwnedSkillIds("acme.tools")).resolves.toEqual([]);
	});

	it("lists only the skills a source owns", async () => {
		const config = new KiloSkillConfig(skillDirectory);
		await config.install("acme.tools", "review", review);
		await config.install("acme.other", "other", other);

		await expect(config.listOwnedSkillIds("acme.tools")).resolves.toEqual(["review"]);
		await expect(config.listOwnedSkillIds("acme.other")).resolves.toEqual(["other"]);
	});

	it("never touches a skill another source owns", async () => {
		const config = new KiloSkillConfig(skillDirectory);
		await config.install("acme.tools", "review", review);

		await expect(config.install("acme.other", "review", other)).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		await expect(config.remove("acme.other", "review")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		expect(await linkTarget("review")).toBe(review);
	});

	it("never touches a skill the user put there, even one it once owned", async () => {
		await mkdir(path.join(skillDirectory, "mine"), { recursive: true });
		await writeFile(path.join(skillDirectory, "mine", "SKILL.md"), "user skill\n");
		const config = new KiloSkillConfig(skillDirectory);

		await expect(config.install("acme.tools", "mine", review)).resolves.toEqual({
			kind: "skipped",
			reason: "not-owned",
		});

		await config.install("acme.tools", "review", review);
		await rm(path.join(skillDirectory, "review"));
		await symlink(other, path.join(skillDirectory, "review"), "dir");
		await expect(config.install("acme.tools", "review", review)).resolves.toEqual({
			kind: "skipped",
			reason: "not-owned",
		});
		await expect(config.remove("acme.tools", "review")).resolves.toEqual({
			kind: "skipped",
			reason: "not-owned",
		});
		await expect(config.listOwnedSkillIds("acme.tools")).resolves.toEqual([]);
		expect(await linkTarget("review")).toBe(other);
		await expect(readFile(path.join(skillDirectory, "mine", "SKILL.md"), "utf8")).resolves.toBe(
			"user skill\n",
		);
	});

	it("forgets a link that is already gone", async () => {
		const config = new KiloSkillConfig(skillDirectory);
		await config.install("acme.tools", "review", review);
		await rm(path.join(skillDirectory, "review"));

		await expect(config.remove("acme.tools", "review")).resolves.toEqual({
			kind: "skipped",
			reason: "nothing-to-remove",
		});
		await expect(config.listOwnedSkillIds("acme.tools")).resolves.toEqual([]);
		await expect(config.install("acme.tools", "review", review)).resolves.toEqual({
			kind: "written",
			reason: "created",
		});
	});

	it("refuses an unsafe id, a relative path or a folder without SKILL.md", async () => {
		const config = new KiloSkillConfig(skillDirectory);
		await mkdir(path.join(tempDirectory, "empty"));

		await expect(config.install("acme.tools", "../escape", review)).resolves.toMatchObject({
			kind: "skipped-error",
		});
		await expect(config.install("acme.tools", "review", "plugins/review")).resolves.toEqual({
			kind: "skipped-error",
			reason: "skill path must be absolute",
		});
		await expect(
			config.install("acme.tools", "empty", path.join(tempDirectory, "empty")),
		).resolves.toEqual({ kind: "skipped-error", reason: "skill folder has no SKILL.md" });
		await expect(lstat(skillDirectory)).rejects.toThrow(/ENOENT/);
	});

	it("treats an unreadable ownership record as owning nothing", async () => {
		const config = new KiloSkillConfig(skillDirectory);
		await config.install("acme.tools", "review", review);
		await writeFile(path.join(skillDirectory, ".kilo-desktop-ownership.json"), "{not json");

		await expect(config.listOwnedSkillIds("acme.tools")).resolves.toEqual([]);
		await expect(config.remove("acme.tools", "review")).resolves.toEqual({
			kind: "skipped",
			reason: "not-owned",
		});
	});
});
