import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { ModelCompatibility, ModelFit } from "../../shared/catalog/model-compatibility.js";

type PerformanceFitKind = ModelFit | "doesnt-fit";

const performanceFitMarkerClasses: Record<PerformanceFitKind, string> = {
	"runs-great": "bg-success",
	"runs-well": "bg-info",
	"tight-fit": "bg-warning",
	"runs-slowly": "bg-warning",
	"doesnt-fit": "bg-destructive",
};

function PerformanceFitIndicator({
	kind,
	label,
	className,
}: {
	kind: PerformanceFitKind;
	label: string;
	className?: string | undefined;
}) {
	return (
		<span className={cn("inline-flex items-center gap-2 text-xs font-medium", className)}>
			<span
				className={cn("size-2 shrink-0 rounded-full", performanceFitMarkerClasses[kind])}
				aria-hidden="true"
			/>
			<span>{label}</span>
		</span>
	);
}

export function ModelPerformance({
	compatibility,
	hasHardware,
	hasQuantizations,
	fixedFitWidth = false,
	wrap = false,
	stackOnNarrow = false,
}: {
	compatibility: ModelCompatibility | null;
	hasHardware: boolean;
	hasQuantizations: boolean;
	fixedFitWidth?: boolean;
	wrap?: boolean;
	stackOnNarrow?: boolean;
}) {
	const fitClassName = fixedFitWidth ? "w-24" : undefined;

	if (!hasHardware) {
		return <span className="text-muted-foreground text-xs">Checking machine…</span>;
	}

	if (!compatibility) {
		if (hasQuantizations) {
			return (
				<PerformanceFitIndicator kind="doesnt-fit" label="Doesn’t Fit" className={fitClassName} />
			);
		}
		return <span className="text-muted-foreground text-xs">No GGUF estimate</span>;
	}

	return (
		<div
			data-slot="model-performance"
			className={cn(
				"flex min-w-0 items-center gap-x-3 gap-y-1",
				wrap ? "flex-wrap" : "shrink-0",
				stackOnNarrow && "flex-col items-start @xl:flex-row @xl:items-center",
			)}
		>
			<PerformanceFitIndicator
				kind={compatibility.fit}
				label={compatibility.fitLabel}
				className={fitClassName}
			/>
			{compatibility.estimatedTokensPerSecond ? (
				<div className="text-muted-foreground flex flex-col text-xs leading-tight tabular-nums">
					<span className="text-foreground font-medium">
						~{compatibility.estimatedTokensPerSecond[0]}–{compatibility.estimatedTokensPerSecond[1]}
					</span>
					<span>tokens/sec</span>
				</div>
			) : null}
		</div>
	);
}

/** Placeholder for the fit indicator + two-line tokens/sec estimate. */
export function ModelPerformanceSkeleton({
	fixedFitWidth = false,
	wrap = false,
	stackOnNarrow = false,
}: {
	fixedFitWidth?: boolean;
	wrap?: boolean;
	stackOnNarrow?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-x-3 gap-y-1",
				wrap ? "flex-wrap" : "shrink-0",
				stackOnNarrow && "flex-col items-start @xl:flex-row @xl:items-center",
			)}
		>
			<span
				className={cn(
					"inline-flex items-center gap-2 text-xs font-medium",
					fixedFitWidth && "w-24",
				)}
			>
				<Skeleton className="size-2 shrink-0 rounded-full" />
				<SkeletonText className="w-14" />
			</span>
			<div className="flex flex-col text-xs leading-tight">
				<span>
					<SkeletonText className="w-12" />
				</span>
				<span>
					<SkeletonText className="w-14" />
				</span>
			</div>
		</div>
	);
}
