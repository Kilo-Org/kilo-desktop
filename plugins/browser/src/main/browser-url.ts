const LOOPBACK_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

export function normalizeBrowserUrl(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	if (!trimmed) throw new Error("Enter a URL.");
	const candidate = trimmed.includes("://")
		? trimmed
		: `${LOOPBACK_PATTERN.test(trimmed) ? "http" : "https"}://${trimmed}`;
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		throw new Error("Enter a valid URL.");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Only HTTP and HTTPS URLs are supported.");
	}
	return parsed.href;
}
