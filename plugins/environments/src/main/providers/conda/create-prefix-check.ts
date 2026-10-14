import { constants, type Stats } from "node:fs";
import { access, lstat, mkdtemp, rm, stat } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

import type {
	CondaEnvsCheckPrefixResult,
	CreatePrefixUnavailableReason,
} from "../../../contracts/providers/conda.js";

/** Names conda refuses to create (`conda.base.constants.RESERVED_ENV_NAMES`). */
const RESERVED_ENV_NAMES = new Set(["base", "root"]);

const AVAILABLE: CondaEnvsCheckPrefixResult = { available: true };

function unavailable(reason: CreatePrefixUnavailableReason): CondaEnvsCheckPrefixResult {
	return { available: false, reason };
}

/**
 * Decide whether `conda.create` may target `prefix`, without asking the bridge.
 *
 * Mirrors conda's `check_prefix` (`conda/cli/install.py`), which the bridge
 * runs inside `prepare_create_target`: a prefix is taken when it exists and is
 * either not a directory or a directory holding `conda-meta/`; an existing
 * directory without `conda-meta/` is fine. On top of that it rejects targets
 * conda would only fail on later in the create (unwritable location, a path
 * component that is a file).
 *
 * A few stat calls and one write probe keep this fast and independent of the bridge, whose
 * `run_exclusive` lock would queue a bridge-side check behind any running
 * create. Unexpected fs errors fail closed (`inaccessible`) because callers
 * only unlock creation on a positive answer; conda's own check remains the
 * final authority at create time.
 */
export async function checkCreatePrefix(prefix: string): Promise<CondaEnvsCheckPrefixResult> {
	if (!isAbsolute(prefix) || prefix.includes(delimiter)) return unavailable("invalid-path");
	if (RESERVED_ENV_NAMES.has(basename(prefix))) return unavailable("reserved-name");

	const target = await statOrMissing(prefix);
	if (target === "error") return unavailable("inaccessible");
	if (target === "missing") return checkCreatableUnder(dirname(prefix));
	if (!target.isDirectory()) return unavailable("exists-file");

	// Probe the one entry instead of listing the directory, which could be any
	// large existing folder. lstat: conda tests the entry name, so a dangling
	// `conda-meta` symlink still counts.
	const condaMeta = await statOrMissing(join(prefix, "conda-meta"), lstat);
	if (condaMeta === "error") return unavailable("inaccessible");
	if (condaMeta !== "missing") return unavailable("exists-environment");
	// conda lists the prefix in check_prefix; an unlistable one fails there.
	if (!(await canAccess(prefix, constants.R_OK))) return unavailable("inaccessible");
	return (await isWritable(prefix)) ? AVAILABLE : unavailable("not-writable");
}

/** The prefix is missing: conda will `mkdir -p` it from the nearest existing ancestor. */
async function checkCreatableUnder(dir: string): Promise<CondaEnvsCheckPrefixResult> {
	let current = dir;
	for (;;) {
		const info = await statOrMissing(current);
		if (info === "error") return unavailable("inaccessible");
		if (info !== "missing") {
			if (!info.isDirectory()) return unavailable("invalid-path");
			return (await isWritable(current)) ? AVAILABLE : unavailable("not-writable");
		}
		const parent = dirname(current);
		if (parent === current) return unavailable("invalid-path");
		current = parent;
	}
}

async function statOrMissing(
	path: string,
	statFn: (path: string) => Promise<Stats> = stat,
): Promise<Stats | "missing" | "error"> {
	try {
		return await statFn(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return "missing";
		// A file in the middle of the path: nothing can be created below it.
		if (code === "ENOTDIR") return "missing";
		return "error";
	}
}

async function canAccess(path: string, mode: number): Promise<boolean> {
	try {
		await access(path, mode);
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether new entries can be created in `dir`, by actually creating (and
 * removing) one. `fs.access(W_OK)` is not enough: on Windows it only reads the
 * read-only attribute and ignores ACLs, so an all-users install such as
 * `C:\ProgramData\anaconda3\envs` would look writable and fail mid-create.
 */
async function isWritable(dir: string): Promise<boolean> {
	let probe: string;
	try {
		probe = await mkdtemp(join(dir, ".kilo-write-probe-"));
	} catch {
		return false;
	}
	await rm(probe, { recursive: true, force: true }).catch(() => undefined);
	return true;
}
