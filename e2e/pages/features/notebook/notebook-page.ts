import {
	expectElementToBeVisible,
	expectPageToContainURL,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * The `runtimed` daemon is not bundled yet and nteract's bundle is not served
 * from our protocol, so this page object deliberately asserts only what holds
 * with no Python daemon present: the notebook surface renders, and the feature's
 * `status` channel answers with a bound relay port — which proves the
 * main-process feature booted and registered its channel in the packaged binary.
 */

/** Shape of `window.desktopApi.invoke` — see apps/desktop/src/preload/preload.ts. */
type DesktopBridge = {
	invoke?: (
		channel: string,
		input: { featureId: string; channel: string; args?: unknown },
	) => Promise<unknown>;
};

/** `IpcResult<NotebookStatus>` — see packages/contracts/src/{result,features/notebook}.ts. */
type NotebookStatusResult =
	| { ok: true; value: { relayPort: number; daemon: unknown } }
	| { ok: false; error: { message: string } };

export class NotebookPage {
	private readonly view = () => getLocatorByTestId("notebook-view");

	async verifySurfaceIsOpen(): Promise<void> {
		await expectPageToContainURL(/#\/notebook/, {
			message: "Notebook nav item should route the hash history to /notebook",
		});
		await expectElementToBeVisible(
			this.view(),
			"Notebook view should render on the notebook route",
		);
	}

	/**
	 * Invokes `notebook:status` through the preload bridge's generic
	 * `feature:invoke` channel. `daemon` is intentionally not asserted: it is
	 * null until the daemon ships as a sidecar.
	 */
	async verifyStatusChannelReportsBoundRelay(): Promise<void> {
		const result = await getPage().evaluate(async (): Promise<NotebookStatusResult> => {
			const bridge = (globalThis as { desktopApi?: DesktopBridge }).desktopApi;
			if (typeof bridge?.invoke !== "function") {
				return { ok: false, error: { message: "window.desktopApi.invoke is unavailable" } };
			}
			return (await bridge.invoke("feature:invoke", {
				featureId: "notebook",
				channel: "status",
			})) as NotebookStatusResult;
		});

		if (!result.ok) {
			throw new Error(`Expected notebook:status to succeed, got error "${result.error.message}"`);
		}
		const { relayPort } = result.value;
		if (typeof relayPort !== "number" || relayPort <= 0) {
			throw new Error(
				`Expected notebook:status to report a bound loopback relay port, got "${String(relayPort)}"`,
			);
		}
	}
}
