import { describe, expect, it } from "vitest";

import {
	isInvalidPipeHandleAddress,
	resolveDarwinPeer,
	resolveLinuxPeer,
	resolveWindowsPeer,
} from "./peer-credentials";

/**
 * Unit coverage for the per-platform FFI resolvers, exercised with a fake koffi
 * so the highest-risk unrun paths (Windows especially) are tested on any host:
 *   - Windows: CreateFileW's INVALID_HANDLE_VALUE across pointer widths, the
 *     busy-pipe retry, pid/image extraction, and UTF-16 decode.
 *   - Linux: the 12-byte ucred struct layout.
 *   - macOS: getpeereid failure must fail closed rather than yield a null uid.
 * The happy path against a real listener lives in the integration spec.
 */

type Syscall = (...args: never[]) => number;

interface DarwinSyscalls {
	readonly getsockopt: Syscall;
	readonly getpeereid: Syscall;
	readonly procPidpath?: (pid: number, buffer: Buffer, size: number) => number;
}

function fakeKoffi(syscalls: DarwinSyscalls) {
	const funcs: Record<string, unknown> = {
		getsockopt: syscalls.getsockopt,
		getpeereid: syscalls.getpeereid,
		proc_pidpath: syscalls.procPidpath ?? (() => 0),
	};
	const lib = { func: (name: string) => funcs[name] };
	const koffi = {
		load: () => lib,
		out: (type: unknown) => type,
		inout: (type: unknown) => type,
		pointer: (type: string) => type,
		address: () => 0n,
	};
	return { koffi, lib };
}

function callDarwin(syscalls: DarwinSyscalls) {
	const { koffi, lib } = fakeKoffi(syscalls);
	return resolveDarwinPeer(
		koffi as Parameters<typeof resolveDarwinPeer>[0],
		lib as Parameters<typeof resolveDarwinPeer>[1],
		7,
	);
}

const writePid =
	(pid: number): Syscall =>
	(...args: never[]) => {
		const out = args[3] as unknown as number[];
		out[0] = pid;
		return 0;
	};

const writeUid =
	(uid: number): Syscall =>
	(...args: never[]) => {
		const out = args[1] as unknown as number[];
		out[0] = uid;
		return 0;
	};

describe("isInvalidPipeHandleAddress", () => {
	it("treats the null handle and both INVALID_HANDLE_VALUE widths as invalid", () => {
		expect(isInvalidPipeHandleAddress(0n)).toBe(true);
		expect(isInvalidPipeHandleAddress(0xffff_ffff_ffff_ffffn)).toBe(true);
		expect(isInvalidPipeHandleAddress(0xffff_ffffn)).toBe(true);
	});

	it("treats a real handle address as valid", () => {
		expect(isInvalidPipeHandleAddress(0x1n)).toBe(false);
		expect(isInvalidPipeHandleAddress(0x7fff_1234_abcdn)).toBe(false);
	});
});

describe("resolveDarwinPeer", () => {
	it("returns null when the peer pid cannot be read", () => {
		expect(callDarwin({ getsockopt: () => 1, getpeereid: writeUid(501) })).toBeNull();
	});

	it("returns null when the peer pid is not positive", () => {
		expect(callDarwin({ getsockopt: writePid(0), getpeereid: writeUid(501) })).toBeNull();
	});

	it("fails closed when getpeereid fails instead of trusting a null uid", () => {
		expect(callDarwin({ getsockopt: writePid(4321), getpeereid: () => 1 })).toBeNull();
	});

	it("reads the peer pid, uid, and executable image on success", () => {
		const peer = callDarwin({
			getsockopt: writePid(4321),
			getpeereid: writeUid(501),
			procPidpath: (_pid, buffer) => {
				const image = "/usr/local/bin/runtimed";
				buffer.write(image, 0, "utf8");
				return Buffer.byteLength(image);
			},
		});
		expect(peer).toEqual({ pid: 4321, uid: 501, executablePath: "/usr/local/bin/runtimed" });
	});
});

function fakeLinuxKoffi(getsockopt: (...args: never[]) => number) {
	const lib = { func: () => getsockopt };
	const koffi = {
		load: () => lib,
		out: (type: unknown) => type,
		inout: (type: unknown) => type,
		pointer: (type: string) => type,
		address: () => 0n,
	};
	return { koffi, lib };
}

async function callLinux(getsockopt: (...args: never[]) => number) {
	const { koffi, lib } = fakeLinuxKoffi(getsockopt);
	return resolveLinuxPeer(
		koffi as unknown as Parameters<typeof resolveLinuxPeer>[0],
		lib as unknown as Parameters<typeof resolveLinuxPeer>[1],
		7,
	);
}

const writeUcred =
	(pid: number, uid: number) =>
	(...args: never[]) => {
		const optval = args[3] as unknown as Buffer;
		optval.writeInt32LE(pid, 0);
		optval.writeUInt32LE(uid, 4);
		return 0;
	};

