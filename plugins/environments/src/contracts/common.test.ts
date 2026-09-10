import { describe, expect, it } from "vitest";

import {
	cancelInputSchema,
	cancelResultSchema,
	ENVIRONMENTS_ERROR_MESSAGE_PATTERN,
	ENVIRONMENTS_EVENT_NAMES,
	environmentsErrorCodeSchema,
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	jobIdSchema,
	jobKindSchema,
	jobProgressEventSchema,
	parseEnvironmentsErrorMessage,
	providerSchema,
	stagingProgressEventSchema,
} from "./common.js";

describe("providerSchema", () => {
	it("accepts the v1 conda provider id", () => {
		expect(providerSchema.parse("conda")).toBe("conda");
	});

	it("rejects unknown provider ids so a typo fails fast", () => {
		expect(providerSchema.safeParse("uv").success).toBe(false);
		expect(providerSchema.safeParse("").success).toBe(false);
	});
});

describe("jobIdSchema", () => {
	it("accepts any non-empty opaque string", () => {
		expect(jobIdSchema.parse("job-1")).toBe("job-1");
		expect(jobIdSchema.parse("018f2a…-uuid-like")).toMatch(/./);
	});

	it("rejects empty ids", () => {
		expect(jobIdSchema.safeParse("").success).toBe(false);
	});
});

describe("jobKindSchema", () => {
	it("covers every v1 mutating conda op", () => {
		const expected = [
			"envs.create",
			"envs.clone",
			"envs.createFromFile",
			"envs.delete",
			"packages.install",
			"packages.remove",
			"packages.update",
			"channels.add",
			"channels.remove",
		] as const;
		for (const kind of expected) expect(jobKindSchema.parse(kind)).toBe(kind);
		// Exhaustive check — a new kind that isn't listed here will fail.
		expect([...jobKindSchema.options].sort()).toEqual([...expected].sort());
	});

	it("rejects read op names — reads never enqueue and never emit progress", () => {
		expect(jobKindSchema.safeParse("envs.list").success).toBe(false);
		expect(jobKindSchema.safeParse("packages.list").success).toBe(false);
		expect(jobKindSchema.safeParse("channels.list").success).toBe(false);
	});
});

describe("jobProgressEventSchema", () => {
	const base = { jobId: "j-1", provider: "conda" as const, kind: "envs.create" as const };

	it("round-trips a queued event", () => {
		const evt = { ...base, status: "queued" as const };
		expect(jobProgressEventSchema.parse(evt)).toEqual(evt);
	});

	it("round-trips a running event with an optional message", () => {
		const withMsg = { ...base, status: "running" as const, message: "Solving..." };
		const withoutMsg = { ...base, status: "running" as const };
		expect(jobProgressEventSchema.parse(withMsg)).toEqual(withMsg);
		expect(jobProgressEventSchema.parse(withoutMsg)).toEqual(withoutMsg);
	});

	it("round-trips a succeeded event", () => {
		const evt = { ...base, status: "succeeded" as const };
		expect(jobProgressEventSchema.parse(evt)).toEqual(evt);
	});

	it("round-trips a failed event carrying a structured error", () => {
		const evt = {
			...base,
			status: "failed" as const,
			error: { code: "SOLVE_FAILED", message: "could not solve" },
		};
		expect(jobProgressEventSchema.parse(evt)).toEqual(evt);
	});

	it("round-trips a cancelled event", () => {
		const evt = { ...base, status: "cancelled" as const };
		expect(jobProgressEventSchema.parse(evt)).toEqual(evt);
	});

	it("rejects a failed event missing the error payload — cross-boundary consumers rely on it", () => {
		expect(jobProgressEventSchema.safeParse({ ...base, status: "failed" }).success).toBe(false);
	});

	it("rejects a failed event whose error code is outside the frozen vocabulary", () => {
		const evt = {
			...base,
			status: "failed",
			error: { code: "SOMETHING_ELSE", message: "nope" },
		};
		expect(jobProgressEventSchema.safeParse(evt).success).toBe(false);
	});

	it("rejects an unknown status so drift in the state machine surfaces at the boundary", () => {
		expect(jobProgressEventSchema.safeParse({ ...base, status: "in-progress" }).success).toBe(
			false,
		);
	});
});

