import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDomain, useDomainState, useSdk } from "@kilo-desktop/kernel/web";
import type { PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { Theme } from "@kilo-desktop/plugin-shell/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { PaneCloseDialog } from "@kilo-desktop/ui/components/pane-close-dialog";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { CircleAlertIcon, NotebookIcon, RefreshCwIcon } from "lucide-react";

import {
	NOTEBOOK_HOST_PORT,
	NOTEBOOK_PANE_METADATA,
	NOTEBOOK_THEME_READY_MESSAGE_TYPE,
	NTERACT_ELECTRON_HOST_PROTOCOL_VERSION,
	notebookFileOf,
	notebookIdOf,
	notebookOpenState,
	Notebooks,
} from "../contracts/index.js";
import { useCloseGuard } from "./close-guards.js";
import { KiloSignInGate } from "./KiloSignInGate.js";
import { DESKTOP_SCHEME_PREFIX, notebookHostConnectionArgs, nteractSrc } from "./notebook-frame.js";
import { notebookThemeMessage, notebookThemeTokensFromDocument } from "./notebook-theme.js";

type RuntimeState =
	| { readonly status: "checking" }
	| { readonly status: "available" }
	| { readonly status: "unavailable"; readonly reason: string };

const selectMode = (state: { mode: "light" | "dark" }) => state.mode;

/**
 * The Notebook pane: nteract's notebook UI framed from its own protocol host,
 * talking to its notebook in main over a port the window opens and hands to
 * the frame (the daemon socket never reaches a renderer). Embedded notebooks
 * require a Kilo account, so the pane sits behind the sign-in
 * gate; while signed out the frame is unmounted and the daemon keeps the
 * notebook, which reconnects once the person signs in.
 */
export function NotebookPane(props: PaneProps) {
	return (
		<div className="bg-pane flex min-h-0 flex-1 flex-col">
			<KiloSignInGate featureName="Notebooks" pendingFallback={<NotebookPaneLoading />}>
				<NotebookPaneContent {...props} />
			</KiloSignInGate>
		</div>
	);
}

function NotebookPaneLoading() {
	return (
		<Empty data-qa-id="notebook-view-loading">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Spinner aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>Loading notebook…</EmptyTitle>
			</EmptyHeader>
		</Empty>
	);
}

function Waiting({ qaId, title }: { readonly qaId: string; readonly title: string }) {
	return (
		<Empty data-qa-id={qaId}>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Spinner aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
			</EmptyHeader>
		</Empty>
	);
}

function NotebookPaneContent({ sessionId, pane, directory }: PaneProps) {
	const sdk = useSdk();
	const notebooks = useDomain(Notebooks);
	const mode = useDomainState(Theme, selectMode) ?? "light";
	const { metadata, title } = pane;
	const notebookId = notebookIdOf(pane);
	const openState = notebookOpenState(metadata);
	const dirty = useDomainState(Notebooks, (state) =>
		notebookId ? state.dirty[notebookId] === true : false,
	);
	const viewRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const frameSrc = notebookId ? nteractSrc(notebookId) : undefined;
	const desktopFrame = frameSrc?.startsWith(DESKTOP_SCHEME_PREFIX) ?? false;
	const [retryVersion, setRetryVersion] = useState(0);
	const [runtime, setRuntime] = useState<RuntimeState>(
		desktopFrame ? { status: "checking" } : { status: "available" },
	);
	// New untitled notebooks settle their workspace environment.yml before the
	// frame connects: the daemon picks the environment when the room is created.
	const untitled = !notebookFileOf(pane);
	const needsEnvironment = desktopFrame && untitled && directory !== null;
	const [environmentReady, setEnvironmentReady] = useState(!needsEnvironment);
	const [closeRequest, setCloseRequest] = useState<((close: boolean) => void) | null>(null);

	useEffect(() => {
		if (notebookId || openState === "error" || !notebooks) return;
		void notebooks.methods.resolvePane({ sessionId, paneId: pane.id }).catch(() => undefined);
	}, [notebookId, notebooks, openState, pane.id, sessionId]);

	const closeGuard = useMemo(
		() =>
			dirty && notebookId
				? () => new Promise<boolean>((resolve) => setCloseRequest(() => resolve))
				: null,
		[dirty, notebookId],
	);
	useCloseGuard(sessionId, pane.id, closeGuard);

	useEffect(() => {
		if (!desktopFrame || !notebooks) return;
		let active = true;
		setRuntime({ status: "checking" });
		void notebooks.methods.status(undefined).then(
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
	}, [desktopFrame, notebooks, retryVersion]);

	useEffect(() => {
		if (!needsEnvironment || !notebookId || !directory || !notebooks) return;
		if (runtime.status !== "available") return;
		let active = true;
		setEnvironmentReady(false);
		// Whatever the outcome, the notebook opens: the environment file is a convenience.
		const open = () => active && setEnvironmentReady(true);
		void notebooks.methods
			.prepareEnvironment({ notebookId, workingDirectory: directory })
			.then(open, open);
		return () => {
			active = false;
		};
	}, [directory, needsEnvironment, notebookId, notebooks, runtime.status]);

	useEffect(() => {
		if (!frameSrc || !notebookId) return;
		const frameUrl = new URL(frameSrc);
		if (!frameUrl.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) return;
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;

		let port: MessagePort | null = null;
		let transferred = false;
		const onMessage = (event: MessageEvent<unknown>) => {
			const frameWindow = frameRef.current?.contentWindow;
			if (event.source !== frameWindow || event.origin !== frameOrigin) return;
			const message = event.data as {
				type?: unknown;
				protocolVersion?: unknown;
				capabilities?: unknown;
			} | null;
			if (
				message?.type !== "nteract:electron-host-ready" ||
				message.protocolVersion !== NTERACT_ELECTRON_HOST_PROTOCOL_VERSION ||
				transferred ||
				!frameWindow
			) {
				return;
			}
			const supportsRailPresentation =
				Array.isArray(message.capabilities) && message.capabilities.includes("presentation.rail");
			port = sdk.ports.open(
				NOTEBOOK_HOST_PORT,
				notebookHostConnectionArgs({ notebookId, sessionId, title, directory, metadata }),
			);
			try {
				frameWindow.postMessage(
					{
						type: "nteract:electron-host-connect",
						bootstrap: {
							protocolVersion: NTERACT_ELECTRON_HOST_PROTOCOL_VERSION,
							outputDocumentUrl: `${frameOrigin}/output-frame.html`,
							...(supportsRailPresentation
								? {
										presentation: {
											rail: { visible: true, side: "right", initialCollapsed: true },
										},
									}
								: {}),
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
	}, [directory, frameSrc, metadata, notebookId, sdk, sessionId, title]);

	useEffect(() => {
		if (!frameSrc) return;
		const frameUrl = new URL(frameSrc);
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;
		const postTheme = (contentWindow: Window) => {
			contentWindow.postMessage(
				notebookThemeMessage(
					{ mode },
					notebookThemeTokensFromDocument(
						viewRef.current ?? document.documentElement,
						"--pane-surface",
					),
				),
				frameOrigin,
			);
		};
		const onMessage = (event: MessageEvent<unknown>) => {
			const frameWindow = frameRef.current?.contentWindow;
			if (event.source !== frameWindow || event.origin !== frameOrigin || !frameWindow) return;
			const message = event.data as { type?: unknown } | null;
			if (message?.type !== NOTEBOOK_THEME_READY_MESSAGE_TYPE) return;
			postTheme(frameWindow);
		};
		window.addEventListener("message", onMessage);
		const frameWindow = frameRef.current?.contentWindow;
		if (frameWindow) postTheme(frameWindow);
		return () => window.removeEventListener("message", onMessage);
	}, [mode, frameSrc]);

	const settleClose = useCallback(
		(close: boolean) => {
			closeRequest?.(close);
			setCloseRequest(null);
		},
		[closeRequest],
	);

	return (
		<div ref={viewRef} className="bg-pane flex min-h-0 flex-1 flex-col" data-qa-id="notebook-view">
			{openState === "error" ? (
				<Empty data-qa-id="notebook-file-open-error">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CircleAlertIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>Could not open the notebook</EmptyTitle>
						<EmptyDescription>
							{metadata[NOTEBOOK_PANE_METADATA.openError] ??
								"The notebook file could not be opened."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : !notebookId ? (
				<Waiting qaId="notebook-file-opening" title="Opening notebook…" />
			) : !frameSrc ? (
				<Empty data-qa-id="notebook-placeholder">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<NotebookIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>Notebook unavailable</EmptyTitle>
						<EmptyDescription>
							The notebook interface is not bundled in this build.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : runtime.status === "checking" ? (
				<Waiting qaId="notebook-runtime-starting" title="Starting the notebook runtime…" />
			) : runtime.status === "unavailable" ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CircleAlertIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>Could not start the notebook runtime</EmptyTitle>
						<EmptyDescription data-qa-id="notebook-runtime-error">
							{runtime.reason}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button
							type="button"
							variant="outline"
							data-qa-id="notebook-runtime-retry"
							onClick={() => setRetryVersion((version) => version + 1)}
						>
							<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
							Try again
						</Button>
					</EmptyContent>
				</Empty>
			) : !environmentReady ? (
				<Waiting
					qaId="notebook-environment-preparing"
					title="Preparing the notebook environment…"
				/>
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
			{closeRequest && notebookId && notebooks ? (
				<PaneCloseDialog
					title={title}
					onSave={async () => {
						const result = await notebooks.methods.save({ notebookId });
						if (result.outcome === "failed") return result.reason ?? `Could not save ${title}.`;
						if (result.outcome === "saved") settleClose(true);
						return null;
					}}
					onDiscard={async () => settleClose(true)}
					onCancel={() => settleClose(false)}
				/>
			) : null}
		</div>
	);
}
