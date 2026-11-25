import { describe, expect, it } from "vitest";

import { modelInstallLinkTelemetry, readModelInstallLink } from "./model-install-link";

const MODEL_UUID = "550e8400-e29b-41d4-a716-446655440000";
const FILE_UUID = "660e8400-e29b-41d4-a716-446655440001";

const install = (search: Record<string, string>) =>
	readModelInstallLink({ modelAction: "install", ...search });

describe("readModelInstallLink", () => {
	it("is null for a page visit that is not a model install link", () => {
		expect(readModelInstallLink({})).toBeNull();
		expect(readModelInstallLink({ section: "local-model-server" })).toBeNull();
	});

	it("reads a model UUID or slug with and without a file and source", () => {
		expect(install({ model: MODEL_UUID, source: "dot-org" })).toEqual({
			kind: "install",
			model: MODEL_UUID,
			source: "dot-org",
		});
		expect(
			install({
				model: `  ${MODEL_UUID} `,
				file: ` ${FILE_UUID} `,
				source: " dot-org ",
			}),
		).toEqual({
			kind: "install",
			model: MODEL_UUID,
			file: FILE_UUID,
			source: "dot-org",
		});
		expect(
			install({
				model: "org_model:qwen-3.8",
				file: "qwen-3.8_Q4_K_M.gguf",
			}),
		).toEqual({
			kind: "install",
			model: "org_model:qwen-3.8",
			file: "qwen-3.8_Q4_K_M.gguf",
		});
		expect(install({ model: "a", file: "   ", source: "  " })).toEqual({
			kind: "install",
			model: "a",
		});
		expect(install({ model: "a".repeat(128), file: "b".repeat(128) })).toEqual({
			kind: "install",
			model: "a".repeat(128),
			file: "b".repeat(128),
		});
	});

	it("rejects actions other than install", () => {
		expect(readModelInstallLink({ modelAction: "run", model: MODEL_UUID })).toEqual({
			kind: "invalid",
			reason: "unsupported-action",
		});
		expect(readModelInstallLink({ model: MODEL_UUID, source: "dot-org" })).toEqual({
			kind: "invalid",
			reason: "unsupported-action",
			source: "dot-org",
		});
	});

	it("rejects a link without a model", () => {
		expect(install({})).toEqual({ kind: "invalid", reason: "missing-model" });
		expect(install({ model: "   ", source: "dot-org" })).toEqual({
			kind: "invalid",
			reason: "missing-model",
			source: "dot-org",
		});
	});

	it("rejects unsafe model identifiers", () => {
		for (const bad of [
			"../secret",
			"foo..bar",
			"org/model",
			"org\\model",
			"model name",
			"model\nname",
			".hidden",
			"-flag",
			":prefixed",
			"modél",
			"model\u200b",
			"a".repeat(129),
		]) {
			expect(install({ model: bad })).toEqual({ kind: "invalid", reason: "invalid-model" });
		}
	});

	it("rejects unsafe file identifiers", () => {
		for (const bad of [
			"../file.gguf",
			"a..b",
			"dir/file.gguf",
			"dir\\file.gguf",
			"file name",
			"file\tname",
			".dotfile",
			"-flag",
			"filé",
			"file\u00a0id",
			"f".repeat(129),
		]) {
			expect(install({ model: MODEL_UUID, file: bad, source: "dot-org" })).toEqual({
				kind: "invalid",
				reason: "invalid-file",
				source: "dot-org",
			});
		}
	});
});

describe("modelInstallLinkTelemetry", () => {
	it("reports what a link carried without model or file identifiers", () => {
		const withFile = install({ model: MODEL_UUID, file: FILE_UUID, source: "dot-org" })!;
		const payloadWithFile = modelInstallLinkTelemetry(withFile);
		expect(payloadWithFile).toEqual({
			event: "model-install-link-received",
			data: { hasFile: true, source: "dot-org" },
		});
		expect(JSON.stringify(payloadWithFile)).not.toContain(MODEL_UUID);
		expect(JSON.stringify(payloadWithFile)).not.toContain(FILE_UUID);

		expect(modelInstallLinkTelemetry(install({ model: MODEL_UUID })!)).toEqual({
			event: "model-install-link-received",
			data: { hasFile: false, source: "none" },
		});

		expect(
			modelInstallLinkTelemetry(install({ model: MODEL_UUID, source: "custom-catalog" })!),
		).toEqual({
			event: "model-install-link-received",
			data: { hasFile: false, source: "other" },
		});
	});

	it("reports a rejection by its reason and buckets unknown sources as other", () => {
		const rejected = install({
			model: MODEL_UUID,
			file: "../bad",
			source: "evil.example?user=me",
		})!;
		const payload = modelInstallLinkTelemetry(rejected);
		expect(payload).toEqual({
			event: "model-install-link-rejected",
			data: { reason: "invalid-file", source: "other" },
		});
		expect(JSON.stringify(payload)).not.toContain(MODEL_UUID);
		expect(JSON.stringify(payload)).not.toContain("../bad");

		expect(modelInstallLinkTelemetry(install({ source: "dot-org" })!)).toEqual({
			event: "model-install-link-rejected",
			data: { reason: "missing-model", source: "dot-org" },
		});

		expect(modelInstallLinkTelemetry(readModelInstallLink({ modelAction: "run" })!)).toEqual({
			event: "model-install-link-rejected",
			data: { reason: "unsupported-action", source: "none" },
		});
	});
});