describe("stagingProgressEventSchema", () => {
	it("round-trips with and without a message", () => {
		const withMsg = { provider: "conda" as const, phase: "download", message: "Fetching..." };
		const withoutMsg = { provider: "conda" as const, phase: "verify" };
		expect(stagingProgressEventSchema.parse(withMsg)).toEqual(withMsg);
		expect(stagingProgressEventSchema.parse(withoutMsg)).toEqual(withoutMsg);
	});

	it("rejects an empty phase — the splash needs a slug to render", () => {
		expect(stagingProgressEventSchema.safeParse({ provider: "conda", phase: "" }).success).toBe(
			false,
		);
	});
});

describe("cancel schemas", () => {
	it("cancelInputSchema round-trips { jobId }", () => {
		expect(cancelInputSchema.parse({ jobId: "j-9" })).toEqual({ jobId: "j-9" });
	});

	it("cancelResultSchema captures whether the job was actually cancelled", () => {
		expect(cancelResultSchema.parse({ jobId: "j-9", cancelled: true })).toEqual({
			jobId: "j-9",
			cancelled: true,
		});
		expect(cancelResultSchema.parse({ jobId: "j-9", cancelled: false })).toEqual({
			jobId: "j-9",
			cancelled: false,
		});
	});

	it("cancelInputSchema rejects an empty jobId", () => {
		expect(cancelInputSchema.safeParse({ jobId: "" }).success).toBe(false);
	});
});

describe("environmentsErrorCodeSchema", () => {
	const codes = [
		"PREFIX_NOT_STAGED",
		"STAGING_FAILED",
		"INSTALLER_DOWNLOAD_FAILED",
		"INSTALLER_SHA_MISMATCH",
		"ENV_NOT_FOUND",
		"ENV_EXISTS",
		"PACKAGE_NOT_FOUND",
		"CHANNEL_NOT_FOUND",
		"SOLVE_FAILED",
		"JOB_NOT_FOUND",
		"JOB_CANCELLED",
		"INVALID_MATCHSPEC",
		"INVALID_CHANNEL",
		"PROVIDER_NOT_READY",
	] as const;

	it("includes every documented v1 code", () => {
		for (const code of codes) expect(environmentsErrorCodeSchema.parse(code)).toBe(code);
	});

	it("has no accidental extras — freezes the vocabulary at exactly the v1 set", () => {
		expect(environmentsErrorCodeSchema.options.slice().sort()).toEqual([...codes].sort());
	});

	it("rejects lowercase, prose, or unknown codes", () => {
		expect(environmentsErrorCodeSchema.safeParse("env_not_found").success).toBe(false);
		expect(environmentsErrorCodeSchema.safeParse("Env Not Found").success).toBe(false);
		expect(environmentsErrorCodeSchema.safeParse("UNKNOWN").success).toBe(false);
	});
});

