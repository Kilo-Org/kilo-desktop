import { FileTextIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { PagesServer, type PagesServerState } from "../contracts/index.js";

// The host accepts guests only on the browser partition, without a preload,
// and forces these preferences anyway; they are set for clarity.
const WEBVIEW_PREFERENCES =
	"sandbox=true,contextIsolation=true,nodeIntegration=false,allowRunningInsecureContent=false";

type View =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly partition: string; readonly url: string }
	| { readonly kind: "failed"; readonly message: string };

const selectStatus = (state: PagesServerState) => state.status;

/**
 * A Pages pane: the local Pages app in an Electron `<webview>` on the
 * Browser's persistent session (an iframe can't load loopback pages under the
 * app's CSP). The guest first visits Pages' sign-in, which kilo.pages'
 * identity bridge approves at once. The webview is created imperatively, as
 * React doesn't know the element; the pane kind is kept alive so it isn't
 * reloaded when hidden.
 */
export function PagesPane(_props: PaneProps) {
	const server = useDomainObject(PagesServer);
	const status = useDomainObjectState(PagesServer, selectStatus);
	const [view, setView] = useState<View>({ kind: "loading" });
	const [attempt, setAttempt] = useState(0);
	const retry = useCallback(() => {
		setView({ kind: "loading" });
		setAttempt((current) => current + 1);
	}, []);

	useEffect(() => {
		if (!server) return;
		let current = true;
		server.methods.prepareView(undefined).then(
			({ partition, url }) => current && setView({ kind: "ready", partition, url }),
			(error: unknown) =>
				current &&
				setView({
					kind: "failed",
					message: error instanceof Error ? error.message : String(error),
				}),
		);
		return () => {
			current = false;
		};
	}, [server, attempt]);

	if (!server) {
		return (
			<PagesMessage
				title="Pages isn't available here"
				description="Pages opens in the desktop app."
			/>
		);
	}
	if (view.kind === "failed") {
		return (
			<PagesMessage title="Pages couldn't start" description={view.message}>
				<Button type="button" variant="outline" data-qa-id="pages-retry" onClick={retry}>
					Try again
				</Button>
			</PagesMessage>
		);
	}
	if (view.kind === "loading") {
		return (
			<div
				className="text-muted-foreground flex size-full items-center justify-center gap-2 text-sm"
				data-qa-id="pages-starting"
			>
				<Spinner />
				{status === "starting" ? "Starting Pages…" : "Opening Pages…"}
			</div>
		);
	}
	return <PagesWebview partition={view.partition} url={view.url} />;
}

function PagesWebview({ partition, url }: { readonly partition: string; readonly url: string }) {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const container = host.current;
		if (!container) return;
		const webview = document.createElement("webview");
		webview.setAttribute("partition", partition);
		webview.setAttribute("webpreferences", WEBVIEW_PREFERENCES);
		webview.setAttribute("src", url);
		webview.className = "size-full";
		webview.dataset["qaId"] = "pages-webview";
		container.append(webview);
		return () => {
			try {
				webview.remove();
			} catch {
				// Electron throws when the guest is already gone; it's detached either way.
			}
		};
	}, [partition, url]);
	// Pages assumes a browser tab's opaque white canvas.
	return <div ref={host} className="size-full bg-white" data-qa-id="pages-pane" />;
}

function PagesMessage({
	title,
	description,
	children,
}: {
	readonly title: string;
	readonly description: string;
	readonly children?: ReactNode;
}) {
	return (
		<Empty data-qa-id="pages-unavailable">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<FileTextIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			{children ? <EmptyContent>{children}</EmptyContent> : null}
		</Empty>
	);
}