describe("resolveLinuxPeer", () => {
	it("returns null when SO_PEERCRED fails", async () => {
		expect(await callLinux(() => 1)).toBeNull();
	});

	it("returns null when the peer pid is not positive", async () => {
		expect(await callLinux(writeUcred(0, 501))).toBeNull();
	});

	it("reads pid and uid from the 12-byte ucred struct", async () => {
		// executablePath resolves /proc/<pid>/exe, absent for a fake pid on any
		// runner, so only the ucred-parsed pid/uid are asserted here.
		expect(await callLinux(writeUcred(4321, 501))).toMatchObject({ pid: 4321, uid: 501 });
	});
});

interface WindowsSyscalls {
	readonly createFileW?: () => unknown;
	readonly getLastError?: () => number;
	readonly waitNamedPipeW?: () => number;
	readonly getServerPid: (handle: unknown, out: number[]) => number;
	readonly openProcess?: () => unknown;
	readonly queryImage?: (handle: unknown, flags: number, buffer: Buffer, size: number[]) => number;
	readonly closeHandle?: () => number;
	/** Override koffi.address to exercise the BigInt-coercion of the handle. */
	readonly address?: (value: unknown) => unknown;
}

function fakeWindowsKoffi(syscalls: WindowsSyscalls) {
	const funcs: Record<string, unknown> = {
		CreateFileW: syscalls.createFileW ?? (() => 0x1234n),
		GetLastError: syscalls.getLastError ?? (() => 0),
		WaitNamedPipeW: syscalls.waitNamedPipeW ?? (() => 1),
		GetNamedPipeServerProcessId: syscalls.getServerPid,
		OpenProcess: syscalls.openProcess ?? (() => 0x9n),
		QueryFullProcessImageNameW: syscalls.queryImage ?? (() => 0),
		CloseHandle: syscalls.closeHandle ?? (() => 1),
	};
	return {
		load: () => ({ func: (name: string) => funcs[name] }),
		out: (type: unknown) => type,
		inout: (type: unknown) => type,
		pointer: (type: string) => type,
		// CreateFileW returns the handle "address" directly in these fakes.
		address: syscalls.address ?? ((value: unknown) => (typeof value === "bigint" ? value : 0x1n)),
	};
}

async function callWindows(syscalls: WindowsSyscalls) {
	const koffi = fakeWindowsKoffi(syscalls);
	return resolveWindowsPeer(
		koffi as unknown as Parameters<typeof resolveWindowsPeer>[0],
		"\\\\.\\pipe\\runtimed",
	);
}

const writeServerPid = (pid: number) => (_handle: unknown, out: number[]) => {
	out[0] = pid;
	return 1;
};

describe("resolveWindowsPeer", () => {
	it("returns null when the pipe handle is invalid for a non-busy reason", async () => {
		expect(
			await callWindows({
				createFileW: () => 0xffff_ffff_ffff_ffffn,
				getLastError: () => 5, // ERROR_ACCESS_DENIED
				getServerPid: writeServerPid(4321),
			}),
		).toBeNull();
	});

	it("returns null when GetNamedPipeServerProcessId fails", async () => {
		expect(await callWindows({ getServerPid: () => 0 })).toBeNull();
	});

	it("returns null when the server pid is not positive", async () => {
		expect(await callWindows({ getServerPid: writeServerPid(0) })).toBeNull();
	});

	it("retries a busy pipe, then reads pid and image (uid is null on Windows)", async () => {
		const image = "C:\\Program Files\\runtimed.exe";
		let opens = 0;
		const peer = await callWindows({
			createFileW: () => (++opens === 1 ? 0xffff_ffff_ffff_ffffn : 0x1234n),
			getLastError: () => 231, // ERROR_PIPE_BUSY
			waitNamedPipeW: () => 1,
			getServerPid: writeServerPid(4321),
			openProcess: () => 0x9n,
			queryImage: (_handle, _flags, buffer, size) => {
				buffer.write(image, 0, "utf16le");
				size[0] = image.length;
				return 1;
			},
		});
		expect(opens).toBe(2); // first open was busy; retried after WaitNamedPipeW
		expect(peer).toEqual({ pid: 4321, uid: null, executablePath: image });
	});

	it("still returns an identity with a null image when QueryFullProcessImageNameW fails", async () => {
		const peer = await callWindows({
			getServerPid: writeServerPid(4321),
			openProcess: () => 0x9n,
			queryImage: () => 0,
		});
		expect(peer).toEqual({ pid: 4321, uid: null, executablePath: null });
	});

	it("treats a Number-valued invalid handle address as invalid (BigInt coercion)", async () => {
		// If koffi.address ever returned a Number instead of a bigint, a bigint-Set
		// membership check would miss and a failed CreateFileW would be treated as a
		// live handle. The 32-bit INVALID_HANDLE_VALUE returned as a Number must
		// still be rejected (deny), not accepted.
		const peer = await callWindows({
			address: () => 0xffff_ffff, // Number, not 0xffff_ffffn
			getLastError: () => 5, // not ERROR_PIPE_BUSY → no retry
			getServerPid: writeServerPid(4321),
		});
		expect(peer).toBeNull();
	});
});
