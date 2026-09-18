import path from "node:path";

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

export function sanitizeGeneratedReleaseNotes(markdown: string): string {
	return markdown
		.split("\n")
		.map((line) =>
			line
				.replace(
					/\s+by\s+@[-\w]+\s+in\s+\[#\d+\]\(https:\/\/github\.com\/[^)]+\/pull\/\d+\)\s*$/i,
					"",
				)
				.replace(/\s+by\s+@[-\w]+\s+in\s+https:\/\/github\.com\/\S+\/pull\/\d+\s*$/i, "")
				.replace(/\s+(?:by\s+@[-\w]+\s+)?in\s+#\d+\s*$/i, "")
				.replace(/\s+\[#\d+\]\(https:\/\/github\.com\/[^)]+\/pull\/\d+\)\s*$/i, "")
				.replace(/\s+\(#\d+\)\s*$/i, ""),
		)
		.join("\n")
		.trim();
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
		if (items.length === 50) break;
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
