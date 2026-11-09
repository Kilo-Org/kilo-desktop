import { compareCondaVersions } from "../../../compare-conda-versions.js";
import type {
	CondaPackageChange,
	CondaPackagesPreviewResult,
} from "../../../contracts/providers/conda.js";

/**
 * Pure parsing of the bridge's transaction `actions` payload. Kept apart from
 * the sidecar RPC client so the format-dependent logic can be unit-tested
 * with representative `str(PackageRecord)` strings.
 */

export interface ActionEntry {
	name: string;
	version: string;
	channel: string;
}

/**
 * Parse conda's legacy action groups into structured change lists.
 *
 * The `actions` dict from `_make_legacy_action_groups()` contains:
 * - `LINK`: packages that will be installed (stringified PackageRecord)
 * - `UNLINK`: packages that will be removed (stringified PackageRecord)
 *
 * Each entry is a string like `"channel/subdir::name==version=build"`. A
 * name present in both groups is classified by comparing versions:
 * upgraded, downgraded, or rebuilt (same version, different build/channel).
 * LINK-only names are added; UNLINK-only names are removed.
 */
export function parseTransactionActions(
	actions: Record<string, unknown>,
): CondaPackagesPreviewResult {
	const linkByName = new Map(parseActionEntries(actions.LINK).map((e) => [e.name, e]));
	const unlinkByName = new Map(parseActionEntries(actions.UNLINK).map((e) => [e.name, e]));

	const upgraded: CondaPackageChange[] = [];
	const downgraded: CondaPackageChange[] = [];
	const added: CondaPackageChange[] = [];
	const removed: CondaPackageChange[] = [];
	const rebuilt: CondaPackageChange[] = [];

	for (const [name, link] of linkByName) {
		const unlink = unlinkByName.get(name);
		if (!unlink) {
			added.push({ name, fromVersion: null, toVersion: link.version, channel: link.channel });
			continue;
		}
		const change: CondaPackageChange = {
			name,
			fromVersion: unlink.version,
			toVersion: link.version,
			channel: link.channel,
		};
		const cmp = compareCondaVersions(link.version, unlink.version);
		if (cmp > 0) upgraded.push(change);
		else if (cmp < 0) downgraded.push(change);
		else rebuilt.push(change);
	}

	for (const [name, unlink] of unlinkByName) {
		if (!linkByName.has(name)) {
			removed.push({ name, fromVersion: unlink.version, toVersion: null, channel: unlink.channel });
		}
	}

	const nothingToDo =
		upgraded.length === 0 &&
		downgraded.length === 0 &&
		added.length === 0 &&
		removed.length === 0 &&
		rebuilt.length === 0;

	return { upgraded, downgraded, added, removed, rebuilt, nothingToDo };
}

/**
 * Parse LINK/UNLINK action entries into `{ name, version, channel }`.
 *
 * Entry format from conda's `str(PackageRecord)`:
 *   `"channel/subdir::name==version=build_string"`
 * e.g. `"defaults/osx-arm64::mcp==2.0.0=py311hca03da5_0"`
 *      `"conda-forge/noarch::attrs==25.4.0=pyhcf101f3_1"`
 *
 * Non-array input and entries without a `name==version` core are skipped so
 * a malformed bridge payload degrades to "no changes" rather than throwing.
 */
export function parseActionEntries(raw: unknown): ActionEntry[] {
	if (!Array.isArray(raw)) return [];
	const results: ActionEntry[] = [];
	for (const entry of raw) {
		const str = String(entry);
		let channel = "";
		let rest = str;
		const colonIdx = str.indexOf("::");
		if (colonIdx >= 0) {
			channel = str.slice(0, colonIdx);
			rest = str.slice(colonIdx + 2);
		}
		const doubleEqIdx = rest.indexOf("==");
		if (doubleEqIdx < 0) continue;
		const name = rest.slice(0, doubleEqIdx);
		if (!name) continue;
		const versionBuild = rest.slice(doubleEqIdx + 2);
		const eqIdx = versionBuild.indexOf("=");
		const version = eqIdx >= 0 ? versionBuild.slice(0, eqIdx) : versionBuild;
		if (!version) continue;
		results.push({ name, version, channel });
	}
	return results;
}
