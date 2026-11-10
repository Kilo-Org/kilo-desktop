import { afterEach, describe, expect, it } from "vitest";

import { MCP_APP_SHELL_HTML_MESSAGE, MCP_APP_SHELL_READY_MESSAGE } from "../../contracts";
import { mcpAppShellHtml } from "../../main/html-render";

const PROBE = `<!doctype html><body><script>
	parent.postMessage({
		kind: "probe",
		peerConnection: typeof RTCPeerConnection,
		legacyPeerConnection: typeof webkitRTCPeerConnection,
		dataChannel: typeof RTCDataChannel,
		iceTransport: typeof RTCIceTransport,
	}, "*");
</script></body>`;

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
	for (const frame of frames.splice(0)) frame.remove();
});

/** Loads the shell the `mcp-app` host serves in a sandboxed frame and hands it `html`. */
function showInShell(html: string): Promise<Record<string, unknown>> {
	const frame = document.createElement("iframe");
	frame.sandbox.add("allow-scripts");
	frame.src = URL.createObjectURL(new Blob([mcpAppShellHtml("Page")], { type: "text/html" }));
	frames.push(frame);
	return new Promise((resolve) => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow) return;
			if (event.data?.type === MCP_APP_SHELL_READY_MESSAGE) {
				frame.contentWindow?.postMessage({ type: MCP_APP_SHELL_HTML_MESSAGE, html }, "*");
			} else if (event.data?.kind === "probe") {
				window.removeEventListener("message", onMessage);
				resolve(event.data);
			}
		};
		window.addEventListener("message", onMessage);
		document.body.append(frame);
	});
}

describe("the mcp-app shell", () => {
	it("runs the page it is handed without WebRTC", async () => {
		expect(typeof RTCPeerConnection).toBe("function");

		expect(await showInShell(PROBE)).toEqual({
			kind: "probe",
			peerConnection: "undefined",
			legacyPeerConnection: "undefined",
			dataChannel: "undefined",
			iceTransport: "undefined",
		});
	});
});
