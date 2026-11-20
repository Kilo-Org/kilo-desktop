import {
	existsSync,
	lstatSync,
	readFileSync,
	renameSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import type { AppEnvironment } from "$config/app-identity.js";

/**
 * Preview and Stable share one profile (`Kilo Desktop`), so workspaces and
 * preferences follow a track switch. Builds before that kept Preview's data in
 * `Kilo Desktop Preview`; this module folds it in once, before anything opens
 * the profile:
 *
 * - Only a Preview profile: it is renamed to the shared one, and its old path
 *   becomes a link to it. Chats started without a workspace keep absolute
 *   folders inside the old profile, and the link keeps them reachable. If the
 *   rename fails (a running older Preview holds it), this launch keeps using
 *   the Preview profile and the next one tries again.
 * - Both profiles: the shared one stays the base. Preferences are merged into
 *   it once (recorded in `merged-profiles.json`); the Preview profile is left
 *   in place and reported as a former profile, from which plugins import what
 *   they saved there (each records its own import, so a failed one retries).
 *
 * Development builds keep their own profile.
 */

export const PREVIEW_PROFILE_NAME = "Kilo Desktop Preview";
const MERGED_PROFILES_FILE = "merged-profiles.json";

export interface SharedProfile {
	/** The profile this launch uses. */
	readonly userData: string;
	/** Profiles merged into `userData` that plugins import their data from. */
	readonly formerRoots: readonly string[];
}

export interface ProfileMoves {
	rename(oldPath: string, newPath: string): void;
	symlink(target: string, linkPath: string, type: "junction"): void;
}

const nodeMoves: ProfileMoves = { rename: renameSync, symlink: symlinkSync };

export function resolveSharedProfile(
	appData: string,
	environment: AppEnvironment,
	sharedName: string,
	moves: ProfileMoves = nodeMoves,
): SharedProfile {
	const shared = path.join(appData, sharedName);
	if (environment === "development") return { userData: shared, formerRoots: [] };

	const preview = path.join(appData, PREVIEW_PROFILE_NAME);
	if (!isDirectory(preview)) return { userData: shared, formerRoots: [] };

	if (!existsSync(shared)) {
		try {
			moves.rename(preview, shared);
		} catch {
			return { userData: preview, formerRoots: [] };
		}
		try {
			// A junction needs no elevation on Windows; the type is ignored elsewhere.
			moves.symlink(shared, preview, "junction");
		} catch {
			// Only folders of chats started without a workspace are lost.
		}
		return { userData: shared, formerRoots: [] };
	}

	mergePreferencesOnce(shared, preview, environment);
	return { userData: shared, formerRoots: [preview] };
}

/** A real folder: a link left by an earlier move is not a profile of its own. */
function isDirectory(candidate: string): boolean {
	try {
		const stats = lstatSync(candidate);
		return stats.isDirectory() && !stats.isSymbolicLink();
	} catch {
		return false;
	}
}

function mergePreferencesOnce(
	shared: string,
	preview: string,
	runningTrack: Exclude<AppEnvironment, "development">,
): void {
	const markerFile = path.join(shared, MERGED_PROFILES_FILE);
	const merged = readJson(markerFile).merged;
	const done = Array.isArray(merged) ? merged.filter((name) => typeof name === "string") : [];
	if (done.includes(PREVIEW_PROFILE_NAME)) return;

	const preferencesFile = path.join(shared, "preferences.json");
	try {
		writeJson(
			preferencesFile,
			mergePreferences(
				readJson(preferencesFile),
				readJson(path.join(preview, "preferences.json")),
				runningTrack,
			),
		);
		writeJson(markerFile, { merged: [...done, PREVIEW_PROFILE_NAME] });
	} catch {
		// Retried next launch.
	}
}

/**
 * Stable's values win, Preview fills what Stable lacks. An opt-out on either
 * track is kept. The update track comes from the running build's own profile:
 * that is where the latest choice was made, and taking it ends the loop where
 * each track's file pointed at the other.
 */
export function mergePreferences(
	shared: Record<string, unknown>,
	preview: Record<string, unknown>,
	runningTrack: Exclude<AppEnvironment, "development">,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...preview, ...shared };
	if (preview.allowDataCollection === false) merged.allowDataCollection = false;
	if (runningTrack === "preview") {
		if (preview.releaseTrack === undefined) delete merged.releaseTrack;
		else merged.releaseTrack = preview.releaseTrack;
	}
	return merged;
}

function readJson(file: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function writeJson(file: string, value: unknown): void {
	const temporary = `${file}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`);
	renameSync(temporary, file);
}
