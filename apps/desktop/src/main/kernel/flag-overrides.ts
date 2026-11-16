/**
 * Flags forced on by the build (`VITE_FEATURE_FLAG_OVERRIDES`, a comma-separated
 * list of flag ids), handed to the kernel as `kernel/flags` overrides.
 */
export function parseFlagOverrides(value: string | undefined): Record<string, true> {
	const ids = (value ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return Object.fromEntries(ids.map((id) => [id, true as const]));
}
