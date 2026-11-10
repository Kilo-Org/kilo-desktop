/**
 * Strips WebRTC from a frame's JS realm. Subframes of an app window show
 * untrusted content (agent pages, MCP App widgets, embedded tool UIs), and a
 * content security policy cannot contain WebRTC: `connect-src` does not cover
 * ICE, so a page could reach any STUN/TURN server it names. The app itself
 * uses no WebRTC, so its subframes get none.
 *
 * The preload calls this in every subframe through Electron's
 * `executeInMainWorld`, which runs as each new realm is created and before
 * any of its own script, so a fresh realm (a `srcdoc` child, a frame
 * navigated to a `data:` or `blob:` document) starts without it too. The
 * function is serialized into that realm and must stay self-contained.
 */
export function removeWebRtcGlobals(): void {
	for (const name of Object.getOwnPropertyNames(globalThis)) {
		if (/^(?:webkit)?RTC/.test(name)) Reflect.deleteProperty(globalThis, name);
	}
}
