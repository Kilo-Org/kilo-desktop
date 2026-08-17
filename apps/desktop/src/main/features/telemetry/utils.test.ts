import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	calculatePeriodId,
	hashHostname,
	hashMachineId,
	hostnameId,
	readMachineIdFromOs,
	type ExecFileRunner,
} from "./utils.js";

describe("calculatePeriodId", () => {
	it("buckets time into rolling 65-day periods", () => {
		const periodMs = 60 * 60 * 24 * 65 * 1000;
		expect(calculatePeriodId(0)).toBe(0);
		expect(calculatePeriodId(periodMs)).toBe(1);
		expect(calculatePeriodId(periodMs * 2 + 5)).toBe(2);
	});

	it("applies a period offset", () => {
		expect(calculatePeriodId(0, 3)).toBe(3);
	});
});

describe("hashMachineId / hashHostname", () => {
	it("hashes the raw machine id deterministically for a fixed platform", () => {
		const expected = createHash("sha256")
			.update("machine_id/v1\n")
			.update(process.platform)
			.update("\n")
			.update("raw-machine-id")
			.digest("hex");

		expect(hashMachineId("raw-machine-id")).toBe(expected);
	});

	it("produces a 64-char hex hostname hash", () => {
		expect(hashHostname()).toMatch(/^[0-9a-f]{64}$/);
	});

	it("exposes the raw hostname fallback", () => {
		expect(typeof hostnameId()).toBe("string");
		expect(hostnameId().length).toBeGreaterThan(0);
	});
});

describe("readMachineIdFromOs", () => {
	it("returns a non-empty string (real OS or hostname fallback)", async () => {
		const id = await readMachineIdFromOs();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("reads and trims /etc/machine-id on linux", async () => {
		const exec: ExecFileRunner = async () => ({ stdout: "  linux-machine-id\n" });
		expect(await readMachineIdFromOs(exec, "linux")).toBe("linux-machine-id");
	});

	it("parses IOPlatformUUID on darwin", async () => {
		const exec: ExecFileRunner = async () => ({
			stdout: '  "IOPlatformUUID" = "DARWIN-UUID-123"\n',
		});
		expect(await readMachineIdFromOs(exec, "darwin")).toBe("DARWIN-UUID-123");
	});

	it("parses MachineGuid on win32", async () => {
		const exec: ExecFileRunner = async () => ({
			stdout: "    MachineGuid    REG_SZ    ABCDEF01-2345\n",
		});
		expect(await readMachineIdFromOs(exec, "win32")).toBe("ABCDEF01-2345");
	});

	it("falls back to hostname when the probe yields no match", async () => {
		const exec: ExecFileRunner = async () => ({ stdout: "no match here" });
		expect((await readMachineIdFromOs(exec, "darwin")).length).toBeGreaterThan(0);
	});

	it("falls back to hostname when exec rejects", async () => {
		const exec: ExecFileRunner = async () => {
			throw new Error("blocked");
		};
		expect((await readMachineIdFromOs(exec, "linux")).length).toBeGreaterThan(0);
	});

	it("falls back to hostname for an unknown platform (no probe)", async () => {
		const exec: ExecFileRunner = async () => ({ stdout: "unused" });
		expect((await readMachineIdFromOs(exec, "aix")).length).toBeGreaterThan(0);
	});

	it("falls back to hostname when linux machine-id is blank", async () => {
		const exec: ExecFileRunner = async () => ({ stdout: "   \n" });
		expect((await readMachineIdFromOs(exec, "linux")).length).toBeGreaterThan(0);
	});
});
