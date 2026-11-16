import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { removeWebRtcGlobals } from "./subframe-webrtc";

class RTCPeerConnection {}

/**
 * A fresh realm standing in for a frame's main world. The guard reaches it
 * the way Electron's `executeInMainWorld` does: as serialized source, so a
 * dependency on anything outside the function would fail here.
 */
function frameRealm() {
	return vm.createContext({
		RTCPeerConnection,
		webkitRTCPeerConnection: RTCPeerConnection,
		RTCDataChannel: class {},
		RTCIceTransport: class {},
		RTCSessionDescription: class {},
		WebSocket: class {},
		fetch: () => undefined,
	});
}

const typeOf = (realm: vm.Context, name: string) => vm.runInContext(`typeof ${name}`, realm);

describe("removeWebRtcGlobals", () => {
	it("leaves a frame's realm with no way to open a peer connection", () => {
		const realm = frameRealm();

		vm.runInContext(`(${removeWebRtcGlobals.toString()})()`, realm);

		for (const name of [
			"RTCPeerConnection",
			"webkitRTCPeerConnection",
			"RTCDataChannel",
			"RTCIceTransport",
			"RTCSessionDescription",
		]) {
			expect(typeOf(realm, name)).toBe("undefined");
		}
	});

	it("keeps the rest of the page's platform", () => {
		const realm = frameRealm();

		vm.runInContext(`(${removeWebRtcGlobals.toString()})()`, realm);

		expect(typeOf(realm, "WebSocket")).toBe("function");
		expect(typeOf(realm, "fetch")).toBe("function");
	});
});
