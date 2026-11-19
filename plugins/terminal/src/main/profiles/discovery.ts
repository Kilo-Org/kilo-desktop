import { resolveShellCandidates, type ShellCandidate } from "../sessions/shell-launch";
import { detectProfiles, type DetectDeps } from "./detect-profiles";
import { findExecutable } from "./find-executable";
import type { ShellDiscovery } from "./ProfileService";

export type DiscoveryEnvironment = Omit<DetectDeps, "customProfiles" | "includeDetected">;

/**
 * Main's shell discovery, reading its environment at each call (so it sees
 * the login shell's PATH once that has settled). Automatic shells are the
 * long-standing fallbacks ($SHELL, zsh, bash, sh; COMSPEC, pwsh, cmd)
 * resolved to absolute paths that exist, so a missing $SHELL is skipped
 * instead of spawning a shell that exits at once.
 */
export function createShellDiscovery(environment: () => DiscoveryEnvironment): ShellDiscovery {
	return {
		detect: (customProfiles) => detectProfiles({ ...environment(), customProfiles }),
		async automatic() {
			const deps = environment();
			const candidates = resolveShellCandidates(deps.platform, deps.env);
			const resolved: ShellCandidate[] = [];
			for (const candidate of candidates) {
				const shell = await findExecutable(candidate.shell, {
					platform: deps.platform,
					env: deps.env,
					cwd: deps.cwd,
					isExecutableFile: deps.fs.isExecutableFile,
				});
				if (shell && !resolved.some((existing) => existing.shell === shell)) {
					resolved.push({ ...candidate, shell });
				}
			}
			// Nothing found is more likely a broken check than no shell; let spawning have a go.
			return resolved.length > 0 ? resolved : candidates;
		},
	};
}
