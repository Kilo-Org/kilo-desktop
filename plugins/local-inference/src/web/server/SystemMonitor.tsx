import { CpuIcon, GpuIcon, MemoryStickIcon, type LucideIcon } from "lucide-react";

import { Skeleton } from "@kilo-desktop/ui/components/skeleton";

import type { LocalInferenceUsage } from "../../contracts/schemas.js";

const GIBIBYTE = 1024 ** 3;
const MEBIBYTE = 1024 ** 2;

function formatPercent(value: number): string {
	return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}%`;
}

function formatBytes(value: number): string {
	if (value >= GIBIBYTE) {
		const gibibytes = value / GIBIBYTE;
		return `${gibibytes < 10 ? gibibytes.toFixed(1) : gibibytes.toFixed(0)} GB`;
	}
	return `${Math.round(value / MEBIBYTE)} MB`;
}

function formatBytePair(used: number, total: number): string {
	return `${formatBytes(used)} / ${formatBytes(total)}`;
}

export function usageIndicatorClass(percent: number): string {
	if (percent >= 90) return "bg-destructive";
	if (percent >= 70) return "bg-warning";
	return "bg-primary-ink";
}

function UsageMeter({ value }: { value: number }) {
	const percent = Math.min(Math.max(value, 0), 100);
	return (
		<div className="bg-border h-1.5 overflow-hidden rounded-full" aria-hidden>
			<div
				className={`${usageIndicatorClass(percent)} h-full rounded-full transition-[width,background-color] duration-500`}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}

function UsageCard({
	title,
	Icon,
	qaId,
	value,
	usedPercent,
	subtitle,
	showPercentInHeader = true,
	loading,
}: {
	title: string;
	Icon: LucideIcon;
	qaId: string;
	value: string;
	usedPercent: number | null;
	subtitle?: string | undefined;
	showPercentInHeader?: boolean;
	loading: boolean;
}) {
	return (
		<article
			className="bg-card flex h-full min-w-0 flex-col rounded-xl border p-3"
			data-qa-id={qaId}
		>
			<div className="flex min-w-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<div className="bg-foreground/5 text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md">
						<Icon className="size-3.5" aria-hidden />
					</div>
					<h3 className="truncate text-xs font-medium">{title}</h3>
				</div>
				{showPercentInHeader ? (
					loading ? (
						<Skeleton className="h-4 w-10" />
					) : (
						<p className="text-muted-foreground text-2xs shrink-0 tabular-nums">
							{usedPercent === null ? "—" : formatPercent(usedPercent)}
						</p>
					)
				) : null}
			</div>
			<div className="mt-3 h-9 min-w-0">
				{loading ? (
					<Skeleton className="h-5 w-24" />
				) : (
					<>
						<p className="truncate text-sm font-semibold tracking-tight tabular-nums">{value}</p>
						{subtitle ? (
							<p className="text-muted-foreground text-2xs truncate tabular-nums">{subtitle}</p>
						) : null}
					</>
				)}
			</div>
			<div className="mt-auto pt-2">
				<UsageMeter value={usedPercent ?? 0} />
			</div>
		</article>
	);
}

export function SystemMonitor({
	usage,
	loading,
}: {
	usage: LocalInferenceUsage | undefined;
	loading: boolean;
}) {
	const systemCpuPercent = usage?.system.cpuPercent ?? null;
	const systemGpuMemoryUsedBytes = usage?.system.gpuMemoryUsedBytes ?? null;
	const systemGpuMemoryTotalBytes = usage?.system.gpuMemoryTotalBytes ?? null;
	const systemMemoryUsedBytes = usage?.system.memoryUsedBytes ?? 0;
	const systemMemoryTotalBytes = usage?.system.memoryTotalBytes ?? 0;
	const systemMemoryUsedPercent =
		systemMemoryTotalBytes === 0 ? null : (systemMemoryUsedBytes / systemMemoryTotalBytes) * 100;
	const systemGpuMemoryUsedPercent =
		systemGpuMemoryUsedBytes === null ||
		systemGpuMemoryTotalBytes === null ||
		systemGpuMemoryTotalBytes === 0
			? null
			: (systemGpuMemoryUsedBytes / systemGpuMemoryTotalBytes) * 100;

	return (
		<section
			aria-labelledby="system-monitor-heading"
			className="flex min-w-0 flex-col"
			data-qa-id="local-model-server-usage"
		>
			<h2 id="system-monitor-heading" className="text-sm font-medium">
				System Monitor
			</h2>
			<div className="mt-3 grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
				<UsageCard
					title="CPU"
					Icon={CpuIcon}
					qaId="local-model-server-usage-cpu"
					value={systemCpuPercent === null ? "Unavailable" : formatPercent(systemCpuPercent)}
					usedPercent={systemCpuPercent}
					subtitle={systemCpuPercent === null ? undefined : "System usage"}
					showPercentInHeader={false}
					loading={loading}
				/>
				<UsageCard
					title="RAM"
					Icon={MemoryStickIcon}
					qaId="local-model-server-usage-ram"
					value={
						systemMemoryTotalBytes === 0
							? "Unavailable"
							: formatBytePair(systemMemoryUsedBytes, systemMemoryTotalBytes)
					}
					usedPercent={systemMemoryUsedPercent}
					subtitle={
						systemMemoryTotalBytes === 0
							? undefined
							: `${formatBytes(systemMemoryTotalBytes - systemMemoryUsedBytes)} free`
					}
					loading={loading}
				/>
				<UsageCard
					title="GPU"
					Icon={GpuIcon}
					qaId="local-model-server-usage-gpu"
					value={
						systemGpuMemoryUsedBytes === null || systemGpuMemoryTotalBytes === null
							? "Unavailable"
							: formatBytePair(systemGpuMemoryUsedBytes, systemGpuMemoryTotalBytes)
					}
					usedPercent={systemGpuMemoryUsedPercent}
					subtitle={
						systemGpuMemoryUsedBytes === null || systemGpuMemoryTotalBytes === null
							? undefined
							: `${formatBytes(systemGpuMemoryTotalBytes - systemGpuMemoryUsedBytes)} free`
					}
					loading={loading}
				/>
			</div>
		</section>
	);
}
