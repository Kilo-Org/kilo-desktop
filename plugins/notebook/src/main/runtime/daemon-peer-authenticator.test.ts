import { describe, expect, it, vi } from "vitest";

import { createDaemonPeerAuthenticator } from "./daemon-peer-authenticator.js";
import type { PeerIdentity } from "./daemon-peer-auth.js";

const SELF_UID = 501;

function identity(overrides: Partial<PeerIdentity> = {}): PeerIdentity {
	return { pid: 4242, uid: SELF_UID, executablePath: "/real/runtimed", ...overrides };
}

describe("createDaemonPeerAuthenticator", () => {
	it("trusts a spawned daemon whose listener pid matches the child", async () => {
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity({ pid: 4242 }),
			allowedExecutablePaths: [],
			selfUid: SELF_UID,
		});

		expect(await authenticate({ socketPath: "/s.sock", spawnedPid: 4242 })).toEqual({
			trusted: true,
		});
	});

	it("rejects a spawned daemon whose listener pid differs from the child", async () => {
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity({ pid: 9 }),
			allowedExecutablePaths: [],
			selfUid: SELF_UID,
		});

		const decision = await authenticate({ socketPath: "/s.sock", spawnedPid: 4242 });
		expect(decision.trusted).toBe(false);
	});

	it("passes the resolved socket path to the credential resolver", async () => {
		const resolvePeerIdentity = vi.fn(async () => identity());
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity,
			allowedExecutablePaths: ["/real/runtimed"],
			selfUid: SELF_UID,
		});

		await authenticate({ socketPath: "/tmp/runtimed.sock", spawnedPid: null });
		expect(resolvePeerIdentity).toHaveBeenCalledWith("/tmp/runtimed.sock");
	});

	it("trusts an external daemon whose image canonicalizes onto an allowed path", async () => {
		// The allow-list entry is a symlink to the peer's real executable; both
		// sides are canonicalized before comparison.
		const canonical: Record<string, string> = {
			"/link/runtimed": "/real/runtimed",
			"/real/runtimed": "/real/runtimed",
		};
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity({ executablePath: "/real/runtimed" }),
			allowedExecutablePaths: ["/link/runtimed"],
			selfUid: SELF_UID,
			canonicalize: async (p) => canonical[p] ?? p,
		});

		expect(await authenticate({ socketPath: "/s.sock", spawnedPid: null })).toEqual({
			trusted: true,
		});
	});

	it("rejects an external daemon running an image outside the allow-list", async () => {
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity({ executablePath: "/tmp/evil" }),
			allowedExecutablePaths: ["/real/runtimed"],
			selfUid: SELF_UID,
			canonicalize: async (p) => p,
		});

		const decision = await authenticate({ socketPath: "/s.sock", spawnedPid: null });
		expect(decision.trusted).toBe(false);
	});

	it("rejects when the peer identity cannot be resolved", async () => {
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => null,
			allowedExecutablePaths: ["/real/runtimed"],
			selfUid: SELF_UID,
		});

		const decision = await authenticate({ socketPath: "/s.sock", spawnedPid: null });
		expect(decision.trusted).toBe(false);
	});
});
