import { useEffect, useRef, useState } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";

import {
	NTERACT_ELECTRON_HOST_PROTOCOL_VERSION,
	NOTEBOOK_DIRTY_CHANGED_EVENT,
	NOTEBOOK_HOST,
	notebookDirtyChangedSchema,
	type NotebookService,
} from "../../contracts/schemas.js";
import { notebookIdFromInstanceId } from "./notebook-tabs.js";
import type { ChatRightPanelCapabilities } from "./notebook-webmcp-tools.js";

/**
 * nteract's notebook UI is a private workspace app whose execution path needs
 * the `runtimed` daemon over its local transport. Electron transfers one
 * feature-scoped MessagePort into the frame; the daemon socket is never exposed
 * to either renderer.
 *
 * In the desktop app the bundle is served from its own protocol host, which
 * frames here. Browser mode has no custom protocol at all, so it still needs
 * `VITE_NTERACT_ORIGIN` pointing at nteract's dev server.
 */
/**
 * Matches both the production and `-dev` desktop schemes. Not imported from
 * main's `ElectronProtocol`, which the web app cannot reach; the prefix is all
 * this needs, and getting it wrong falls back to browser mode rather than
 * framing a wrong origin.
 */
const DESKTOP_SCHEME_PREFIX = "anaconda-agentic-desktop";

/**
 * The renderer cannot read `app.isPackaged`, so it cannot derive the scheme —
 * but it does not need to: its own origin already carries the right one, and
 * only the host differs. Returns undefined off the custom protocol (browser
 * mode), where the notebook host does not exist.
 */
export function notebookOriginFrom(appOrigin: string): string | undefined {
	let url: URL;
	try {
		url = new URL(appOrigin);
	} catch {
		return undefined;
	}
	if (!url.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) return undefined;
	// Assembled rather than read off `url.origin`, which is "null" for a scheme
	// the URL parser does not know is special.
	return `${url.protocol}//${NOTEBOOK_HOST}`;
}

export function appOriginFromLocation(location: Pick<Location, "protocol" | "host">): string {
	return `${location.protocol}//${location.host}`;
}

/** Read at render time, not module scope, so tests can drive both branches. */
export function nteractSrcFor(
	instanceId: string,
	location: Pick<Location, "protocol" | "host">,
	developmentOrigin?: string,
): string | undefined {
	const appOrigin = appOriginFromLocation(location);
	const origin = notebookOriginFrom(appOrigin) ?? developmentOrigin;
	if (!origin) return undefined;
	const url = new URL(origin);
	url.searchParams.set("notebook_id", notebookIdFromInstanceId(instanceId));
	if (url.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) {
		url.searchParams.set("nteract-host", "electron");
		url.searchParams.set("nteract-parent-origin", appOrigin);
	}
	return url.toString();
}

/** Read at render time, not module scope, so tests can drive browser configuration. */
export function nteractSrc(instanceId: string): string | undefined {
	return nteractSrcFor(
		instanceId,
		window.location,
		import.meta.env["VITE_NTERACT_ORIGIN"] as string | undefined,
	);
}

/** Context supplied by Kilo's `chat-right-panel-tab` extension point. */
export interface NotebookViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
	readonly workspaceDirectory?: string;
}

