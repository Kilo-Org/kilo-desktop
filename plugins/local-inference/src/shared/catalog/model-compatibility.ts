import type {
	LocalInferenceHardwareProfile,
	ModelCatalogEntry,
	ModelCatalogQuantization,
} from "../../contracts/index";

// Keep the fit and Best Picks equations aligned with canirun.ai's website at
// commit db81865. Anaconda artifact identity stays authoritative; signals that
// are absent from its catalog response (downloads, featured, lineage) are omitted.
const GIBIBYTE = 1024 ** 3;
const RUNTIME_OVERHEAD_GIB = 0.5;
const WORKING_SET_MULTIPLIER = 1.1;
const SYSTEM_MEMORY_BANDWIDTH_GBPS = 50;

export type ModelStatus = "can-run" | "tight" | "can-run-slow";
export type ModelGrade = "S" | "A" | "B" | "C" | "D" | "F";
export type ModelFit = "runs-great" | "runs-well" | "tight-fit" | "runs-slowly";

export interface ModelCompatibility {
	readonly fit: ModelFit;
	readonly fitLabel: string;
	readonly status: ModelStatus;
	readonly grade: ModelGrade;
	readonly score: number;
	readonly quantization: ModelCatalogQuantization;
	readonly estimatedTokensPerSecond: readonly [number, number] | null;
	readonly estimatedTokensPerSecondCenter: number | null;
	readonly memoryRequiredBytes: number;
}

type EvaluationStatus = ModelStatus | "cannot-run";
type EvaluationGrade = ModelGrade;

function normalizeQuantizationMethod(method: string): string {
	return method.trim().toUpperCase().replaceAll("-", "_");
}

function quantizationBytesPerParameter(method: string): number | null {
	const normalized = normalizeQuantizationMethod(method);
	if (normalized.includes("F32") || normalized.includes("FP32")) return 4;
	if (normalized.includes("F16") || normalized.includes("FP16") || normalized.includes("BF16")) {
		return 2;
	}

	const quantizedBits = normalized.match(/(?:^|_)I?Q(\d+)(?:_|$)/)?.[1];
	if (!quantizedBits) return null;

	const bytesPerParameter: Readonly<Record<number, number>> = {
		2: 0.3125,
		3: 0.4375,
		4: 0.5,
		5: 0.625,
		6: 0.75,
		8: 1,
	};
	return bytesPerParameter[Number.parseInt(quantizedBits, 10)] ?? null;
}

function quantizationQuality(method: string): number {
	const normalized = normalizeQuantizationMethod(method);
	const bitsPerParameter = quantizationBytesPerParameter(normalized);
	if (bitsPerParameter === null) return 0;

	const variantBonus = normalized.endsWith("_L")
		? 30
		: normalized.endsWith("_M")
			? 20
			: normalized.endsWith("_S")
				? 10
				: 0;
	return bitsPerParameter * 800 + variantBonus;
}

function recommendationQuantization(model: ModelCatalogEntry): ModelCatalogQuantization | null {
	const estimableQuantizations = model.quantizations.filter(
		(quantization) => quantizationBytesPerParameter(quantization.method) !== null,
	);
	estimableQuantizations.sort((left, right) => {
		const leftExact = normalizeQuantizationMethod(left.method) === "Q4_K_M";
		const rightExact = normalizeQuantizationMethod(right.method) === "Q4_K_M";
		if (leftExact !== rightExact) return leftExact ? -1 : 1;

		const leftDistance = Math.abs((quantizationBytesPerParameter(left.method) ?? 0) - 0.5);
		const rightDistance = Math.abs((quantizationBytesPerParameter(right.method) ?? 0) - 0.5);
		if (leftDistance !== rightDistance) return leftDistance - rightDistance;

		const qualityDifference = quantizationQuality(right.method) - quantizationQuality(left.method);
		if (qualityDifference !== 0) return qualityDifference;

		return left.method.localeCompare(right.method);
	});
	return estimableQuantizations[0] ?? null;
}

export function hasRecommendationQuantization(model: ModelCatalogEntry): boolean {
	return recommendationQuantization(model) !== null;
}

