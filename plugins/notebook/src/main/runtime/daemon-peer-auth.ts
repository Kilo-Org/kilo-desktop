/**
 * Trust decision for the process answering on the runtimed daemon socket.
 *
 * The daemon socket lives at a predictable, user-writable path (see
 * `socket-path.ts`), so a same-user process can squat it and receive the code
 * a notebook runs. runtimed is a third-party binary with no auth token, and
 * Node exposes no peer-credential API, so authentication is a peer-credential
 * check (`peer-credentials.ts`) feeding this pure decision.
 *
 * Two shapes of trust, matching how the daemon came to be:
 * - `own-child`: we spawned the daemon, so the only listener we trust is the
 *   exact child pid we launched. This is the strong case — a squatter that
 *   answered the socket instead of our child fails immediately.
 * - `trusted-image`: we are attaching to a daemon we did not spawn, so we can
 *   only trust it by its executable — its digest must match the pinned release,
 *   or its macOS signature must meet Anaconda's or nteract's Developer ID
 *   requirement (see `MACOS_RUNTIMED_REQUIREMENT`). This is
 *   defense in depth, not a hard boundary against a
 *   same-user attacker: that user can run the genuine binary under `LD_PRELOAD`
 *   / `DYLD_INSERT_LIBRARIES` (absent a hardened runtime), attach with ptrace,
 *   or replace a user-writable install outright. It raises the bar; it does not
 *   by itself stop a determined local attacker.
 *
 * Known residual risks (DESK-3090; documented, not fully closed here):
 * - Check-vs-use (TOCTOU): the credential read uses its own short-lived
 *   connection, so a same-user attacker could rebind the socket between the
 *   check and the relay connections that actually carry code. Binding this
 *   properly needs a peer check on the relay fd itself (an upstream
 *   `@runtimed/node` hook). The bundled daemon is also authenticated once (the
 *   manager caches the `bundled` state) while relays open per notebook/reconnect.
 * - Pre-auth exposure: the readiness probe (`queryDaemonInfo`) does a full
 *   protocol exchange with the listener before any trust decision exists.
 * - Windows: named pipes are not per-user and no SID/uid check is applied to the
 *   attach case, so a cross-user listener running our binary can still pass.
 *
 * Kept free of DOM, Node, and I/O so the rules are exercised directly.
 */

export interface PeerIdentity {
	/** OS process id of the listener on the far end of the socket/pipe. */
	readonly pid: number;
	/**
	 * Owning user id of the listener, or `null` where the platform's local IPC
	 * exposes no peer uid (Windows named pipes). A `null` uid disables the
	 * same-user check rather than failing it.
	 */
	readonly uid: number | null;
	/** Canonical (realpath) executable image of the listener, or `null` if unknown. */
	readonly executablePath: string | null;
	/** SHA-256 of that image, populated when verifying an attached daemon. */
	readonly executableSha256?: string | null;
	/** Whether the image satisfies the trusted macOS signing requirement. */
	readonly trustedSignature?: boolean;
}

export type ExpectedDaemonPeer =
	| { readonly kind: "own-child"; readonly pid: number }
	| { readonly kind: "trusted-image"; readonly allowedExecutableSha256: readonly string[] };

export type PeerTrustDecision =
	| { readonly trusted: true }
	| { readonly trusted: false; readonly reason: string };

export interface DecidePeerTrustOptions {
	/** This process's uid; when set, the peer must be the same user. */
	readonly selfUid?: number | null;
}

function deny(reason: string): PeerTrustDecision {
	return { trusted: false, reason };
}

export function decidePeerTrust(
	peer: PeerIdentity | null,
	expected: ExpectedDaemonPeer,
	options: DecidePeerTrustOptions = {},
): PeerTrustDecision {
	if (!peer) {
		return deny("Could not read the runtime daemon's peer credentials.");
	}

	// Defense in depth: a cross-user listener is never the daemon we mean to
	// talk to. Skipped when the platform cannot report a peer uid.
	if (options.selfUid != null && peer.uid != null && peer.uid !== options.selfUid) {
		return deny(
			`The runtime daemon socket is owned by uid ${peer.uid}, not this user (uid ${options.selfUid}).`,
		);
	}

	if (expected.kind === "own-child") {
		// Invariant: the process listening on the socket IS the runtimed we
		// spawned. We launch the binary with an empty argv (see
		// RuntimedDaemonManager #spawnProcess), so it binds its own default socket
		// path — which must match the path we authenticate against — and is itself
		// the listener; it does not daemonize, double-fork, or re-exec a helper on
		// supported platforms. This is an assumption about a third-party binary's
		// current behavior, not something an automated test enforces. If a future
		// runtimed ever forks/re-execs, this denies a *healthy* daemon and the
		// bundled path fails closed (notebooks unavailable, not a security hole);
		// this branch is where to revisit it.
		// We deliberately do NOT soften this to "a descendant running a trusted
		// image": the exact-pid match is the one hard boundary against a same-user
		// attacker (the image check below is only defense in depth — see the
		// module header), so widening it would reintroduce the documented
		// LD_PRELOAD/DYLD/file-replacement gaps.
		if (peer.pid !== expected.pid) {
			return deny(
				`The process answering the runtime daemon socket (pid ${peer.pid}) is not the daemon this app started (pid ${expected.pid}).`,
			);
		}
		return { trusted: true };
	}

	if (peer.executablePath === null) {
		return deny(
			"The runtime daemon's executable could not be identified, so it cannot be matched against the trusted runtimed image.",
		);
	}
	if (!expected.allowedExecutableSha256.length) {
		return deny("No trusted runtimed release is available for an attached daemon.");
	}
	if (
		!peer.trustedSignature &&
		(!peer.executableSha256 || !expected.allowedExecutableSha256.includes(peer.executableSha256))
	) {
		return deny(
			`The runtime daemon is running an executable that does not match the trusted runtimed release or signing identity: ${peer.executablePath}.`,
		);
	}
	return { trusted: true };
}
