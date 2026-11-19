import { z } from "zod";

/**
 * Shell profiles: which executable a terminal runs. Main detects the shells
 * installed on the machine and merges the person's own profiles over them;
 * the default profile is read each time a shell starts. A renderer never names
 * an executable over the terminal port; it can only change settings.
 */

/** Shells whose install locations main knows how to find (VS Code's profile sources). */
export const TERMINAL_PROFILE_SOURCES = ["pwsh", "git-bash"] as const;
export type TerminalProfileSource = (typeof TERMINAL_PROFILE_SOURCES)[number];

export const TERMINAL_PROFILE_SOURCE_LABELS: Record<TerminalProfileSource, string> = {
	pwsh: "PowerShell",
	"git-bash": "Git Bash",
};

const MAX_PROFILES = 100;

/** Environment a profile adds to its shell; null unsets the variable. */
export const terminalProfileEnvSchema = z.record(
	z.string().min(1).max(256),
	z.string().max(32_768).nullable(),
);
export type TerminalProfileEnv = z.infer<typeof terminalProfileEnvSchema>;

const profileArgsSchema = z.array(z.string().max(32_768)).max(256);

/** True for a path relative to somewhere, like `bin/zsh` or `.\pwsh.exe`; bare names and absolute paths are fine. */
function isDirectoryRelative(value: string): boolean {
	const absolute =
		value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
	return !absolute && /[\\/]/.test(value);
}

export const customTerminalProfileSchema = z
	.object({
		id: z.string().min(1).max(128),
		label: z.string().trim().min(1).max(128),
		/** An absolute path, or a bare name looked up on PATH. */
		path: z
			.string()
			.trim()
			.min(1)
			.max(32_768)
			.refine((value) => !isDirectoryRelative(value), {
				message: "Use an absolute path or a bare name found on PATH.",
			})
			.optional(),
		source: z.enum(TERMINAL_PROFILE_SOURCES).optional(),
		args: profileArgsSchema.optional(),
		env: terminalProfileEnvSchema.optional(),
	})
	.refine((profile) => (profile.path === undefined) !== (profile.source === undefined), {
		message: "Choose either an executable or a detected shell.",
		path: ["path"],
	});
export type CustomTerminalProfile = z.infer<typeof customTerminalProfileSchema>;

/** A profile main can launch (or, when not `available`, a custom one whose shell wasn't found). */
export const terminalProfileSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	path: z.string(),
	args: profileArgsSchema,
	env: terminalProfileEnvSchema.optional(),
	source: z.enum(["detected", "custom"]),
	available: z.boolean(),
});
export type TerminalProfile = z.infer<typeof terminalProfileSchema>;

export const terminalSettingsSchema = z.object({
	/** The profile new shells run; null picks one automatically. */
	defaultProfileId: z.string().min(1).nullable(),
	customProfiles: z.array(customTerminalProfileSchema).max(MAX_PROFILES),
});
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
	defaultProfileId: null,
	customProfiles: [],
};