function memoryRequiredBytes(
	model: ModelCatalogEntry,
	quantization: ModelCatalogQuantization,
): number | null {
	const bytesPerParameter = quantizationBytesPerParameter(quantization.method);
	if (bytesPerParameter === null) return null;

	const estimatedGib = Math.max(
		(model.numParameters * bytesPerParameter * WORKING_SET_MULTIPLIER) / GIBIBYTE +
			RUNTIME_OVERHEAD_GIB,
		RUNTIME_OVERHEAD_GIB,
	);
	const roundedGib = Math.round(estimatedGib * 10) / 10;
	return Math.round(roundedGib * GIBIBYTE);
}

function evaluateStatus(
	memoryRequiredGib: number,
	hardware: LocalInferenceHardwareProfile,
): EvaluationStatus {
	const acceleratorMemoryGib = hardware.memoryTotalBytes / GIBIBYTE;
	const systemMemoryGib = hardware.systemMemoryTotalBytes / GIBIBYTE;

	if (hardware.kind === "unified-memory" || hardware.kind === "mobile") {
		const usableMemoryGib =
			hardware.kind === "mobile" ? acceleratorMemoryGib * 0.55 : acceleratorMemoryGib * 0.75;
		if (memoryRequiredGib <= usableMemoryGib * 0.7) return "can-run";
		if (memoryRequiredGib <= usableMemoryGib) return "tight";
		return "cannot-run";
	}

	if (hardware.kind === "dedicated-gpu") {
		if (memoryRequiredGib <= acceleratorMemoryGib * 0.85) return "can-run";
		if (memoryRequiredGib <= acceleratorMemoryGib * 1.1) return "tight";
		if (systemMemoryGib > acceleratorMemoryGib) {
			const totalOffloadMemoryGib = acceleratorMemoryGib + systemMemoryGib * 0.7;
			if (memoryRequiredGib <= totalOffloadMemoryGib) return "can-run-slow";
		}
		return "cannot-run";
	}

	const usableMemoryGib = acceleratorMemoryGib * 0.7;
	if (memoryRequiredGib <= usableMemoryGib * 0.7) return "can-run";
	if (memoryRequiredGib <= usableMemoryGib) return "tight";
	return "cannot-run";
}

function estimatedTokensPerSecond(
	model: ModelCatalogEntry,
	memoryRequiredGib: number,
	hardware: LocalInferenceHardwareProfile,
): number | null {
	if (hardware.memoryBandwidthGBps === null) return null;

	const activeParameters = Math.min(
		model.activeParameters ?? model.numParameters,
		model.numParameters,
	);
	const activeParameterRatio =
		model.numParameters > 0 && activeParameters > 0 ? activeParameters / model.numParameters : 1;
	const workingSetGib =
		activeParameterRatio < 1
			? Math.max(0.5, memoryRequiredGib * activeParameterRatio)
			: memoryRequiredGib;
	const acceleratorMemoryGib = hardware.memoryTotalBytes / GIBIBYTE;

	if (hardware.kind === "dedicated-gpu" && memoryRequiredGib > acceleratorMemoryGib) {
		const fractionAccelerator = Math.min(1, acceleratorMemoryGib / memoryRequiredGib);
		const fractionSystem = 1 - fractionAccelerator;
		const effectiveBandwidth =
			1 /
			(fractionAccelerator / hardware.memoryBandwidthGBps +
				fractionSystem / SYSTEM_MEMORY_BANDWIDTH_GBPS);
		return Math.max(1, Math.round((effectiveBandwidth / workingSetGib) * 0.7 * 0.85));
	}

	const efficiency =
		hardware.kind === "mobile" ? 0.4 : hardware.kind === "unified-memory" ? 0.65 : 0.7;
	return Math.round((hardware.memoryBandwidthGBps / workingSetGib) * efficiency);
}

function memoryPercentage(
	memoryRequiredGib: number,
	hardware: LocalInferenceHardwareProfile,
): number {
	return Math.round((memoryRequiredGib / (hardware.memoryTotalBytes / GIBIBYTE)) * 100);
}

function lerp(value: number, start: number, end: number, low: number, high: number): number {
	return low + (high - low) * ((value - start) / (end - start));
}

