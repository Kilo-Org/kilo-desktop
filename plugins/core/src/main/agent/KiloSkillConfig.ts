import { lstat, mkdir, readFile, readlink, rmdir, stat, symlink, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";

export type KiloSkillMutationOutcome =
	| { readonly kind: "written"; readonly reason: "created" | "updated" }
	| { readonly kind: "removed"; readonly reason: "explicit" }
	| {
			readonly kind: "skipped";
			readonly reason: "up-to-date" | "nothing-to-remove" | "not-owned" | "owned-by-other-source";
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

/** The folder of an app-owned Kilo config directory Kilo discovers skills in (`skills/**\/SKILL.md`). */
export function kiloSkillDirectory(configDirectory: string): string {
	return path.join(configDirectory, "skills");
}

const OWNERSHIP_FILENAME = ".kilo-desktop-ownership.json";
const OWNERSHIP_VERSION = 1;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

interface OwnedLink {
	readonly sourceId: string;
	readonly target: string;
}

type Ownership = Readonly<Record<string, OwnedLink>>;

function validateId(label: string, value: string): string | undefined {
	return SAFE_ID.test(value) ? undefined : `${label} must be a lowercase filesystem-safe id`;
}

function isOwnedLink(value: unknown): value is OwnedLink {
	const record = value as Partial<OwnedLink> | null;
	return typeof record?.sourceId === "string" && typeof record.target === "string";
}

/** Windows reports a junction's target in its `\\?\` long form. */
function normalizedTarget(target: string): string {
	return path.resolve(target.replace(/^\\\\\?\\/, ""));
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Owns the skills Desktop links into the app-owned Kilo config directory's
 * `skills/` folder, where Kilo finds `SKILL.md` files (following links).
 * Each skill is a link named after its contribution id pointing at the
 * contributing plugin's folder: a junction on Windows, which needs no admin
 * rights, a directory symlink elsewhere. Skills are folders that other files
 * in them refer to, so they are linked rather than copied.
 *
 * Ownership lives in a sidecar beside the links, recording each link's source
 * and target. A link is Desktop's only while it is still the link the sidecar
 * recorded: anything else under that name (a folder or link the user made,
 * even over one Desktop once owned) is never updated or removed, and removing
 * it only forgets Desktop's record. The record
 * is written before its link and dropped after it, so a crash leaves at worst
 * a record for a missing link, which the next install or remove settles. An
 * unreadable sidecar means Desktop owns nothing. Mutations are serialized.
 */
export class KiloSkillConfig {
	readonly #skillDirectory: string;
	readonly #ownershipFile: string;
	#pending: Promise<void> = Promise.resolve();

	constructor(skillDirectory: string) {
		this.#skillDirectory = skillDirectory;
		this.#ownershipFile = path.join(skillDirectory, OWNERSHIP_FILENAME);
	}

	install(sourceId: string, skillId: string, folder: string): Promise<KiloSkillMutationOutcome> {
		return this.#enqueue(async () => {
			const invalid = validateId("source id", sourceId) ?? validateId("skill id", skillId);
			if (invalid) return { kind: "skipped-error", reason: invalid };
			if (!path.isAbsolute(folder)) {
				return { kind: "skipped-error", reason: "skill path must be absolute" };
			}
			if (!(await stat(path.join(folder, "SKILL.md")).catch(() => undefined))?.isFile()) {
				return { kind: "skipped-error", reason: "skill folder has no SKILL.md" };
			}

			const ownership = await this.#readOwnership();
			const link = path.join(this.#skillDirectory, skillId);
			const state = await this.#linkState(link, ownership[skillId]);
			if (state === "foreign") return { kind: "skipped", reason: "not-owned" };
			const record = ownership[skillId];
			if (state === "ours" && record && record.sourceId !== sourceId) {
				return { kind: "skipped", reason: "owned-by-other-source" };
			}
			const target = path.resolve(folder);
			if (state === "ours" && record?.target === target) {
				return { kind: "skipped", reason: "up-to-date" };
			}

			await mkdir(this.#skillDirectory, { recursive: true });
			await this.#writeOwnership({ ...ownership, [skillId]: { sourceId, target } });
			if (state === "ours") await removeLink(link);
			await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
			return { kind: "written", reason: state === "ours" ? "updated" : "created" };
		});
	}

	remove(sourceId: string, skillId: string): Promise<KiloSkillMutationOutcome> {
		return this.#enqueue(async () => {
			const invalid = validateId("source id", sourceId) ?? validateId("skill id", skillId);
			if (invalid) return { kind: "skipped-error", reason: invalid };

			const ownership = await this.#readOwnership();
			const record = ownership[skillId];
			const link = path.join(this.#skillDirectory, skillId);
			const state = await this.#linkState(link, record);
			if (record && record.sourceId !== sourceId) {
				return { kind: "skipped", reason: "owned-by-other-source" };
			}
			if (state === "ours") await removeLink(link);
			// A link the user replaced is theirs now: forget it, leave it.
			if (record) await this.#writeOwnership(withoutKey(ownership, skillId));
			if (state === "foreign") return { kind: "skipped", reason: "not-owned" };
			return state === "ours"
				? { kind: "removed", reason: "explicit" }
				: { kind: "skipped", reason: "nothing-to-remove" };
		});
	}

	listOwnedSkillIds(sourceId: string): Promise<readonly string[]> {
		return this.#enqueue(async () =>
			Object.entries(await this.#readOwnership())
				.filter(([, record]) => record.sourceId === sourceId)
				.map(([skillId]) => skillId)
				.sort(),
		);
	}

	/** `ours` only while the entry is still the link Desktop recorded. */
	async #linkState(
		link: string,
		record: OwnedLink | undefined,
	): Promise<"absent" | "ours" | "foreign"> {
		let isLink: boolean;
		try {
			isLink = (await lstat(link)).isSymbolicLink();
		} catch (error) {
			if (isMissing(error)) return "absent";
			throw error;
		}
		if (!isLink || !record) return "foreign";
		const target = normalizedTarget(path.resolve(path.dirname(link), await readlink(link)));
		return target === normalizedTarget(record.target) ? "ours" : "foreign";
	}

	async #readOwnership(): Promise<Ownership> {
		let raw: string;
		try {
			raw = await readFile(this.#ownershipFile, "utf8");
		} catch (error) {
			if (isMissing(error)) return {};
			throw error;
		}
		try {
			const parsed = JSON.parse(raw) as { readonly skills?: unknown };
			const skills = parsed.skills;
			if (!skills || typeof skills !== "object") return {};
			return Object.fromEntries(Object.entries(skills).filter(([, value]) => isOwnedLink(value)));
		} catch {
			return {};
		}
	}

	async #writeOwnership(ownership: Ownership): Promise<void> {
		if (Object.keys(ownership).length === 0) {
			await unlink(this.#ownershipFile).catch((error) => {
				if (!isMissing(error)) throw error;
			});
			return;
		}
		const contents = { version: OWNERSHIP_VERSION, skills: ownership };
		await atomicWriteFile(this.#ownershipFile, `${JSON.stringify(contents, undefined, 2)}\n`, {
			encoding: "utf8",
		});
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#pending.then(operation, operation);
		this.#pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

function withoutKey(ownership: Ownership, skillId: string): Ownership {
	const next = { ...ownership };
	delete next[skillId];
	return next;
}

/** Removes the link, never what it points to; Windows may need `rmdir` for a directory link. */
async function removeLink(link: string): Promise<void> {
	try {
		await unlink(link);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "EPERM" && code !== "EISDIR") throw error;
		await rmdir(link);
	}
}