export function NotebookView({
	instanceId,
	sessionId,
	title,
	workspaceDirectory,
}: NotebookViewProps) {
	const sdk = useSdk<NotebookService>("notebook");
	const notebookId = notebookIdFromInstanceId(instanceId);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const frameSrc = nteractSrc(instanceId);
	const desktopFrame = frameSrc?.startsWith(DESKTOP_SCHEME_PREFIX) ?? false;
	const [retryVersion, setRetryVersion] = useState(0);
	const [runtime, setRuntime] = useState<
		| { readonly status: "checking" }
		| { readonly status: "available" }
		| { readonly status: "unavailable"; readonly reason: string }
	>(desktopFrame ? { status: "checking" } : { status: "available" });

	useEffect(() => {
		void sdk.client
			.setDefaultSaveDirectory({ notebookId, directory: workspaceDirectory ?? null })
			.catch(() => undefined);
	}, [notebookId, sdk, workspaceDirectory]);

	useEffect(() => {
		const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
		const unregisterLifecycle = panel?.registerTabLifecycle?.(sessionId, instanceId, {
			save: () => sdk.client.save({ notebookId }),
			discard: async () => undefined,
		});
		const unsubscribeDirty = sdk.events.on(NOTEBOOK_DIRTY_CHANGED_EVENT, (payload) => {
			const parsed = notebookDirtyChangedSchema.safeParse(payload);
			if (
				!parsed.success ||
				parsed.data.notebookId !== notebookId ||
				parsed.data.sessionId !== sessionId
			) {
				return;
			}
			panel?.setTabDirty?.(sessionId, instanceId, parsed.data.dirty);
		});
		return () => {
			unsubscribeDirty();
			unregisterLifecycle?.();
		};
	}, [instanceId, notebookId, sdk, sessionId]);

	useEffect(() => {
		if (!desktopFrame) return;
		let active = true;
		setRuntime({ status: "checking" });
		void sdk.client.status().then(
			(result) => {
				if (!active) return;
				setRuntime(
					result.availability.status === "available"
						? { status: "available" }
						: {
								status: "unavailable",
								reason: result.availability.reason ?? "The notebook runtime daemon is unavailable.",
							},
				);
			},
			(error: unknown) => {
				if (!active) return;
				setRuntime({
					status: "unavailable",
					reason: error instanceof Error ? error.message : "Could not start the notebook runtime.",
				});
			},
		);
		return () => {
			active = false;
		};
	}, [desktopFrame, retryVersion, sdk]);

	useEffect(() => {
		if (!frameSrc) return;
		const frameUrl = new URL(frameSrc);
		if (!frameUrl.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) return;
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;

		let port: MessagePort | null = null;
		let transferred = false;
		const onMessage = (event: MessageEvent<unknown>) => {
			const frameWindow = frameRef.current?.contentWindow;
			if (event.source !== frameWindow || event.origin !== frameOrigin) return;
			const message = event.data as { type?: unknown; protocolVersion?: unknown } | null;
			if (
				message?.type !== "nteract:electron-host-ready" ||
				message.protocolVersion !== NTERACT_ELECTRON_HOST_PROTOCOL_VERSION ||
				transferred ||
				!frameWindow
			) {
				return;
			}
			port = sdk.ports.open<MessagePort>("host", {
				notebookId,
				sessionId,
				title,
			});
			try {
				frameWindow.postMessage(
					{
						type: "nteract:electron-host-connect",
						bootstrap: {
							protocolVersion: NTERACT_ELECTRON_HOST_PROTOCOL_VERSION,
							outputDocumentUrl: `${frameOrigin}/output-frame.html`,
						},
					},
					frameOrigin,
					[port],
				);
				transferred = true;
			} catch (error) {
				port.close();
				port = null;
				throw error;
			}
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			if (!transferred) port?.close();
		};
	}, [frameSrc, notebookId, sdk, sessionId, title]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="notebook-view">
			{!frameSrc ? (
				<div
					className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm"
					data-qa-id="notebook-placeholder"
				>
					The notebook interface is not bundled in this build.
				</div>
			) : runtime.status === "checking" ? (
				<div
					className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm"
					data-qa-id="notebook-runtime-starting"
				>
					Starting the notebook runtime…
				</div>
			) : runtime.status === "unavailable" ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
					<p className="text-muted-foreground" data-qa-id="notebook-runtime-error">
						{runtime.reason}
					</p>
					<Button
						type="button"
						data-qa-id="notebook-runtime-retry"
						onClick={() => setRetryVersion((version) => version + 1)}
					>
						Retry
					</Button>
				</div>
			) : (
				// Deliberately no `sandbox` attribute. The trusted nteract application is
				// isolated from the app renderer by its dedicated protocol origin and CSP.
				// Untrusted notebook output is separately confined in output-frame.html.
				// Sandboxing this application frame while granting both scripts and its own
				// origin would add no boundary and would interfere with browser capabilities
				// the notebook shell legitimately uses.
				<iframe
					ref={frameRef}
					src={frameSrc}
					title="nteract notebook"
					className="min-h-0 flex-1 border-0"
					allow="clipboard-read; clipboard-write; fullscreen"
					data-qa-id="notebook-frame"
				/>
			)}
		</div>
	);
}