function compatibilityScore(
	status: EvaluationStatus,
	tokensPerSecond: number | null,
	parametersBillions: number,
	memoryPercent: number,
): number {
	if (status === "cannot-run") return 0;

	let speedScore = 0;
	if (tokensPerSecond !== null) {
		if (tokensPerSecond >= 80) speedScore = 100;
		else if (tokensPerSecond >= 40) speedScore = lerp(tokensPerSecond, 40, 80, 80, 100);
		else if (tokensPerSecond >= 20) speedScore = lerp(tokensPerSecond, 20, 40, 55, 80);
		else if (tokensPerSecond >= 10) speedScore = lerp(tokensPerSecond, 10, 20, 35, 55);
		else if (tokensPerSecond >= 5) speedScore = lerp(tokensPerSecond, 5, 10, 15, 35);
		else speedScore = lerp(Math.max(tokensPerSecond, 0), 0, 5, 0, 15);
	} else {
		speedScore = status === "can-run" ? 45 : 20;
	}

	let headroomScore: number;
	if (memoryPercent <= 20) headroomScore = 100;
	else if (memoryPercent <= 40) headroomScore = lerp(memoryPercent, 20, 40, 100, 75);
	else if (memoryPercent <= 60) headroomScore = lerp(memoryPercent, 40, 60, 75, 45);
	else if (memoryPercent <= 80) headroomScore = lerp(memoryPercent, 60, 80, 45, 20);
	else headroomScore = lerp(Math.min(memoryPercent, 100), 80, 100, 20, 0);

	const qualityBonus = Math.min(12, Math.log2(parametersBillions + 1) * 2);
	const fitMultiplier = status === "can-run-slow" ? 0.6 : status === "tight" ? 0.75 : 1;
	return Math.round((speedScore * 0.55 + headroomScore * 0.35 + qualityBonus) * fitMultiplier);
}

function scoreToGrade(score: number, status: EvaluationStatus): EvaluationGrade {
	if (status === "cannot-run") return "F";
	if (status === "can-run-slow") return score >= 40 ? "C" : "D";
	if (score >= 85) return "S";
	if (score >= 70) return "A";
	if (score >= 55) return "B";
	if (score >= 40) return "C";
	if (score >= 20) return "D";
	return "F";
}

function presentationFor(
	status: ModelStatus,
	grade: ModelGrade,
): Pick<ModelCompatibility, "fit" | "fitLabel"> {
	if (status === "can-run-slow") return { fit: "runs-slowly", fitLabel: "Runs Slowly" };
	if (grade === "S") return { fit: "runs-great", fitLabel: "Runs Great" };
	if (grade === "A") return { fit: "runs-well", fitLabel: "Runs Well" };
	if (grade === "B") return { fit: "runs-well", fitLabel: "Decent" };
	if (grade === "C") return { fit: "tight-fit", fitLabel: "Tight Fit" };
	if (grade === "D") return { fit: "tight-fit", fitLabel: "Barely Runs" };
	return { fit: "tight-fit", fitLabel: "Too Heavy" };
}

export function evaluateCatalogModel(
	model: ModelCatalogEntry,
	hardware: LocalInferenceHardwareProfile,
): ModelCompatibility | null {
	const quantization = recommendationQuantization(model);
	if (!quantization) return null;

	const requiredBytes = memoryRequiredBytes(model, quantization);
	if (requiredBytes === null) return null;

	const requiredGib = requiredBytes / GIBIBYTE;
	const status = evaluateStatus(requiredGib, hardware);
	if (status === "cannot-run") return null;

	const tokensPerSecond = estimatedTokensPerSecond(model, requiredGib, hardware);
	const score = compatibilityScore(
		status,
		tokensPerSecond,
		model.numParameters / 1_000_000_000,
		memoryPercentage(requiredGib, hardware),
	);
	const grade = scoreToGrade(score, status);

	return {
		...presentationFor(status, grade),
		status,
		grade,
		score,
		quantization,
		estimatedTokensPerSecond:
			tokensPerSecond === null
				? null
				: [
						Math.max(1, Math.round(tokensPerSecond * 0.8)),
						Math.max(1, Math.round(tokensPerSecond * 1.2)),
					],
		estimatedTokensPerSecondCenter: tokensPerSecond,
		memoryRequiredBytes: requiredBytes,
	};
}
