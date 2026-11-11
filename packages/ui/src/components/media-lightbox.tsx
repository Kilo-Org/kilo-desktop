import {
	ChevronLeftIcon,
	ChevronRightIcon,
	DownloadIcon,
	ScanIcon,
	XIcon,
	ZoomInIcon,
	ZoomOutIcon,
} from "lucide-react";
import {
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type KeyboardEvent,
	type ReactNode,
	type SyntheticEvent,
} from "react";

import { usePanZoom } from "../hooks/use-pan-zoom.js";
import {
	dataUrlMime,
	downloadBlob,
	downloadUrl,
	extensionForMime,
	slugForFilename,
	timestampForFilename,
} from "../lib/download.js";
import type { Size } from "../lib/pan-zoom.js";
import { serializeSvgForExport, svgToPngBlob } from "../lib/svg-export.js";
import { cn } from "../lib/utils.js";
import { Button } from "./button.js";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./dialog.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { MermaidDiagram, type MermaidDiagramState } from "./mermaid-diagram.js";
import { toast } from "./sonner.js";
import { Spinner } from "./spinner.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export type LightboxItem =
	| {
			readonly kind: "image";
			readonly id: string;
			readonly src: string;
			readonly alt?: string | undefined;
			readonly filename?: string | undefined;
	  }
	| {
			readonly kind: "mermaid";
			readonly id: string;
			readonly code: string;
			readonly label: string;
	  }
	| {
			/**
			 * Host-rendered content that fills the stage and handles its own input
			 * (e.g. an interactive page): no zoom, pan or download.
			 */
			readonly kind: "custom";
			readonly id: string;
			readonly title: string;
			readonly content: ReactNode;
	  };

/** Images without an intrinsic size (some SVGs) get a sensible stage size instead of 0×0. */
const FALLBACK_IMAGE_SIZE: Size = { width: 800, height: 600 };
/** Diagrams are vector, so fit may enlarge a small one for legibility. */
const DIAGRAM_MAX_FIT = 2;
const PNG_SCALE = 2;

export function lightboxItemTitle(item: LightboxItem): string {
	if (item.kind === "mermaid") return item.label;
	if (item.kind === "custom") return item.title;
	return item.alt?.trim() || item.filename || "Image";
}

function imageFilename(item: Extract<LightboxItem, { kind: "image" }>, now: Date): string {
	if (item.filename) return item.filename;
	const mime = dataUrlMime(item.src) ?? "image/png";
	return `image-${timestampForFilename(now)}.${extensionForMime(mime)}`;
}

function svgSize(svg: SVGSVGElement): Size {
	const box = svg.viewBox.baseVal as DOMRect | null;
	return {
		width: Number(svg.getAttribute("width")) || box?.width || FALLBACK_IMAGE_SIZE.width,
		height: Number(svg.getAttribute("height")) || box?.height || FALLBACK_IMAGE_SIZE.height,
	};
}

