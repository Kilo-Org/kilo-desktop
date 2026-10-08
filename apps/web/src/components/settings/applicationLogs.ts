export function getShowLogFileLabel(platform = ""): string {
	if (/Mac|iPhone|iPad/i.test(platform)) return "Show in Finder";
	if (/Win/i.test(platform)) return "Show in File Explorer";
	return "Show in File Manager";
}
