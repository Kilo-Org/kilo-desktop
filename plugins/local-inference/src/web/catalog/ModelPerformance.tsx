import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { ModelCompatibility, ModelFit } from "../../shared/catalog/model-compatibility.js";

type PerformanceFitKind = ModelFit | "doesnt-fit";

const performanceFitMarkerClasses: Record<PerformanceFitKind, string> = {
	"runs-great": "bg-emerald-500",
	"runs-well": "bg-sky-500",
	"tight-fit": "bg-amber-500",
	"runs-slowly": "bg-orange-500",
	"doesnt-fit": "bg-red-500",
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
