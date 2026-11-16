import { describe, expect, it } from "vitest";

import { decidePeerTrust, type PeerIdentity } from "./daemon-peer-auth";

const OUR_UID = 501;

function peer(overrides: Partial<PeerIdentity> = {}): PeerIdentity {
	return { pid: 4242, uid: OUR_UID, executablePath: "/apps/runtimed", ...overrides };
}

describe("decidePeerTrust", () => {
	it("refuses to trust when the peer identity could not be read", () => {
		const decision = decidePeerTrust(null, { kind: "own-child", pid: 4242 }, { selfUid: OUR_UID });
		expect(decision.trusted).toBe(false);
	});

	describe("own-child (the daemon we spawned)", () => {
		it("trusts a listener whose pid matches the spawned child", () => {
			expect(
				decidePeerTrust(
					peer({ pid: 4242 }),
					{ kind: "own-child", pid: 4242 },
					{ selfUid: OUR_UID },
				),
			).toEqual({ trusted: true });
		});

		it("rejects a listener whose pid is not the spawned child", () => {
			const decision = decidePeerTrust(
				peer({ pid: 9999 }),
				{ kind: "own-child", pid: 4242 },
				{ selfUid: OUR_UID },
			);
			expect(decision.trusted).toBe(false);
			// The reason names both pids so the log explains the mismatch.
			expect(decision).toMatchObject({ reason: expect.stringContaining("9999") });
			expect(decision).toMatchObject({ reason: expect.stringContaining("4242") });
		});

		it("rejects a listener owned by a different user even when the pid matches", () => {
			const decision = decidePeerTrust(
				peer({ pid: 4242, uid: 0 }),
				{ kind: "own-child", pid: 4242 },
				{ selfUid: OUR_UID },
			);
			expect(decision.trusted).toBe(false);
		});
	});

	describe("trusted-image (attaching to an external daemon)", () => {
		it("trusts a listener running the pinned executable", () => {
			expect(
				decidePeerTrust(
					peer({ executablePath: "/other-app/runtimed", executableSha256: "pinned-digest" }),
					{ kind: "trusted-image", allowedExecutableSha256: ["pinned-digest"] },
					{ selfUid: OUR_UID },
				),
			).toEqual({ trusted: true });
		});

		it("rejects a listener whose executable digest is not on the allow-list", () => {
			const decision = decidePeerTrust(
				peer({ executablePath: "/tmp/evil", executableSha256: "other-digest" }),
				{ kind: "trusted-image", allowedExecutableSha256: ["pinned-digest"] },
				{ selfUid: OUR_UID },
			);
			expect(decision.trusted).toBe(false);
		});

		it("trusts a signed executable with a different file digest", () => {
			expect(
				decidePeerTrust(
					peer({ executableSha256: "signed-digest", trustedSignature: true }),
					{ kind: "trusted-image", allowedExecutableSha256: ["pinned-digest"] },
					{ selfUid: OUR_UID },
				),
			).toEqual({ trusted: true });
		});

		it("rejects when the peer executable path is unknown", () => {
			const decision = decidePeerTrust(
				peer({ executablePath: null }),
				{ kind: "trusted-image", allowedExecutableSha256: ["pinned-digest"] },
				{ selfUid: OUR_UID },
			);
			expect(decision.trusted).toBe(false);
		});

		it("rejects when the allow-list is empty", () => {
			const decision = decidePeerTrust(
				peer({ executableSha256: "pinned-digest", trustedSignature: true }),
				{ kind: "trusted-image", allowedExecutableSha256: [] },
				{ selfUid: OUR_UID },
			);
			expect(decision.trusted).toBe(false);
		});

		it("rejects a listener owned by a different user", () => {
			const decision = decidePeerTrust(
				peer({ executablePath: "/apps/runtimed", executableSha256: "pinned-digest", uid: 0 }),
				{ kind: "trusted-image", allowedExecutableSha256: ["pinned-digest"] },
				{ selfUid: OUR_UID },
			);
			expect(decision.trusted).toBe(false);
		});
	});

	describe("platforms without a peer uid (Windows named pipes)", () => {
		it("skips the same-user check when the peer uid is unavailable", () => {
			expect(
				decidePeerTrust(
					peer({ pid: 4242, uid: null }),
					{ kind: "own-child", pid: 4242 },
					{ selfUid: OUR_UID },
				),
			).toEqual({ trusted: true });
		});
	});
});