describe("formatEnvironmentsErrorMessage / parseEnvironmentsErrorMessage", () => {
	it("format+parse is idempotent when a detail is present", () => {
		const wire = formatEnvironmentsErrorMessage("SOLVE_FAILED", "cannot resolve numpy>=99");
		expect(wire).toBe("SOLVE_FAILED: cannot resolve numpy>=99");
		expect(parseEnvironmentsErrorMessage(wire)).toEqual({
			code: "SOLVE_FAILED",
			detail: "cannot resolve numpy>=99",
		});
	});

	it("format+parse is idempotent when no detail is present", () => {
		const wire = formatEnvironmentsErrorMessage("PROVIDER_NOT_READY");
		expect(wire).toBe("PROVIDER_NOT_READY");
		expect(parseEnvironmentsErrorMessage(wire)).toEqual({ code: "PROVIDER_NOT_READY" });
	});

	it("collapses whitespace in detail so the wire format stays single-line", () => {
		expect(formatEnvironmentsErrorMessage("STAGING_FAILED", "  install\nfailed \t badly  ")).toBe(
			"STAGING_FAILED: install failed badly",
		);
	});

	it("parses a plain bare code (no detail, no colon) too", () => {
		expect(parseEnvironmentsErrorMessage("JOB_CANCELLED")).toEqual({ code: "JOB_CANCELLED" });
	});

	it("parses the renderer-observed shape after feature-registry.createFeatureHandlers wraps the FeatureError with a `[CODE] ` prefix", () => {
		// This is the exact wire format apps/desktop/src/main/features/registry/feature-registry.ts:169
		// produces: `new BusinessError(\`[${error.code}] ${error.message}\`)`. If this test starts failing
		// after a router change, sync the regex or expose a strip helper — do not force every consumer
		// to hand-roll the prefix strip.
		expect(parseEnvironmentsErrorMessage("[NOT_FOUND] ENV_NOT_FOUND: no such env foo")).toEqual({
			code: "ENV_NOT_FOUND",
			detail: "no such env foo",
		});
		expect(
			parseEnvironmentsErrorMessage("[BUSINESS] SOLVE_FAILED: cannot resolve numpy>=99"),
		).toEqual({ code: "SOLVE_FAILED", detail: "cannot resolve numpy>=99" });
		expect(parseEnvironmentsErrorMessage("[VALIDATION] INVALID_MATCHSPEC")).toEqual({
			code: "INVALID_MATCHSPEC",
		});
	});

	it("rejects unknown FeatureErrorCode wrappers so a foreign error is not misclassified", () => {
		expect(parseEnvironmentsErrorMessage("[TIMEOUT] SOLVE_FAILED: hi")).toBeNull();
		expect(parseEnvironmentsErrorMessage("[business] SOLVE_FAILED: hi")).toBeNull();
	});

	it("returns null for messages that do not carry an environments code", () => {
		expect(parseEnvironmentsErrorMessage("Todo not found.")).toBeNull();
		expect(parseEnvironmentsErrorMessage("")).toBeNull();
		expect(parseEnvironmentsErrorMessage("lowercase_code: hi")).toBeNull();
	});

	it("returns null for a well-shaped-but-unknown code so callers do not misclassify a foreign error", () => {
		expect(parseEnvironmentsErrorMessage("SOMETHING_ELSE: nope")).toBeNull();
	});

	it("pattern regex agrees with the parser on the leading-code shape", () => {
		expect(ENVIRONMENTS_ERROR_MESSAGE_PATTERN.exec("ENV_NOT_FOUND: no such env")?.[1]).toBe(
			"ENV_NOT_FOUND",
		);
	});
});

describe("environmentsErrorCodeToFeatureErrorCode", () => {
	it("maps validation-shaped reasons to VALIDATION", () => {
		expect(environmentsErrorCodeToFeatureErrorCode("INVALID_MATCHSPEC")).toBe("VALIDATION");
		expect(environmentsErrorCodeToFeatureErrorCode("INVALID_CHANNEL")).toBe("VALIDATION");
		expect(environmentsErrorCodeToFeatureErrorCode("ENV_EXISTS")).toBe("VALIDATION");
	});

	it("maps every *_NOT_FOUND reason to NOT_FOUND", () => {
		expect(environmentsErrorCodeToFeatureErrorCode("ENV_NOT_FOUND")).toBe("NOT_FOUND");
		expect(environmentsErrorCodeToFeatureErrorCode("PACKAGE_NOT_FOUND")).toBe("NOT_FOUND");
		expect(environmentsErrorCodeToFeatureErrorCode("CHANNEL_NOT_FOUND")).toBe("NOT_FOUND");
		expect(environmentsErrorCodeToFeatureErrorCode("JOB_NOT_FOUND")).toBe("NOT_FOUND");
	});

	it("falls back to BUSINESS for infrastructure and solver failures", () => {
		expect(environmentsErrorCodeToFeatureErrorCode("PREFIX_NOT_STAGED")).toBe("BUSINESS");
		expect(environmentsErrorCodeToFeatureErrorCode("STAGING_FAILED")).toBe("BUSINESS");
		expect(environmentsErrorCodeToFeatureErrorCode("INSTALLER_DOWNLOAD_FAILED")).toBe("BUSINESS");
		expect(environmentsErrorCodeToFeatureErrorCode("INSTALLER_SHA_MISMATCH")).toBe("BUSINESS");
		expect(environmentsErrorCodeToFeatureErrorCode("SOLVE_FAILED")).toBe("BUSINESS");
		expect(environmentsErrorCodeToFeatureErrorCode("JOB_CANCELLED")).toBe("BUSINESS");
		expect(environmentsErrorCodeToFeatureErrorCode("PROVIDER_NOT_READY")).toBe("BUSINESS");
	});
});

describe("ENVIRONMENTS_EVENT_NAMES", () => {
	it("uses the plugin id as the featureId prefix", () => {
		expect(ENVIRONMENTS_EVENT_NAMES.JOB_PROGRESS).toBe("environments.job-progress");
		expect(ENVIRONMENTS_EVENT_NAMES.STAGING_PROGRESS).toBe("environments.staging-progress");
	});
});
