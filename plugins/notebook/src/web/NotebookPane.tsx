import { useEffect, useRef, useState } from "react";

import { useDomainObject, useDomainObjectState, useSdk } from "@kilo-desktop/kernel/web";
import { Theme } from "@kilo-desktop/plugin-shell/contracts";
import type { PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
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

const RUNTIME_CHECKING: RuntimeState = { status: "checking" };
const RUNTIME_AVAILABLE: RuntimeState = { status: "available" };

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

function NotebookPaneContent({ workSessionId, pane, directory }: PaneProps) {
	const sdk = useSdk();
	const notebooks = useDomainObject(Notebooks);
	const mode = useDomainObjectState(Theme, selectMode) ?? "light";
	const { object, metadata, title } = pane;
	const notebookId = notebookIdOf(pane);
	const openState = notebookOpenState(metadata);
	const dirty = useDomainObjectState(Notebooks, (state) =>
		notebookId ? state.dirty[notebookId] === true : false,
	);
	const viewRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const frameSrc = notebookId ? nteractSrc(notebookId) : undefined;
	const desktopFrame = frameSrc?.startsWith(DESKTOP_SCHEME_PREFIX) ?? false;
	const [retryVersion, setRetryVersion] = useState(0);
	// Each check is tagged with the attempt and handle it ran for; until a result
	// for the current pair lands, the runtime reads as "checking".
	const [runtimeCheck, setRuntimeCheck] = useState<{
		readonly attempt: number;
		readonly notebooks: typeof notebooks;
		readonly state: RuntimeState;
	}>();
	const runtime = !desktopFrame
		? RUNTIME_AVAILABLE
		: runtimeCheck?.attempt === retryVersion && runtimeCheck.notebooks === notebooks
			? runtimeCheck.state
			: RUNTIME_CHECKING;
	// New untitled notebooks settle their workspace environment.yml before the
	// frame connects: the daemon picks the environment when the room is created.
	const untitled = !notebookFileOf(pane);
	const needsEnvironment = desktopFrame && untitled && directory !== null;
	const [preparedEnvironment, setPreparedEnvironment] = useState<{
		readonly runtime: RuntimeState;
		readonly notebookId: string;
		readonly directory: string;
	}>();
	const environmentReady =
		!needsEnvironment ||
		(preparedEnvironment?.runtime === runtime &&
			preparedEnvironment.notebookId === notebookId &&
			preparedEnvironment.directory === directory);
	const [closeRequest, setCloseRequest] = useState<((close: boolean) => void) | null>(null);

	useEffect(() => {
		if (notebookId || openState === "error" || !notebooks) return;
		void notebooks.methods.resolvePane({ workSessionId, paneId: pane.id }).catch(() => undefined);
	}, [notebookId, notebooks, openState, pane.id, workSessionId]);

	const closeGuard =
		dirty && notebookId
			? () => new Promise<boolean>((resolve) => setCloseRequest(() => resolve))
			: null;
	useCloseGuard(workSessionId, pane.id, closeGuard);

	useEffect(() => {
		if (!desktopFrame || !notebooks) return;
		let active = true;
		const settle = (state: RuntimeState) => {
			if (active) setRuntimeCheck({ attempt: retryVersion, notebooks, state });
		};
		void notebooks.methods.status(undefined).then(
			(result) => {
				settle(
					result.availability.status === "available"
						? { status: "available" }
						: {
								status: "unavailable",
								reason: result.availability.reason ?? "The notebook runtime daemon is unavailable.",
							},
				);
			},
			(error: unknown) => {
				settle({
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
		// Whatever the outcome, the notebook opens: the environment file is a convenience.
		const open = () => {
			if (active) setPreparedEnvironment({ runtime, notebookId, directory });
		};
		void notebooks.methods
			.prepareEnvironment({ notebookId, workingDirectory: directory })
			.then(open, open);
		return () => {
			active = false;
		};
	}, [directory, needsEnvironment, notebookId, notebooks, runtime]);

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
				notebookHostConnectionArgs({
					notebookId,
					workSessionId,
					title,
					directory,
					object,
					metadata,
				}),
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
	}, [directory, frameSrc, metadata, notebookId, object, sdk, workSessionId, title]);

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

	const settleClose = (close: boolean) => {
		closeRequest?.(close);
		setCloseRequest(null);
	};

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
				// react-doctor-disable-next-line react-doctor/iframe-missing-sandbox
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
