import { expect } from "@playwright/test";
import type { ElectronApplication } from "playwright";

const BROWSER_PARTITION = "persist:kilo-desktop-browser";
const CAPTURE_FLAG = "__kiloE2eCapturedOnBeforeRequest";

type CapturedScope = typeof globalThis & {
	[CAPTURE_FLAG]?: (
		details: unknown,
		callback: (response: { cancel?: boolean }) => void,
	) => unknown;
};

/**
 * The harness cannot commit a real remote top-frame in the guest (CI can only
 * bind loopback hosts), so instead of faking an origin this captures the real
 * `onBeforeRequest` guard the host registers and invokes it with crafted details.
 */
export class BrowserGuestSessionPage {
	constructor(private readonly app: ElectronApplication) {}

	async captureNetworkGuardBeforeFirstPane(): Promise<void> {
		await this.app.evaluate(
			({ session }, { partition, flag }) => {
				const scope = globalThis as typeof globalThis & {
					[key: string]: unknown;
				};
				const browserSession = session.fromPartition(partition);
				const webRequest = browserSession.webRequest;
				const register = webRequest.onBeforeRequest.bind(webRequest);
				webRequest.onBeforeRequest = ((listener: unknown) => {
					scope[flag] = listener;
					return register(listener as never);
				}) as typeof webRequest.onBeforeRequest;
			},
			{ partition: BROWSER_PARTITION, flag: CAPTURE_FLAG },
		);
	}

	async verifyRemoteEmbeddedLoopbackSubResourceIsCancelled(): Promise<void> {
		const cancel = await this.invokeNetworkGuard({
			url: "http://127.0.0.1:47830/output-frame",
			resourceType: "subFrame",
			topFrameUrl: "https://evil.example/",
		});
		expect(
			cancel,
			"A loopback sub-resource embedded by a remote top-frame should be cancelled",
		).toBe(true);
	}

	async verifyLoopbackMainFrameNavigationIsAllowed(): Promise<void> {
		const cancel = await this.invokeNetworkGuard({
			url: "http://127.0.0.1:5000/",
			resourceType: "mainFrame",
		});
		expect(
			cancel,
			"A loopback top-level navigation should remain allowed for local dev browsing",
		).toBe(false);
	}

	private async invokeNetworkGuard(request: {
		url: string;
		resourceType: string;
		topFrameUrl?: string;
	}): Promise<boolean> {
		return this.app.evaluate(
			async (_electron, { flag, url, resourceType, topFrameUrl }) => {
				const listener = (globalThis as CapturedScope)[flag as typeof CAPTURE_FLAG];
				if (!listener) {
					throw new Error(
						"Browser partition onBeforeRequest guard was not captured before the first pane opened",
					);
				}
				const details = {
					url,
					resourceType,
					...(topFrameUrl ? { frame: { top: { url: topFrameUrl } } } : {}),
				};
				const decision = await new Promise<{ cancel?: boolean }>((resolve) => {
					const result = listener(details, resolve);
					if (result && typeof (result as PromiseLike<unknown>).then === "function") {
						void (result as PromiseLike<{ cancel?: boolean }>).then(resolve);
					}
				});
				return decision.cancel === true;
			},
			{
				flag: CAPTURE_FLAG,
				url: request.url,
				resourceType: request.resourceType,
				topFrameUrl: request.topFrameUrl,
			},
		);
	}
}
