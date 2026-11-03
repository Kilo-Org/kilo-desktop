import path from "node:path";

import { MAX_PUBLISHED_RELEASE_NOTE_ITEMS } from "./release-notes.js";
import { getAppIdentity } from "./app-identity.js";
import { getReleasePrefix, type ReleaseTrack } from "./release.js";

export interface ReleaseDownload {
	readonly sourcePath: string;
	readonly platform: "linux" | "macos" | "windows";
	readonly arch: string;
	readonly type: "deb" | "dmg" | "setup" | "zip";
	readonly fileName: string;
}

export function getTrackReleaseTag(track: ReleaseTrack, version: string): string {
	return `v${version}`;
}

export function getTrackReleaseVersionFromTag(track: ReleaseTrack, tag: string): string | null {
	if (!tag.startsWith("v")) return null;
	const version = tag.slice(1);
	const isPreview = /^\d+\.\d+\.\d+-preview-\d{6}-\d{5}$/.test(version);
	if ((track === "preview") !== isPreview) return null;
	return version || null;
}

export function getTrackReleaseName(track: ReleaseTrack, version: string): string {
	if (track === "stable") return `Kilo Desktop v${version}`;
	const label = track.charAt(0).toUpperCase() + track.slice(1);
	return `Kilo Desktop ${label} v${version}`;
}

export function getGithubReleaseFlags(
	track: ReleaseTrack,
	version: string,
): { prerelease: boolean; makeLatest: boolean } {
	const plainStable = track === "stable" && /^\d+\.\d+\.\d+$/.test(version);
	return { prerelease: !plainStable, makeLatest: plainStable };
}

/**
 * Picks the release that a new or existing `currentTag` should be diffed
 * against. Tags are newest-first (GitHub's releases order); when `currentTag`
 * is already in the list, only older tags are candidates.
 */
export function findPreviousTrackTag(
	tagsNewestFirst: readonly string[],
	track: ReleaseTrack,
	currentTag: string,
): string | undefined {
	const currentIndex = tagsNewestFirst.indexOf(currentTag);
	return tagsNewestFirst
		.slice(currentIndex + 1)
		.find((tag) => getTrackReleaseVersionFromTag(track, tag) !== null);
}

