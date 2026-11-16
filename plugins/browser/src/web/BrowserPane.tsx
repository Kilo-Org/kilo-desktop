import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CircleAlertIcon,
	EllipsisVerticalIcon,
	GlobeIcon,
	MinusIcon,
	PlusIcon,
	RefreshCwIcon,
	RotateCcwIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentProps,
	type FormEvent,
} from "react";

import { KernelOs, type DomainObjectHandle, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { InputGroup, InputGroupInput } from "@kilo-desktop/ui/components/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	BrowserPages,
	normalizeBrowserUrl,
	pageKey,
	paneUrl,
	type PageCommand,
} from "../contracts/index.js";
import type { ElectronWebview } from "./browser-types.js";
import { acquireBrowserGuest, type BrowserGuestLease } from "./browser-guest-lease.js";
import { useLoadingProgress } from "./use-loading-progress.js";

function IconButton({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props} />
				}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

type BrowserPagesHandle = DomainObjectHandle<typeof BrowserPages>;

const message = (cause: unknown, fallback: string) =>
	cause instanceof Error ? cause.message : fallback;

/**
 * A Browser pane: origin's toolbar (back, forward, refresh, address bar,
 * menu) over a `<webview>` guest that main drives through `pages`. The guest
 * lives outside React (`acquireBrowserGuest`) and is laid over the pane's
 * surface, so it survives re-renders and is shown only while the pane is.
 */
export function BrowserPane({ workSessionId, pane, visible }: PaneProps) {
	const pages = useDomainObject(BrowserPages);
	if (!pages) return <BrowserUnavailable />;
	return (
		<BrowserPageView pages={pages} workSessionId={workSessionId} pane={pane} visible={visible} />
	);
}

