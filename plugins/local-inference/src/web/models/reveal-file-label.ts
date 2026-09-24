export function revealInFileManagerLabel(platform = globalThis.navigator?.platform ?? ""): string {
	if (/^win/i.test(platform)) return "Show in Explorer";
	if (/^linux/i.test(platform)) return "Show in Files";
	return "Show in Finder";
}
