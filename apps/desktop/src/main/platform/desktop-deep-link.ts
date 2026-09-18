import type { PluginDeepLink } from "@kilo-desktop/feature-sdk";

const DEEP_LINK_SCHEMES = new Set(["kilo-desktop", "kilo-desktop-dev"]);
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

export type DeepLinkNavigation = {
	readonly path: string;
	readonly search: Readonly<Record<string, string>>;
};

export function parseDesktopDeepLink(
	raw: string,
	links: readonly PluginDeepLink[],
): DeepLinkNavigation | undefined {
	let url: URL;
	try {
		url = new URL(stripWrappingQuotes(raw.trim()));
	} catch {
		return undefined;
	}

	if (!DEEP_LINK_SCHEMES.has(url.protocol.replace(/:$/, ""))) return undefined;
	if (url.username || url.password || url.port) return undefined;

	const link = links.find((candidate) => candidate.host === url.hostname.toLowerCase());
	if (!link) return undefined;

	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 1) return undefined;

	let value: string;
	try {
		value = decodeURIComponent(segments[0] ?? "");
	} catch {
		return undefined;
	}
	if (value === "." || value === ".." || !PATH_SEGMENT_PATTERN.test(value)) return undefined;

	return {
		path: link.to,
		search: { [link.searchParam]: value },
	};
}

export function findDesktopDeepLink(
	argv: readonly string[],
	links: readonly PluginDeepLink[],
): DeepLinkNavigation | undefined {
	for (const argument of argv) {
		const navigation = parseDesktopDeepLink(argument, links);
		if (navigation) return navigation;
	}
	return undefined;
}

function stripWrappingQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}
