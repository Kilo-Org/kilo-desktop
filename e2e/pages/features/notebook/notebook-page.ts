import {
	expectElementToBeVisible,
	expectElementToContainAttribute,
	expectPageToContainURL,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { test } from "@playwright/test";

/**
 * Asserts the surface renders, frames the notebook protocol host, and that the
 * feature's `status` channel answers from the packaged binary. A live-daemon
 * assertion is opt-in because the app never ships or starts runtimed itself.
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
				availability: { status: string; reason?: string };
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
	 * Asserts an externally bootstrapped singleton is reachable. Ordinary package
	 * smoke does not require one; set `RUNTIMED_E2E_EXTERNAL=1` in the environment
	 * that started runtimed to exercise the real attach path.
	 */
	async verifyDaemonIsReachable(): Promise<void> {
		if (process.env["RUNTIMED_E2E_EXTERNAL"] !== "1") {
			test.info().annotations.push({
				type: "skipped-assertion",
				description: "external runtimed reachability unchecked (set RUNTIMED_E2E_EXTERNAL=1)",
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
		const { availability, daemon } = result.value;
		if (availability.status !== "available") {
			throw new Error(
				`Expected the external daemon to be available, got "${availability.status}"` +
					(availability.reason ? ` (${availability.reason})` : ""),
			);
		}
		if (!daemon?.version) {
			throw new Error(
				`Expected a reachable daemon to report its version, got ${JSON.stringify(daemon)}`,
			);
		}
	}
}
