import {
	expectElementToBeVisible,
	expectElementToContainAttribute,
	expectPageToContainURL,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { test } from "@playwright/test";

import { packagedDaemonExists } from "../../../utils/paths.js";

/**
 * Asserts the surface renders, frames the notebook protocol host, and that the
 * feature's `status` channel answers from the packaged binary — including that a
 * daemon is actually reachable, which is what proves the bundled sidecar spawned
 * rather than merely shipping.
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
	private readonly frame = () => getLocatorByTestId("notebook-frame");

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
	 * The frame must point at the notebook protocol **host**, not at a path under
	 * the app host — that separate origin is what carries the looser notebook CSP
	 * (D1). Asserting the `src` rather than the frame's content is deliberate: CI
	 * sets no `NTERACT_BUNDLE`, so the bundle root is legitimately absent there and
	 * the host answers 404. What can regress here is the origin the renderer
	 * derives, which is wrong in a packaged build the moment it falls back to
	 * `VITE_NTERACT_ORIGIN` or reassembles the scheme incorrectly.
	 */
	async verifyFramesTheNotebookOrigin(): Promise<void> {
		await expectElementToContainAttribute(
			this.frame(),
			"src",
			// The notebook path travels as a query param, not a route segment. The
			// slash is optional because Chromium emits one for this non-special
			// scheme where Node's URL parser does not.
			/^anaconda-agentic-desktop(-dev)?:\/\/notebook\/?\?path=/,
			{ message: "Notebook iframe should load the notebook protocol host" },
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
	 *
	 * Skipped when the build staged no daemon — the CI configuration, since
	 * `RUNTIMED_BINARY` is opt-in. Asserting there would fail every CI run for a
	 * build that is behaving exactly as designed. The skip is annotated rather
	 * than silent, so a run that covers less than it appears to says so.
	 */
	async verifyDaemonIsReachable(): Promise<void> {
		if (!packagedDaemonExists()) {
			test.info().annotations.push({
				type: "skipped-assertion",
				description:
					"daemon reachability unchecked: this build staged no runtimed (set RUNTIMED_BINARY)",
			});
			return;
		}
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