// GitHub logins may carry a `[bot]` suffix (e.g. `@anaconda-renovate[bot]`).
const AUTHOR = String.raw`@[-\w]+(?:\[bot\])?`;
const PULL_REFERENCE_SUFFIXES = [
	new RegExp(
		String.raw`\s+by\s+${AUTHOR}\s+in\s+\[#\d+\]\(https:\/\/github\.com\/[^)]+\/pull\/\d+\)\s*$`,
		"i",
	),
	new RegExp(String.raw`\s+by\s+${AUTHOR}\s+in\s+https:\/\/github\.com\/\S+\/pull\/\d+\s*$`, "i"),
	new RegExp(String.raw`\s+(?:by\s+${AUTHOR}\s+)?in\s+#\d+\s*$`, "i"),
	/\s+\[#\d+\]\(https:\/\/github\.com\/[^)]+\/pull\/\d+\)\s*$/i,
	/\s+\(#\d+\)\s*$/i,
];

// Internal tracker ids (e.g. `DESK-3108`) mean nothing outside the team. A bare
// leading id is only treated as a ticket when followed by `:` or a
// conventional-commit prefix, so titles like "UTF-8 support" survive.
const TICKET = String.raw`[A-Z][A-Z\d]+-\d+`;
const LEADING_TICKETS = new RegExp(
	String.raw`^(?:\[${TICKET}\]\s*|${TICKET}:\s*|${TICKET}\s+(?=\w+(?:\([^)]*\))?!?:\s))+`,
);
const TRAILING_TICKETS = new RegExp(String.raw`(?:\s*(?:\[${TICKET}\]|\(${TICKET}\)))+\s*$`);
const LIST_ITEM_LINE = /^(\s*[-*]\s+)(.*)$/;

export function sanitizeGeneratedReleaseNotes(markdown: string): string {
	return markdown
		.split("\n")
		.map((line) => {
			const listItem = LIST_ITEM_LINE.exec(stripPullReference(line));
			if (!listItem) return stripPullReference(line);
			return `${listItem[1]}${stripTicketIds(listItem[2]!)}`;
		})
		.join("\n")
		.trim();
}

function stripPullReference(line: string): string {
	return PULL_REFERENCE_SUFFIXES.reduce((result, suffix) => result.replace(suffix, ""), line);
}

function stripTicketIds(title: string): string {
	return title.replace(LEADING_TICKETS, "").replace(TRAILING_TICKETS, "").trim();
}

export type ReleaseNoteSection = "Features" | "Fixes" | "Dependencies" | "Other";

const RELEASE_NOTE_SECTIONS: readonly ReleaseNoteSection[] = [
	"Features",
	"Fixes",
	"Dependencies",
	"Other",
];
const DEPENDENCY_SCOPES = new Set(["deps", "deps-dev"]);
// Scopes that describe repository or test infrastructure rather than the app,
// so even a `feat`/`fix` with these scopes is not a user-facing change.
const INTERNAL_SCOPES = new Set(["ci", "codeowners", "e2e", "release", "test", "tests"]);
const DEPENDENCY_BOT = /^(?:[-\w]*renovate|dependabot)\[bot\]$/i;
const CONVENTIONAL_TITLE = /^(\w+)(?:\(([^)]*)\))?!?:\s/;

/**
 * Sorts a pull-request title into a release-notes section from its
 * conventional-commit prefix (`feat(scope): …`), tolerating a leading ticket
 * id such as `[DESK-123]` or `DESK-123:`. Titles without a recognized prefix
 * land in Other.
 */
export function classifyReleaseNote(title: string, author?: string): ReleaseNoteSection {
	if (author && DEPENDENCY_BOT.test(author)) return "Dependencies";
	const match = CONVENTIONAL_TITLE.exec(stripTicketIds(title));
	if (!match) return "Other";
	const type = match[1]!.toLowerCase();
	const scope = match[2]?.trim().toLowerCase();
	if (scope && DEPENDENCY_SCOPES.has(scope)) return "Dependencies";
	if (scope && INTERNAL_SCOPES.has(scope)) return "Other";
	if (type === "feat") return "Features";
	if (type === "fix") return "Fixes";
	return "Other";
}

const WHATS_CHANGED_HEADING = /^##\s+what's changed\s*$/i;
const LIST_ITEM = /^[-*]\s+(.+)$/;
const ITEM_AUTHOR = new RegExp(String.raw`\s+by\s+(${AUTHOR})\s+in\s+\S+\s*$`, "i");

/**
 * Regroups GitHub's flat "What's Changed" list into `###` sections ordered
 * Features, Fixes, Dependencies, Other, preserving merge order within each
 * section. Run it on the raw generated body, before
 * `sanitizeGeneratedReleaseNotes`, so bot authors can still be detected.
 */
export function groupGeneratedReleaseNotes(markdown: string): string {
	const lines = markdown.split("\n");
	const headingIndex = lines.findIndex((line) => WHATS_CHANGED_HEADING.test(line.trim()));
	if (headingIndex === -1) return markdown;

	let endIndex = lines.findIndex(
		(line, index) => index > headingIndex && isWhatsChangedTerminator(line.trim()),
	);
	if (endIndex === -1) endIndex = lines.length;

	const sections = new Map<ReleaseNoteSection, string[]>(
		RELEASE_NOTE_SECTIONS.map((section) => [section, []]),
	);
	for (const line of lines.slice(headingIndex + 1, endIndex)) {
		const item = LIST_ITEM.exec(line.trim())?.[1];
		if (!item) continue;
		const author = ITEM_AUTHOR.exec(item)?.[1]?.slice(1);
		sections.get(classifyReleaseNote(stripPullReference(item), author))!.push(line.trim());
	}

	const grouped = [lines[headingIndex]!];
	for (const [section, items] of sections) {
		if (items.length > 0) grouped.push("", `### ${section}`, ...items);
	}
	const rest = lines.slice(endIndex);
	return [...lines.slice(0, headingIndex), ...grouped, ...(rest.length > 0 ? ["", ...rest] : [])]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}

function isWhatsChangedTerminator(line: string): boolean {
	return /^##\s+/.test(line) || /^\*\*full changelog\*\*/i.test(line);
}

export function extractReleaseNoteItems(markdown: string): string[] {
	const items: string[] = [];
	let ignoredSection = false;
	for (const rawLine of markdown.split("\n")) {
		const line = rawLine.trim();
		if (/^##\s+(new contributors|full changelog)/i.test(line)) {
			ignoredSection = true;
			continue;
		}
		if (/^##\s+/.test(line)) ignoredSection = false;
		if (ignoredSection || /^\*\*full changelog\*\*/i.test(line)) continue;
		const match = /^[-*]\s+(.+)$/.exec(line);
		if (!match?.[1]) continue;
		const item = stripMarkdownLinks(match[1]).replace(/\s+/g, " ").trim();
		if (item && !item.includes("/compare/")) items.push(item);
		if (items.length === MAX_PUBLISHED_RELEASE_NOTE_ITEMS) break;
	}
	return items;
}

export function classifyReleaseDownload(filePath: string): ReleaseDownload | null {
	const extension = path.extname(filePath).toLowerCase();
	const classification = {
		".deb": { platform: "linux", type: "deb" },
		".dmg": { platform: "macos", type: "dmg" },
		".exe": { platform: "windows", type: "setup" },
		".zip": { platform: "macos", type: "zip" },
	} as const;
	const result = classification[extension as keyof typeof classification];
	if (!result) return null;
	return {
		sourcePath: filePath,
		...result,
		arch: resolveArtifactArch(filePath),
		fileName: path.basename(filePath),
	};
}

export function getLatestAliasKey(track: ReleaseTrack, download: ReleaseDownload): string {
	return `${getReleasePrefix(track)}/latest/${download.platform}/${download.arch}/${getLatestAliasFileName(track, download.type)}`;
}

export function getLatestAliasFileName(track: ReleaseTrack, type: ReleaseDownload["type"]): string {
	const identity = getAppIdentity(track);
	if (type === "setup") return identity.setupExecutableName;
	if (type === "deb") return `${identity.executableName}.deb`;
	return `${identity.productName}.${type}`;
}

export function getGithubReleaseWrite(existingReleaseId: number | null): {
	readonly endpoint: string;
	readonly method: "PATCH" | "POST";
} {
	return existingReleaseId === null
		? { endpoint: "/releases", method: "POST" }
		: { endpoint: `/releases/${existingReleaseId}`, method: "PATCH" };
}

function resolveArtifactArch(filePath: string): string {
	const normalized = filePath.replaceAll("\\", "/");
	for (const arch of ["arm64", "x64", "ia32"] as const) {
		if (new RegExp(`(?:^|[/_.-])${arch}(?:$|[/_.-])`, "i").test(normalized)) return arch;
	}
	return "unknown";
}

function stripMarkdownLinks(value: string): string {
	return value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
}