function ToolbarButton({
	label,
	children,
	...props
}: ComponentProps<typeof Button> & { readonly label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

function DiagramDownloadMenu({
	label,
	svg,
}: {
	readonly label: string;
	readonly svg: SVGSVGElement | null;
}) {
	const save = async (format: "svg" | "png") => {
		if (!svg) return;
		const stem = `${slugForFilename(label, "diagram")}-${timestampForFilename(new Date())}`;
		try {
			const exported = serializeSvgForExport(svg, {
				background: "var(--pele-bg, var(--_bg, #ffffff))",
			});
			const blob =
				format === "svg"
					? new Blob([exported.svg], { type: "image/svg+xml" })
					: await svgToPngBlob(exported.svg, exported.size, PNG_SCALE);
			downloadBlob(blob, `${stem}.${format}`);
		} catch {
			toast.error("Could not export the diagram");
		}
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={!svg}
				data-qa-id="media-lightbox-download"
				render={<Button variant="ghost" size="icon-sm" aria-label="Download" />}
			>
				<DownloadIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem data-qa-id="media-lightbox-download-svg" onClick={() => void save("svg")}>
					Download SVG
				</DropdownMenuItem>
				<DropdownMenuItem data-qa-id="media-lightbox-download-png" onClick={() => void save("png")}>
					Download PNG
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const TITLE_CLASS = "min-w-0 flex-1 truncate text-sm font-medium";

function LightboxView({
	item,
	index,
	count,
	onIndexChange,
	renderActions,
	renderTitle,
	closeControl,
}: {
	readonly item: LightboxItem;
	readonly index: number;
	readonly count: number;
	readonly onIndexChange: (index: number) => void;
	readonly renderActions?: ((item: LightboxItem) => ReactNode) | undefined;
	/** The heading: a dialog names itself with it, a pane shows a plain one. */
	readonly renderTitle: (title: string) => ReactNode;
	readonly closeControl?: ReactNode;
}) {
	const [content, setContent] = useState<Size | null>(null);
	const [diagramState, setDiagramState] = useState<MermaidDiagramState>("loading");
	const [diagramSvg, setDiagramSvg] = useState<SVGSVGElement | null>(null);
	const root = useRef<HTMLDivElement>(null);
	// Each item remounts this view, taking the focused toolbar button with it;
	// keep focus here so the next key still reaches the lightbox.
	useEffect(() => {
		const element = root.current;
		if (element && !element.contains(document.activeElement))
			element.focus({ preventScroll: true });
	}, []);
	const panZoom = usePanZoom({
		content,
		maxFit: item.kind === "mermaid" ? DIAGRAM_MAX_FIT : 1,
	});
	const title = lightboxItemTitle(item);
	const hasGallery = count > 1;
	const step = (delta: number) => onIndexChange((index + delta + count) % count);
	// A failed diagram shows its own alert and source, which read better unscaled.
	const diagramFailed = item.kind === "mermaid" && diagramState === "error";
	const zoomable = item.kind !== "custom" && !diagramFailed;

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		// Menus portal out of the DOM but still bubble here through React.
		if ((event.target as Element).closest('[role="menu"]')) return;
		const zoomKey = ["+", "=", "-", "0"].includes(event.key);
		if (zoomKey && !zoomable) return;
		switch (event.key) {
			case "ArrowLeft":
				if (!hasGallery) return;
				step(-1);
				break;
			case "ArrowRight":
				if (!hasGallery) return;
				step(1);
				break;
			case "+":
			case "=":
				panZoom.zoomIn();
				break;
			case "-":
				panZoom.zoomOut();
				break;
			case "0":
				panZoom.reset();
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
		const image = event.currentTarget;
		setContent(
			image.naturalWidth && image.naturalHeight
				? { width: image.naturalWidth, height: image.naturalHeight }
				: FALLBACK_IMAGE_SIZE,
		);
	};

	const stopGesture = (event: SyntheticEvent) => event.stopPropagation();
	const showSpinner = zoomable && !content;
	const galleryButtons = hasGallery ? (
		<>
			<Button
				variant="secondary"
				size="icon-sm"
				aria-label="Previous"
				data-qa-id="media-lightbox-prev"
				className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full shadow-sm"
				onPointerDown={stopGesture}
				onDoubleClick={stopGesture}
				onClick={() => step(-1)}
			>
				<ChevronLeftIcon />
			</Button>
			<Button
				variant="secondary"
				size="icon-sm"
				aria-label="Next"
				data-qa-id="media-lightbox-next"
				className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full shadow-sm"
				onPointerDown={stopGesture}
				onDoubleClick={stopGesture}
				onClick={() => step(1)}
			>
				<ChevronRightIcon />
			</Button>
		</>
	) : null;

	return (
		<div
			ref={root}
			tabIndex={-1}
			className="flex min-h-0 flex-1 flex-col outline-none"
			onKeyDown={onKeyDown}
		>
			<div className="border-border-subtle flex items-center gap-2 border-b px-3 py-1.5">
				{renderTitle(title)}
				{hasGallery ? (
					<span
						className="text-muted-foreground shrink-0 text-xs tabular-nums"
						data-qa-id="media-lightbox-counter"
					>
						{index + 1} / {count}
					</span>
				) : null}
				<div className="flex shrink-0 items-center gap-0.5">
					{zoomable ? (
						<>
							<ToolbarButton
								label="Zoom out"
								data-qa-id="media-lightbox-zoom-out"
								onClick={panZoom.zoomOut}
							>
								<ZoomOutIcon />
							</ToolbarButton>
							<span
								className="text-muted-foreground w-12 text-center text-xs tabular-nums"
								data-qa-id="media-lightbox-zoom-level"
							>
								{Math.round(panZoom.scale * 100)}%
							</span>
							<ToolbarButton
								label="Zoom in"
								data-qa-id="media-lightbox-zoom-in"
								onClick={panZoom.zoomIn}
							>
								<ZoomInIcon />
							</ToolbarButton>
							<ToolbarButton
								label="Fit to window"
								data-qa-id="media-lightbox-fit"
								disabled={panZoom.isAtFit}
								onClick={panZoom.reset}
							>
								<ScanIcon />
							</ToolbarButton>
							<ToolbarButton
								label="Actual size"
								data-qa-id="media-lightbox-actual"
								className="w-auto px-1.5 text-xs font-medium"
								onClick={panZoom.actualSize}
							>
								1:1
							</ToolbarButton>
							<span aria-hidden="true" className="bg-border mx-1 h-4 w-px" />
						</>
					) : null}
					{item.kind === "mermaid" ? (
						<DiagramDownloadMenu label={item.label} svg={diagramSvg} />
					) : item.kind === "image" ? (
						<ToolbarButton
							label="Download"
							data-qa-id="media-lightbox-download"
							onClick={() => downloadUrl(item.src, imageFilename(item, new Date()))}
						>
							<DownloadIcon />
						</ToolbarButton>
					) : null}
					{renderActions?.(item)}
					{closeControl}
				</div>
			</div>
			{item.kind === "custom" ? (
				<div data-qa-id="media-lightbox-stage" className="relative min-h-0 flex-1 overflow-hidden">
					<div className="absolute inset-0" data-qa-id="media-lightbox-content">
						{item.content}
					</div>
					{galleryButtons}
				</div>
			) : (
				<div
					ref={panZoom.viewportRef}
					{...(diagramFailed ? {} : panZoom.viewportHandlers)}
					data-qa-id="media-lightbox-stage"
					className={cn(
						"bg-muted/30 relative min-h-0 flex-1 overflow-hidden",
						!diagramFailed && "touch-none select-none",
						!diagramFailed && (panZoom.dragging ? "cursor-grabbing" : "cursor-grab"),
					)}
				>
					<div
						style={diagramFailed ? undefined : panZoom.contentStyle}
						className={diagramFailed ? "absolute inset-0 overflow-auto p-6" : undefined}
						data-qa-id="media-lightbox-content"
					>
						{item.kind === "image" ? (
							<img
								src={item.src}
								alt={item.alt ?? ""}
								draggable={false}
								className="block size-full max-w-none"
								onLoad={onImageLoad}
							/>
						) : (
							<MermaidDiagram
								code={item.code}
								zoom={false}
								onStateChange={setDiagramState}
								onReady={(svg) => {
									setDiagramSvg(svg);
									setContent(svgSize(svg));
								}}
							/>
						)}
					</div>
					{showSpinner ? (
						<div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
							<Spinner aria-label="Loading" />
						</div>
					) : null}
					{galleryButtons}
				</div>
			)}
		</div>
	);
}

interface MediaViewerProps {
	readonly items: readonly LightboxItem[];
	readonly index: number;
	readonly onIndexChange: (index: number) => void;
	readonly renderActions?: (item: LightboxItem) => ReactNode;
}

/**
 * A viewer for media: zoom (wheel, pinch, toolbar, +/-), drag to pan,
 * double-click or 0 to return to fit, ←/→ between `items`, download, and
 * host actions through `renderActions`. It fills its container, so it can
 * sit in a pane; `MediaLightbox` shows it in a dialog instead.
 */
export function MediaViewer({
	items,
	index,
	onIndexChange,
	renderActions,
	className,
	hideTitle = false,
}: MediaViewerProps & {
	readonly className?: string;
	/** For a host that already names the item (a file's breadcrumb): kept for screen readers only. */
	readonly hideTitle?: boolean;
}) {
	const item = items[index];
	return (
		<div className={cn("flex min-h-0 flex-col", className)} data-qa-id="media-viewer">
			{item ? (
				<LightboxView
					key={item.id}
					item={item}
					index={index}
					count={items.length}
					onIndexChange={onIndexChange}
					renderActions={renderActions}
					renderTitle={(title) =>
						hideTitle ? (
							<>
								<h2 className="sr-only">{title}</h2>
								<div className="flex-1" />
							</>
						) : (
							<h2 className={TITLE_CLASS}>{title}</h2>
						)
					}
				/>
			) : null}
		</div>
	);
}

/**
 * `MediaViewer` in a near-full-window dialog, closed with Esc. Built on the
 * shared Dialog so focus is trapped and app shortcuts are suppressed while it
 * is open.
 */
export function MediaLightbox({
	items,
	index,
	onIndexChange,
	open,
	onOpenChange,
	renderActions,
}: MediaViewerProps & {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}) {
	const item = items[index];
	return (
		<Dialog open={open && Boolean(item)} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				data-qa-id="media-lightbox"
				className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
			>
				{item ? (
					<LightboxView
						key={item.id}
						item={item}
						index={index}
						count={items.length}
						onIndexChange={onIndexChange}
						renderActions={renderActions}
						renderTitle={(title) => <DialogTitle className={TITLE_CLASS}>{title}</DialogTitle>}
						closeControl={
							<DialogClose
								data-qa-id="media-lightbox-close"
								render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}
							>
								<XIcon />
							</DialogClose>
						}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
