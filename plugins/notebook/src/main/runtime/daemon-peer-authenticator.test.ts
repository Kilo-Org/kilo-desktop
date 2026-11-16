import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemonPeerAuthenticator } from "./daemon-peer-authenticator";
import type { PeerIdentity } from "./daemon-peer-auth";

const SELF_UID = 501;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const tempDirectories: string[] = [];

function identity(overrides: Partial<PeerIdentity> = {}): PeerIdentity {
	return { pid: 4242, uid: SELF_UID, executablePath: "/real/runtimed", ...overrides };
}

afterEach(async () => {
	for (const directory of tempDirectories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

describe("createDaemonPeerAuthenticator", () => {
	it("trusts a spawned daemon whose listener pid matches the child without hashing", async () => {
		const hashExecutable = vi.fn(async () => "other-digest");
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity(),
			allowedExecutableSha256: [],
			selfUid: SELF_UID,
			hashExecutable,
		});

		expect(await authenticate({ socketPath: "/s.sock", spawnedPid: 4242 })).toEqual({
			trusted: true,
		});
		expect(hashExecutable).not.toHaveBeenCalled();
		expect((await authenticate({ socketPath: "/s.sock", spawnedPid: 9 })).trusted).toBe(false);
	});

	it("passes the resolved socket path to the credential resolver", async () => {
		const resolvePeerIdentity = vi.fn(async () => identity());
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity,
			allowedExecutableSha256: [],
			selfUid: SELF_UID,
		});

		await authenticate({ socketPath: "/tmp/runtimed.sock", spawnedPid: null });
		expect(resolvePeerIdentity).toHaveBeenCalledWith("/tmp/runtimed.sock");
	});

	it("trusts the same pinned executable in another installation via a symlink", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "runtimed-auth-"));
		tempDirectories.push(directory);
		const binary = path.join(directory, "runtimed-nightly");
		const link = path.join(directory, "preview-runtimed");
		await writeFile(binary, "pinned daemon executable");
		await symlink(binary, link);
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity({ executablePath: link }),
			allowedExecutableSha256: [digest("pinned daemon executable")],
			selfUid: SELF_UID,
		});

		expect(await authenticate({ socketPath: "/s.sock", spawnedPid: null })).toEqual({
			trusted: true,
		});
	});

	it("rejects modified, missing, and unreadable executable images", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "runtimed-auth-"));
		tempDirectories.push(directory);
		const binary = path.join(directory, "runtimed-nightly");
		await writeFile(binary, "modified daemon executable");
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity({ executablePath: binary }),
			allowedExecutableSha256: [digest("pinned daemon executable")],
			selfUid: SELF_UID,
		});
		expect((await authenticate({ socketPath: "/s.sock", spawnedPid: null })).trusted).toBe(false);
		await rm(binary);
		expect((await authenticate({ socketPath: "/s.sock", spawnedPid: null })).trusted).toBe(false);
	});

	it("accepts a signed Preview image with a different digest at another path", async () => {
		const verifySignature = vi.fn(async () => true);
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () =>
				identity({ executablePath: "/Applications/Kilo Preview.app/runtimed-nightly" }),
			allowedExecutableSha256: ["unsigned-release-digest"],
			selfUid: SELF_UID,
			canonicalize: async (image) => image,
			hashExecutable: async () => "signed-digest",
			verifySignature,
		});
		expect(await authenticate({ socketPath: "/s.sock", spawnedPid: null })).toEqual({
			trusted: true,
		});
		expect(verifySignature).toHaveBeenCalledWith("/Applications/Kilo Preview.app/runtimed-nightly");
	});

	it("rejects missing peer identity and cross-user listeners", async () => {
		for (const peer of [null, identity({ uid: 0 })]) {
			const authenticate = createDaemonPeerAuthenticator({
				resolvePeerIdentity: async () => peer,
				allowedExecutableSha256: ["pinned-digest"],
				selfUid: SELF_UID,
				canonicalize: async (image) => image,
				hashExecutable: async () => "pinned-digest",
			});
			expect((await authenticate({ socketPath: "/s.sock", spawnedPid: null })).trusted).toBe(false);
		}
	});

	it("does not verify an image when no bundled release is available", async () => {
		const verifySignature = vi.fn(async () => true);
		const authenticate = createDaemonPeerAuthenticator({
			resolvePeerIdentity: async () => identity(),
			allowedExecutableSha256: [],
			selfUid: SELF_UID,
			verifySignature,
		});

		expect((await authenticate({ socketPath: "/s.sock", spawnedPid: null })).trusted).toBe(false);
		expect(verifySignature).not.toHaveBeenCalled();
	});
});
