import {
	ArrowLeftIcon,
	ArrowRightIcon,
	MinusIcon,
	MoreVerticalIcon,
	PlusIcon,
	RefreshCwIcon,
	RotateCcwIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
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
	browserStateSchema,
	BROWSER_STATE_CHANGED_EVENT,
	type BrowserService,
	type BrowserState,
} from "../contracts/browser.js";
import { normalizeBrowserUrl } from "../main/browser-url.js";
import type { ElectronWebview } from "./browser-types.js";
import { acquireBrowserGuest, type BrowserGuestLease } from "./browser-guest-lease.js";
import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";
import { useLoadingProgress } from "./use-loading-progress.js";

interface BrowserViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
	readonly metadata?: Readonly<Record<string, string>>;
}

function IconButton({ label, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
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

export function BrowserView({ sessionId, instanceId, title, metadata }: BrowserViewProps) {
	const sdk = useSdk<BrowserService>("browser");
	const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
	const restoredUrl = metadata?.["url"] ?? "";
	const initialUrlRef = useRef(restoredUrl);
	const [partition, setPartition] = useState<string>();
	const [state, setState] = useState<BrowserState>();
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
	const hasUrl = Boolean(state?.url || restoredUrl);
	const zoom = Math.round((state?.zoomFactor ?? 1) * 100);
	const loadProgress = useLoadingProgress(hasUrl && (state?.loading ?? false));

	useLayoutEffect(() => {
		if (!partition) return;
		const lease = acquireBrowserGuest(
			instanceId,
			partition,
			initialUrlRef.current || "about:blank",
		);
		webviewRef.current = lease.webview;
		setGuestLease(lease);
		return () => lease.release();
	}, [instanceId, partition]);

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
			const visible =
				hasUrl && !state?.failure && surface.isConnected && rect.width > 0 && rect.height > 0;
			Object.assign(webviewHost.style, {
				display: visible ? "block" : "none",
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
	}, [guestLease, hasUrl, state?.failure]);

	const receiveBrowserState = useEffectEvent((nextState: BrowserState) => {
		setState(nextState);
		if (!focused) setDraft(nextState.url);
	});

	useEffect(() => {
		void sdk.client.config().then(({ partition: next }) => setPartition(next));
		return sdk.events.on(BROWSER_STATE_CHANGED_EVENT, (payload) => {
			const parsed = browserStateSchema.safeParse(payload);
			if (!parsed.success || parsed.data.instanceId !== instanceId) return;
			receiveBrowserState(parsed.data);
		});
	}, [instanceId, sdk]);

	useEffect(() => {
		if (restoredUrl) return;
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [restoredUrl]);

	useEffect(() => {
		const url = state?.url;
		if (!url) return;
		const nextTitle = state.title.trim() || title;
		const faviconUrl = state.faviconUrl;
		if (
			url === metadata?.["url"] &&
			nextTitle === metadata?.["title"] &&
			faviconUrl === metadata?.["faviconUrl"]
		)
			return;
		panel?.updateTab(sessionId, instanceId, {
			title: nextTitle,
			iconKey: faviconUrl,
			metadata: {
				...(metadata ?? {}),
				url,
				title: nextTitle,
				faviconUrl,
			},
		});
	}, [instanceId, metadata, panel, sessionId, state?.faviconUrl, state?.title, state?.url, title]);

	useEffect(
		() =>
			panel?.registerTabLifecycle(sessionId, instanceId, {
				onClose: async () => {
					await sdk.client.close({ instanceId });
				},
			}),
		[instanceId, panel, sdk, sessionId],
	);

	useEffect(
		() => () => {
			attachmentRetryPendingRef.current = false;
			attachmentReadyRef.current = false;
			const webContentsId = attachedIdRef.current;
			if (webContentsId) void sdk.client.detach({ instanceId, webContentsId });
		},
		[instanceId, sdk],
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
				void sdk.client
					.attach({ instanceId, webContentsId })
					.then((nextState) => {
						if (attachedIdRef.current !== webContentsId) return;
						attachmentRetryPendingRef.current = false;
						attachmentReadyRef.current = true;
						setAttachmentReady(true);
						setState(nextState);
						const pendingUrl = pendingUrlRef.current;
						if (!pendingUrl) return;
						pendingUrlRef.current = undefined;
						return sdk.client.navigate({ instanceId, url: pendingUrl });
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
						setError(cause instanceof Error ? cause.message : "Unable to attach browser tab.");
					});
			} catch {
				// The guest has not attached yet; dom-ready retries.
			}
		},
		[instanceId, sdk],
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
			void sdk.client.navigate({ instanceId, url }).catch((cause: unknown) => {
				setError(cause instanceof Error ? cause.message : "Unable to navigate.");
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Enter a valid URL.");
		}
	};

	const command =
		(
			name:
				| "back"
				| "forward"
				| "reload"
				| "hardReload"
				| "zoomIn"
				| "zoomOut"
				| "resetZoom"
				| "openDevTools",
		) =>
		() =>
			void sdk.client[name]({ instanceId }).catch((cause: unknown) => {
				setError(cause instanceof Error ? cause.message : "Unable to run browser command.");
			});
	return (
		<div
			className="flex min-h-0 flex-1 flex-col bg-[var(--pane-surface,var(--color-background))]"
			data-qa-id="browser-view"
			aria-busy={!ready}
		>
			<div className="border-border relative shrink-0 border-b">
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
					<InputGroup className="h-7 flex-1">
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
									<MoreVerticalIcon />
								</Button>
							}
						/>
						<DropdownMenuContent align="end" className="min-w-52">
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
							<DropdownMenuGroup>
								<DropdownMenuLabel className="text-foreground flex items-center justify-between py-1 font-normal">
									<span className={!ready ? "opacity-50" : undefined}>Zoom</span>
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
								</DropdownMenuLabel>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</form>
				{loadProgress > 0 ? (
					<div
						aria-hidden="true"
						className="bg-primary pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 rounded-r-full transition-all duration-150 ease-out"
						style={{ width: `${loadProgress}%`, boxShadow: "0 0 6px 1px var(--color-ring)" }}
						data-qa-id="browser-load-progress"
					/>
				) : null}
			</div>
			{error ? (
				<p className="text-destructive border-border border-b px-3 py-1 text-xs" role="alert">
					{error}
				</p>
			) : null}
			<div ref={surfaceRef} className="relative min-h-0 flex-1">
				{!hasUrl ? (
					<div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
						Enter a URL to start browsing.
					</div>
				) : null}
				{state?.failure ? (
					<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--pane-surface,var(--color-card))] p-6 text-center">
						<p className="font-medium">This page could not be loaded.</p>
						<p className="text-muted-foreground text-xs">{state.failure.description}</p>
						<Button type="button" variant="outline" size="sm" onClick={command("reload")}>
							Try again
						</Button>
					</div>
				) : null}
			</div>
		</div>
	);
}