function BrowserUnavailable() {
	return (
		<Empty data-qa-id="browser-unavailable">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<GlobeIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>The browser isn't available here</EmptyTitle>
				<EmptyDescription>Web pages open in the desktop app.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function BrowserPageView({
	pages,
	workSessionId,
	pane,
	visible,
}: Pick<PaneProps, "workSessionId" | "pane" | "visible"> & { readonly pages: BrowserPagesHandle }) {
	const os = useDomainObject(KernelOs);
	const paneId = pane.id;
	const key = pageKey(workSessionId, paneId);
	const state = useDomainObjectState(
		BrowserPages,
		useCallback((all: DomainObjectState<typeof BrowserPages>) => all.pages[key], [key]),
	);
	const restoredUrl = paneUrl(pane);
	const initialUrlRef = useRef(restoredUrl);
	const [partition, setPartition] = useState<string>();
	const [draft, setDraft] = useState(restoredUrl);
	const [focused, setFocused] = useState(false);
	const [error, setError] = useState<string>();
	const [menuOpen, setMenuOpen] = useState(false);
	const [guestLease, setGuestLease] = useState<BrowserGuestLease>();
	const [attachmentReady, setAttachmentReady] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const webviewRef = useRef<ElectronWebview | null>(null);
	const attachedIdRef = useRef<number | undefined>(undefined);
	const attachmentRetryPendingRef = useRef(false);
	const attachmentReadyRef = useRef(false);
	const crashCountRef = useRef(0);
	const pendingUrlRef = useRef<string | undefined>(undefined);
	const ready = attachmentReady;
	const currentUrl = state?.url || restoredUrl;
	const hasUrl = Boolean(currentUrl);
	const zoom = Math.round((state?.zoomFactor ?? 1) * 100);
	const loadProgress = useLoadingProgress(hasUrl && (state?.loading ?? false));
	const target = { workSessionId, paneId };

	useLayoutEffect(() => {
		if (!partition) return;
		const lease = acquireBrowserGuest(key, partition, initialUrlRef.current || "about:blank");
		webviewRef.current = lease.webview;
		setGuestLease(lease);
		return () => lease.release();
	}, [key, partition]);

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		const webviewHost = guestLease?.host;
		if (!surface || !webviewHost) return;
		let frame = 0;
		const update = () => {
			frame = 0;
			const rect = surface.getBoundingClientRect();
			const paneFrame = surface.closest<HTMLElement>('[data-qa-id="chat-pane-frame"]');
			const paneFrameStyle = paneFrame ? getComputedStyle(paneFrame) : undefined;
			const shown =
				visible &&
				hasUrl &&
				!state?.failure &&
				surface.isConnected &&
				rect.width > 0 &&
				rect.height > 0;
			Object.assign(webviewHost.style, {
				display: shown ? "block" : "none",
				left: `${Math.round(rect.left)}px`,
				top: `${Math.round(rect.top)}px`,
				width: `${Math.round(rect.width)}px`,
				height: `${Math.round(rect.height)}px`,
				borderBottomLeftRadius: paneFrameStyle?.borderBottomLeftRadius ?? "0px",
				borderBottomRightRadius: paneFrameStyle?.borderBottomRightRadius ?? "0px",
			});
		};
		const scheduleUpdate = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		const resizeObserver = new ResizeObserver(scheduleUpdate);
		resizeObserver.observe(surface);
		const mutationObserver = new MutationObserver(scheduleUpdate);
		mutationObserver.observe(document.body, { childList: true, subtree: true });
		window.addEventListener("resize", scheduleUpdate);
		window.addEventListener("scroll", scheduleUpdate, true);
		update();
		return () => {
			if (frame) cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			window.removeEventListener("resize", scheduleUpdate);
			window.removeEventListener("scroll", scheduleUpdate, true);
			webviewHost.style.display = "none";
		};
	}, [guestLease, hasUrl, state?.failure, visible]);

	useEffect(() => {
		if (!focused && state) setDraft(state.url);
	}, [focused, state]);

	useEffect(() => {
		let cancelled = false;
		pages.methods.prepare(undefined).then(
			({ partition: next }) => {
				if (!cancelled) setPartition(next);
			},
			(cause: unknown) => {
				if (!cancelled) setError(message(cause, "The browser isn't available."));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [pages]);

	useEffect(() => {
		if (restoredUrl) return;
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [restoredUrl]);

	useEffect(
		() => () => {
			attachmentRetryPendingRef.current = false;
			attachmentReadyRef.current = false;
			const webContentsId = attachedIdRef.current;
			if (webContentsId) {
				void pages.methods.detach({ workSessionId, paneId, webContentsId }).catch(() => undefined);
			}
		},
		[pages, paneId, workSessionId],
	);

	const attach = useCallback(
		function attemptAttachment() {
			const webview = webviewRef.current;
			if (!webview) return;
			try {
				const webContentsId = webview.getWebContentsId();
				if (!Number.isInteger(webContentsId) || webContentsId <= 0) return;
				if (attachedIdRef.current === webContentsId) {
					if (!attachmentReadyRef.current) attachmentRetryPendingRef.current = true;
					return;
				}
				attachedIdRef.current = webContentsId;
				attachmentRetryPendingRef.current = false;
				attachmentReadyRef.current = false;
				setAttachmentReady(false);
				void pages.methods
					.attach({ workSessionId, paneId, webContentsId })
					.then(() => {
						if (attachedIdRef.current !== webContentsId) return;
						attachmentRetryPendingRef.current = false;
						attachmentReadyRef.current = true;
						setAttachmentReady(true);
						const pendingUrl = pendingUrlRef.current;
						if (!pendingUrl) return;
						pendingUrlRef.current = undefined;
						return pages.methods.navigate({ workSessionId, paneId, url: pendingUrl });
					})
					.catch((cause: unknown) => {
						if (attachedIdRef.current !== webContentsId) return;
						attachmentReadyRef.current = false;
						setAttachmentReady(false);
						attachedIdRef.current = undefined;
						if (attachmentRetryPendingRef.current) {
							attachmentRetryPendingRef.current = false;
							queueMicrotask(attemptAttachment);
							return;
						}
						setError(message(cause, "Unable to attach browser tab."));
					});
			} catch {
				// The guest has not attached yet; did-attach and dom-ready retry.
			}
		},
		[pages, paneId, workSessionId],
	);
	const closeMenu = useCallback(() => setMenuOpen(false), []);
	useLayoutEffect(() => {
		const webview = guestLease?.webview;
		if (!webview || !partition) return;
		let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const recover = () => {
			if (crashCountRef.current >= 3) {
				setError("The browser process stopped repeatedly. Close and reopen this tab to retry.");
				return;
			}
			crashCountRef.current += 1;
			recoveryTimer = setTimeout(() => webview.reload(), 250 * crashCountRef.current);
		};
		webview.addEventListener("did-attach", attach);
		webview.addEventListener("dom-ready", attach);
		webview.addEventListener("focus", closeMenu);
		webview.addEventListener("render-process-gone", recover);
		attach();
		return () => {
			if (recoveryTimer) clearTimeout(recoveryTimer);
			webview.removeEventListener("did-attach", attach);
			webview.removeEventListener("dom-ready", attach);
			webview.removeEventListener("focus", closeMenu);
			webview.removeEventListener("render-process-gone", recover);
		};
	}, [attach, closeMenu, guestLease, partition]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		try {
			const url = normalizeBrowserUrl(draft);
			setError(undefined);
			setDraft(url);
			inputRef.current?.blur();
			if (!attachmentReadyRef.current) {
				pendingUrlRef.current = url;
				return;
			}
			void pages.methods.navigate({ ...target, url }).catch((cause: unknown) => {
				setError(message(cause, "Unable to navigate."));
			});
		} catch (cause) {
			setError(message(cause, "Enter a valid URL."));
		}
	};

	const command = (name: PageCommand) => () =>
		void pages.methods.command({ ...target, command: name }).catch((cause: unknown) => {
			setError(message(cause, "Unable to run browser command."));
		});
	const openInDefaultBrowser = () => {
		void (os?.methods.openExternal({ url: currentUrl }) ?? Promise.resolve(false))
			.catch(() => false)
			.then((opened) => {
				if (!opened) setError("Unable to open this page in your default browser.");
			});
	};
	return (
		<div
			className="bg-pane flex min-h-0 flex-1 flex-col"
			data-qa-id="browser-view"
			aria-busy={!ready}
		>
			<div className="relative shrink-0">
				<form className="flex h-10 items-center gap-1 px-2" onSubmit={submit}>
					<div className="flex items-center" role="group" aria-label="Browser navigation">
						<IconButton
							label="Back"
							data-qa-id="browser-back"
							disabled={!state?.canGoBack}
							onClick={command("back")}
						>
							<ArrowLeftIcon />
						</IconButton>
						<IconButton
							label="Forward"
							data-qa-id="browser-forward"
							disabled={!state?.canGoForward}
							onClick={command("forward")}
						>
							<ArrowRightIcon />
						</IconButton>
						<IconButton
							label="Refresh"
							data-qa-id="browser-refresh"
							disabled={!ready || !hasUrl}
							onClick={command("reload")}
						>
							<RefreshCwIcon className={cn(state?.loading && "animate-spin")} />
						</IconButton>
					</div>
					<InputGroup size="sm" variant="filled" className="flex-1">
						<InputGroupInput
							ref={inputRef}
							value={focused ? draft : (state?.url ?? draft)}
							onChange={(event) => setDraft(event.target.value)}
							onFocus={(event) => {
								setFocused(true);
								setDraft(state?.url ?? draft);
								event.currentTarget.select();
							}}
							onBlur={() => setFocused(false)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setDraft(state?.url ?? restoredUrl);
									event.currentTarget.blur();
									setError(undefined);
								}
							}}
							placeholder="Enter URL"
							spellCheck={false}
							aria-label="URL"
							aria-invalid={Boolean(error)}
							data-qa-id="browser-url"
						/>
					</InputGroup>
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Browser menu"
									data-qa-id="browser-menu"
								>
									<EllipsisVerticalIcon />
								</Button>
							}
						/>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								disabled={!hasUrl}
								onClick={openInDefaultBrowser}
								data-qa-id="browser-open-external"
							>
								Open in Default Browser
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={!ready || !hasUrl}
								onClick={command("hardReload")}
								data-qa-id="browser-hard-reload"
							>
								Hard Reload
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={!ready}
								onClick={command("openDevTools")}
								data-qa-id="browser-open-devtools"
							>
								Open DevTools
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							{/* The controls sit beside the label, not in it: Base UI hides group
							    labels from the accessibility tree, which would hide them too. */}
							<DropdownMenuGroup className="flex items-center justify-between pe-2">
								<DropdownMenuLabel
									className={cn("text-foreground py-1 font-normal", !ready && "opacity-50")}
								>
									Zoom
								</DropdownMenuLabel>
								<span className="flex items-center gap-1">
									<Button
										type="button"
										variant="outline"
										size="icon-sm"
										aria-label="Zoom out"
										disabled={!ready || zoom <= 25}
										onClick={command("zoomOut")}
									>
										<MinusIcon />
									</Button>
									<span className="w-12 text-center text-xs tabular-nums">{zoom}%</span>
									<Button
										type="button"
										variant="outline"
										size="icon-sm"
										aria-label="Zoom in"
										disabled={!ready || zoom >= 500}
										onClick={command("zoomIn")}
									>
										<PlusIcon />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Reset zoom"
										disabled={!ready || zoom === 100}
										onClick={command("resetZoom")}
									>
										<RotateCcwIcon />
									</Button>
								</span>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</form>
				{loadProgress > 0 ? (
					<div
						aria-hidden="true"
						className="bg-primary-ink pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 rounded-r-full transition-all duration-150 ease-out"
						style={{ width: `${loadProgress}%`, boxShadow: "0 0 6px 1px var(--color-ring)" }}
						data-qa-id="browser-load-progress"
					/>
				) : null}
			</div>
			{error ? (
				<p className="text-destructive px-3 py-1 text-xs" role="alert">
					{error}
				</p>
			) : null}
			<div ref={surfaceRef} className="relative min-h-0 flex-1">
				{!hasUrl ? (
					<Empty className="absolute inset-0">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<GlobeIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No page open</EmptyTitle>
							<EmptyDescription>Enter a URL to start browsing.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : null}
				{state?.failure ? (
					<div className="bg-pane absolute inset-0 z-10 flex">
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<CircleAlertIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>Could not load this page</EmptyTitle>
								<EmptyDescription>{state.failure.description}</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button type="button" variant="outline" onClick={command("reload")}>
									<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
									Try again
								</Button>
							</EmptyContent>
						</Empty>
					</div>
				) : null}
			</div>
		</div>
	);
}
