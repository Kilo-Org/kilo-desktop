import path from "node:path";

import { getAppIdentity } from "./app-identity.js";
import { getReleasePrefix, type PublishableReleaseChannel } from "./release.js";

export interface ReleaseDownload {
	readonly sourcePath: string;
	readonly platform: "linux" | "macos" | "windows";
	readonly arch: string;
	readonly type: "deb" | "dmg" | "setup" | "zip";
	readonly fileName: string;
}

export function getChannelReleaseTag(channel: PublishableReleaseChannel, version: string): string {
	return `desktop/${channel}/v${version}`;
}

export function getChannelReleaseVersionFromTag(
	channel: PublishableReleaseChannel,
	tag: string,
): string | null {
	const prefix = `desktop/${channel}/v`;
	if (!tag.startsWith(prefix)) return null;
	return tag.slice(prefix.length) || null;
}

export function getChannelReleaseName(channel: PublishableReleaseChannel, version: string): string {
	const label =
		channel === "prod" ? "Production" : channel.charAt(0).toUpperCase() + channel.slice(1);
	return `Anaconda Agentic Desktop ${label} v${version}`;
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

export function getLatestAliasKey(
	channel: PublishableReleaseChannel,
	download: ReleaseDownload,
): string {
	return `${getReleasePrefix(channel)}/latest/${download.platform}/${download.arch}/${getLatestAliasFileName(channel, download.type)}`;
}

export function getLatestAliasFileName(
	channel: PublishableReleaseChannel,
	type: ReleaseDownload["type"],
): string {
	const identity = getAppIdentity(channel);
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
