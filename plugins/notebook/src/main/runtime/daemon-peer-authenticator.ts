import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { decidePeerTrust, type PeerIdentity } from "./daemon-peer-auth.js";
import type { AuthenticatePeer } from "./RuntimedDaemonManager.js";

/**
 * Composes the OS peer-credential lookup with the pure trust decision to form
 * the `AuthenticatePeer` the daemon manager calls at each trust point.
 *
 * The manager tells us whether it spawned the daemon (`spawnedPid`) or is
 * attaching to one it did not start (`spawnedPid === null`); that selects the
 * expectation the pure decision enforces. Attached images are hashed by their
 * canonical path and compared with the release's pinned digest; signed macOS
 * images may instead satisfy `MACOS_RUNTIMED_REQUIREMENT` (Anaconda's or
 * nteract's Developer ID).
 */
export interface DaemonPeerAuthenticatorDeps {
	readonly resolvePeerIdentity: (socketPath: string) => Promise<PeerIdentity | null>;
	/** Pinned SHA-256 digests of executable releases allowed for attached daemons. */
	readonly allowedExecutableSha256: readonly string[];
	readonly selfUid: number | null;
	/** Resolves symlinks so the image is read from its canonical location. */
	readonly canonicalize?: (path: string) => Promise<string>;
	/** Test seam for hashing an executable image. */
	readonly hashExecutable?: (path: string) => Promise<string>;
	/** Test seam for verifying a signed executable. */
	readonly verifySignature?: (path: string) => Promise<boolean>;
}

async function defaultCanonicalize(path: string): Promise<string> {
	return realpath(path);
}

async function hashExecutable(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

const execFileAsync = promisify(execFile);
/**
 * Signing identities trusted for a daemon we attach to but did not spawn:
 * - Anaconda (`Z5788K4JT7`): Forge re-signs our bundled `runtimed`, so
 *   another Kilo installation's daemon no longer matches the unsigned digest.
 * - nteract: the notarized, hardened-runtime `runtimed` inside an installed
 *   nteract app. Its launchd agent starts at login and owns the shared channel
 *   singleton before Kilo Desktop launches, so without this a co-installed
 *   nteract makes notebooks unavailable after every reboot. Releases moved
 *   from Kyle Kelley's team (`8E54RDNN6Z`) to NumFOCUS (`2YJ64GUAVW`) in
 *   nteract#4228 (2026-09-10); both stay trusted because installs predating
 *   the switch keep the old-signed daemon until they update.
 * Any version signed by these teams is accepted; protocol compatibility is
 * not enforced here.
 */
export const MACOS_RUNTIMED_REQUIREMENT =
	'anchor apple generic and ((certificate leaf[subject.OU] = "Z5788K4JT7" and identifier "runtimed") or ((certificate leaf[subject.OU] = "2YJ64GUAVW" or certificate leaf[subject.OU] = "8E54RDNN6Z") and identifier "runtimed"))';

export async function verifyRuntimedSignature(path: string): Promise<boolean> {
	if (process.platform !== "darwin") return false;
	try {
		await execFileAsync("/usr/bin/codesign", [
			"--verify",
			"--strict",
			`-R=${MACOS_RUNTIMED_REQUIREMENT}`,
			path,
		]);
		return true;
	} catch {
		return false;
	}
}

export function createDaemonPeerAuthenticator(deps: DaemonPeerAuthenticatorDeps): AuthenticatePeer {
	const canonicalize = deps.canonicalize ?? defaultCanonicalize;
	const hash = deps.hashExecutable ?? hashExecutable;
	const verify = deps.verifySignature ?? verifyRuntimedSignature;
	return async ({ socketPath, spawnedPid }) => {
		const peer = await deps.resolvePeerIdentity(socketPath);

		if (spawnedPid !== null) {
			return decidePeerTrust(
				peer,
				{ kind: "own-child", pid: spawnedPid },
				{ selfUid: deps.selfUid },
			);
		}

		let authenticatedPeer = peer;
		if (peer?.executablePath && deps.allowedExecutableSha256.length) {
			try {
				const executablePath = await canonicalize(peer.executablePath);
				let executableSha256: string | null = null;
				try {
					executableSha256 = await hash(executablePath);
				} catch {
					// A signed image can still be verified if the file cannot be read.
				}
				authenticatedPeer = {
					...peer,
					executablePath,
					executableSha256,
					trustedSignature:
						!executableSha256 || !deps.allowedExecutableSha256.includes(executableSha256)
							? await verify(executablePath)
							: false,
				};
			} catch {
				// Unreadable or missing images cannot establish trust.
			}
		}
		return decidePeerTrust(
			authenticatedPeer,
			{ kind: "trusted-image", allowedExecutableSha256: deps.allowedExecutableSha256 },
			{ selfUid: deps.selfUid },
		);
	};
}
