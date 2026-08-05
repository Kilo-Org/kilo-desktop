import {
	expectElementToBeVisible,
	expectPageToContainURL,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * nteract's bundle is not served from our protocol yet, so this page object
 * asserts the surface renders and the feature's `status` channel answers from the
 * packaged binary — now including that a daemon is actually reachable, which is
 * what proves the bundled sidecar spawned rather than merely shipping.
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
	| {
			ok: true;
			value: {
				relayPort: number;
				process: { status: string; reason?: string };
				daemon: { version: string } | null;
			};
	  }
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
	 * `feature:invoke` channel.
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

	/**
	 * Asserts the bundled sidecar is actually reachable, not merely shipped.
	 *
	 * `running` means we spawned it; `external` means one was already listening —
	 * both are successes, and which one occurs depends on whether the developer or
	 * CI machine happens to run an nteract daemon of the same channel, since they
	 * share a singleton lock. `failed` is the regression this guards: an
	 * unstageable binary, a spawn error, or a daemon that never binds.
	 *
	 * A non-null `daemon` is asserted too, because `process.status` alone would
	 * pass if the socket accepted but the handshake never completed.
	 */
	async verifyDaemonIsReachable(): Promise<void> {
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
		const { process: daemonProcess, daemon } = result.value;
		if (daemonProcess.status !== "running" && daemonProcess.status !== "external") {
			throw new Error(
				`Expected the bundled daemon to be running or already external, got "${daemonProcess.status}"` +
					(daemonProcess.reason ? ` (${daemonProcess.reason})` : ""),
			);
		}
		if (!daemon?.version) {
			throw new Error(
				`Expected a reachable daemon to report its version, got ${JSON.stringify(daemon)}`,
			);
		}
	}
}
