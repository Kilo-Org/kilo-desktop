import { afterEach, describe, expect, it, vi } from "vitest";

// The existing ScopedFsService.test.ts uses the real filesystem (integration
// style). This companion file mocks node:fs/promises so we can inject the
// non-modeled errno codes that ScopedFsService's defensive paths handle —
// EACCES, EPERM, EIO, and the like — which are not portably reproducible
// against a real fs on both POSIX and Windows.

const mocks = vi.hoisted(() => ({
	mkdir: vi.fn(async () => undefined),
	readFile: vi.fn(),
	writeFile: vi.fn(async () => undefined),
	readdir: vi.fn(async () => []),
	rm: vi.fn(async () => undefined),
	stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => mocks);

// Import after vi.mock so the SUT binds to the mocked module.
const { BusinessError } = await import("./BusinessError.js");
const { ScopedFsService } = await import("./ScopedFsService.js");

function makeAccessError(code = "EACCES"): NodeJS.ErrnoException {
	const error = new Error(`${code}: permission denied`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

function makeService() {
	return new ScopedFsService((featureId) => `/tmp/fake/${featureId}`);
}

afterEach(() => {
	vi.clearAllMocks();
	// Restore benign defaults for calls that touch mkdir (used by #resolve).
	mocks.mkdir.mockResolvedValue(undefined);
});

describe("ScopedFsService defensive fs failure handling", () => {
	it("rethrows non-modeled errno codes from exists() unchanged", async () => {
		// Covers ScopedFsService.exists: the `throw translateFsError(...)` after
		// the ENOENT/ENOTDIR early-return, and translateFsError's default arm
		// which passes unmapped codes through untouched for the IPC scrubber.
		const eacces = makeAccessError("EACCES");
		mocks.stat.mockRejectedValueOnce(eacces);

		const service = makeService();
		const error = await service
			.exists("kilo.todos", "locked/inside.txt")
			.catch((cause: unknown) => cause);

		// translateFsError's default: unmapped codes are returned unchanged, so
		// the caller receives the original NodeJS.ErrnoException — NOT a
		// BusinessError (whose message would cross the IPC boundary).
		expect(error).toBe(eacces);
		expect(error).not.toBeInstanceOf(BusinessError);
	});

	it("passes non-Error throwables through translateFsError untouched", async () => {
		// isFsError guard: things that are not Error instances (e.g. a bare
		// object thrown from a broken adapter) bypass the switch entirely and
		// are returned as-is.
		const weird = { not: "an-error" };
		mocks.readdir.mockRejectedValueOnce(weird);

		const service = makeService();
		const error = await service.readdir("kilo.todos", "any").catch((cause: unknown) => cause);
		expect(error).toBe(weird);
	});
});
