import { realpath } from "node:fs/promises";

import { decidePeerTrust, type PeerIdentity } from "./daemon-peer-auth.js";
import type { AuthenticatePeer } from "./RuntimedDaemonManager.js";

/**
 * Composes the OS peer-credential lookup with the pure trust decision to form
 * the `AuthenticatePeer` the daemon manager calls at each trust point.
 *
 * The manager tells us whether it spawned the daemon (`spawnedPid`) or is
 * attaching to one it did not start (`spawnedPid === null`); that selects the
 * expectation the pure decision enforces. Executable paths are canonicalized
 * on both sides so a symlinked bundle path still matches the peer's realpath.
 */
export interface DaemonPeerAuthenticatorDeps {
	readonly resolvePeerIdentity: (socketPath: string) => Promise<PeerIdentity | null>;
	/** Executables an attached (not-spawned) daemon may run — typically our bundled binary. */
	readonly allowedExecutablePaths: readonly string[];
	readonly selfUid: number | null;
	/** Resolves symlinks/case so both sides of the image comparison are canonical. */
	readonly canonicalize?: (path: string) => Promise<string>;
}

async function defaultCanonicalize(path: string): Promise<string> {
	const resolved = await realpath(path);
	// Windows paths are case-insensitive; fold case so the compare is stable.
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function safeCanonicalize(
	path: string,
	canonicalize: (path: string) => Promise<string>,
): Promise<string> {
	try {
		return await canonicalize(path);
	} catch {
		// A missing/unreadable path can't be canonicalized; compare it verbatim
		// so it simply fails to match an allowed entry rather than throwing.
		return process.platform === "win32" ? path.toLowerCase() : path;
	}
}

export function createDaemonPeerAuthenticator(deps: DaemonPeerAuthenticatorDeps): AuthenticatePeer {
	const canonicalize = deps.canonicalize ?? defaultCanonicalize;
	return async ({ socketPath, spawnedPid }) => {
		const peer = await deps.resolvePeerIdentity(socketPath);

		if (spawnedPid !== null) {
			return decidePeerTrust(
				peer,
				{ kind: "own-child", pid: spawnedPid },
				{ selfUid: deps.selfUid },
			);
		}

		const allowedExecutablePaths = await Promise.all(
			deps.allowedExecutablePaths.map((path) => safeCanonicalize(path, canonicalize)),
		);
		const canonicalPeer =
			peer && peer.executablePath !== null
				? { ...peer, executablePath: await safeCanonicalize(peer.executablePath, canonicalize) }
				: peer;
		return decidePeerTrust(
			canonicalPeer,
			{ kind: "trusted-image", allowedExecutablePaths },
			{ selfUid: deps.selfUid },
		);
	};
}
