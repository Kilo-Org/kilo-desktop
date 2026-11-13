import type { ReactNode } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import type { ActivityEntry } from "./activity-log";
import { MAP_COLORS } from "./DomainMapScene";
import type { DomainMap } from "./model";

/** A sphere as the scene draws it: a domain object, or (see-through) its mirror. */
function SphereSample({
	color,
	ghost = false,
}: {
	readonly color: string;
	readonly ghost?: boolean;
}) {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
			<defs>
				<radialGradient id={`sphere-${color}`} cx="35%" cy="35%" r="70%">
					<stop offset="0%" stopColor="white" stopOpacity={ghost ? 0.5 : 0.9} />
					<stop offset="45%" stopColor={color} stopOpacity={ghost ? 0.6 : 1} />
					<stop offset="100%" stopColor={color} stopOpacity={ghost ? 0.3 : 0.55} />
				</radialGradient>
			</defs>
			<circle cx="7" cy="7" r="6" fill={`url(#sphere-${color})`} />
		</svg>
	);
}

/** A line as the scene draws it: colour, weight, dashes and the arrow at its end. */
function LineSample({
	color,
	width = 1.5,
	dash,
	pulse,
}: {
	readonly color: string;
	readonly width?: number;
	readonly dash?: string;
	/** A delivery travelling along it. */
	readonly pulse?: string;
}) {
	return (
		<svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
			<line
				x1="1"
				y1="5"
				x2="27"
				y2="5"
				stroke={color}
				strokeWidth={width}
				strokeDasharray={dash}
				strokeLinecap="round"
				opacity={pulse ? 0.6 : 0.9}
			/>
			<path d="M27 1.5 L33 5 L27 8.5 Z" fill={color} opacity={pulse ? 0.6 : 0.9} />
			{pulse ? (
				<>
					<circle cx="15" cy="5" r="5" fill={pulse} opacity="0.4" />
					<circle cx="15" cy="5" r="3" fill={pulse} />
				</>
			) : null}
		</svg>
	);
}

/** An extension point as the scene draws it: a small gold diamond. */
function PointSample() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
			<path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" fill={MAP_COLORS.point} />
		</svg>
	);
}

function Key({ sample, children }: { readonly sample: ReactNode; readonly children: ReactNode }) {
	return (
		<span className="flex items-center gap-1.5">
			{sample}
			{children}
		</span>
	);
}

/** What's on the map, across the top of the scene. */
export function MapCounts({ map }: { readonly map: DomainMap }) {
	return (
		<div
			className="pointer-events-none absolute inset-x-3 top-3 text-[11px] text-white/70"
			data-qa-id="domain-map-counts"
		>
			{map.domains.length} domain objects · {map.uses.length} declared uses
			{map.points.length > 0 ? ` · ${map.points.length} extension points` : ""}
		</div>
	);
}

/** What the shapes and lines mean, along the bottom of the scene, drawn as the scene draws them. */
export function Legend({ map }: { readonly map: DomainMap }) {
	return (
		<div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/70">
			<Key sample={<SphereSample color={MAP_COLORS.domain} />}>domain object</Key>
			{map.mirrors.length > 0 ? (
				<>
					<Key sample={<SphereSample color={MAP_COLORS.mirror} ghost />}>mirror in this window</Key>
					<Key sample={<LineSample color={MAP_COLORS.mirror} dash="4 3" />}>copied</Key>
				</>
			) : null}
			<Key sample={<LineSample color={MAP_COLORS.use} />}>used by (declared)</Key>
			{map.points.length > 0 ? (
				<>
					<Key sample={<PointSample />}>extension point</Key>
					<Key sample={<LineSample color={MAP_COLORS.point} width={1.2} />}>contributes</Key>
				</>
			) : null}
			<Key sample={<LineSample color={MAP_COLORS.use} pulse={MAP_COLORS.event} />}>event</Key>
			<Key sample={<LineSample color={MAP_COLORS.use} pulse={MAP_COLORS.state} />}>
				state change
			</Key>
		</div>
	);
}

/** The dark stage the map draws on, with its fallback when WebGL 2 is missing. */
export function MapStage({
	canvasRef,
	failure,
	className,
	children,
}: {
	readonly canvasRef: (canvas: HTMLCanvasElement | null) => void;
	readonly failure: string | null;
	readonly className?: string;
	readonly children?: ReactNode;
}) {
	return (
		<div
			className={cn("relative min-w-0 overflow-hidden", className)}
			style={{ backgroundColor: MAP_COLORS.background }}
		>
			<canvas ref={canvasRef} className="block size-full" data-qa-id="domain-map-canvas" />
			{failure ? (
				<p
					className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70"
					data-qa-id="domain-map-unsupported"
				>
					The 3D view needs WebGL 2, which isn't available here ({failure}). The live activity still
					runs.
				</p>
			) : null}
			{children}
		</div>
	);
}

/** One delivery on one line: where it came from, what it was, how far it went. */
export function ActivityLine({ entry }: { readonly entry: ActivityEntry }) {
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<span
				className="size-1.5 shrink-0 rounded-full"
				style={{ backgroundColor: MAP_COLORS[entry.kind] }}
			/>
			<span className="truncate font-mono">
				{entry.domainId} · {entry.name}
			</span>
			<span
				className="ml-auto shrink-0 tabular-nums opacity-70"
				title="Plugins declaring they use it"
			>
				→ {entry.users}
			</span>
		</span>
	);
}
