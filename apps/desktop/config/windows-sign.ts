import { execFile as execFileCallback } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const TIMESTAMP_URL = "http://timestamp.digicert.com";

/**
 * Offset of `e_lfanew` in the MZ header — a uint32 pointing to the PE
 * signature. Used to locate the Certificate Table data-directory entry.
 */
const E_LFANEW_OFFSET = 0x3c;
/** PE32+ optional-header magic. */
const PE32_PLUS_MAGIC = 0x20b;
/** PE32 optional-header magic. */
const PE32_MAGIC = 0x10b;
/**
 * Byte offset of the Certificate Table entry within the optional header's
 * data-directory array (index 4, each entry is 8 bytes).
 */
const CERT_TABLE_OFFSET_PE32 = 128;
const CERT_TABLE_OFFSET_PE32_PLUS = 144;

export interface AzureWindowsSigningEnvironment {
	readonly AZURE_CERT_NAME?: string;
	readonly AZURE_KEY_VAULT_URI?: string;
}

export function hasAzureWindowsSigningCredentials(
	environment: AzureWindowsSigningEnvironment = process.env,
): boolean {
	return Boolean(environment.AZURE_KEY_VAULT_URI?.trim() && environment.AZURE_CERT_NAME?.trim());
}

/**
 * Returns true when the file starts with the MZ DOS header magic.
 */
async function isWindowsPortableExecutable(filePath: string): Promise<boolean> {
	const file = await open(filePath, "r");
	try {
		const magic = Buffer.alloc(2);
		const { bytesRead } = await file.read(magic, 0, magic.length, 0);
		return bytesRead === magic.length && magic[0] === 0x4d && magic[1] === 0x5a;
	} finally {
		await file.close();
	}
}

/**
 * Probes the PE Certificate Table data-directory entry to determine whether the
 * binary already carries an Authenticode signature. Files like tcl86t.dll and
 * tk86t.dll ship pre-signed from their upstream vendor; AzureSignTool fails
 * (exit code 1) when asked to sign over an existing signature without `-as`.
 *
 * Returns `true` when the file has a non-empty certificate table, `false` when
 * it is unsigned or when the PE structure cannot be parsed (the caller should
 * still attempt to sign in that case).
 */
export async function hasExistingAuthenticodeSignature(filePath: string): Promise<boolean> {
	const file = await open(filePath, "r");
	try {
		// Read e_lfanew to find the PE header
		const lfanewBuf = Buffer.alloc(4);
		if ((await file.read(lfanewBuf, 0, 4, E_LFANEW_OFFSET)).bytesRead < 4) return false;
		const peOffset = lfanewBuf.readUInt32LE(0);

		// Verify the PE\0\0 signature
		const sigBuf = Buffer.alloc(4);
		if ((await file.read(sigBuf, 0, 4, peOffset)).bytesRead < 4) return false;
		if (sigBuf.toString("ascii") !== "PE\0\0") return false;

		// Read the optional-header magic (2 bytes after the 20-byte COFF header)
		const optStart = peOffset + 4 + 20; // PE sig (4) + COFF header (20)
		const magicBuf = Buffer.alloc(2);
		if ((await file.read(magicBuf, 0, 2, optStart)).bytesRead < 2) return false;
		const magic = magicBuf.readUInt16LE(0);

		let certEntryOffset: number;
		if (magic === PE32_PLUS_MAGIC) {
			certEntryOffset = optStart + CERT_TABLE_OFFSET_PE32_PLUS;
		} else if (magic === PE32_MAGIC) {
			certEntryOffset = optStart + CERT_TABLE_OFFSET_PE32;
		} else {
			return false;
		}

		// Certificate Table entry: VirtualAddress (u32) + Size (u32)
		const certBuf = Buffer.alloc(8);
		if ((await file.read(certBuf, 0, 8, certEntryOffset)).bytesRead < 8) return false;
		const certSize = certBuf.readUInt32LE(4);

		return certSize > 0;
	} catch {
		return false;
	} finally {
		await file.close();
	}
}

/**
 * Signs a Windows binary with AzureSignTool using Key Vault Managed Identity / az login.
 * Callers must only invoke this when Azure signing mode is selected; missing credentials fail hard.
 *
 * Skips:
 * - `.node` files that lack the MZ PE magic header (non-Windows native modules)
 * - Binaries that already carry an Authenticode signature (e.g. vendored
 *   tcl86t.dll / tk86t.dll from the bridge payload)
 */
export async function signWindowsFile(
	filePath: string,
	environment: AzureWindowsSigningEnvironment = process.env,
): Promise<void> {
	const vaultUri = environment.AZURE_KEY_VAULT_URI?.trim();
	const certName = environment.AZURE_CERT_NAME?.trim();

	if (!vaultUri || !certName) {
		throw new Error("Azure Windows signing requires AZURE_KEY_VAULT_URI and AZURE_CERT_NAME.");
	}
	if (filePath.toLowerCase().endsWith(".node") && !(await isWindowsPortableExecutable(filePath))) {
		console.log(`Skipping non-Windows native module: ${filePath}`);
		return;
	}
	if (await hasExistingAuthenticodeSignature(filePath)) {
		console.log(`Skipping already-signed binary: ${filePath}`);
		return;
	}

	console.log(`Signing file with AzureSignTool: ${filePath}`);
	const { stdout, stderr } = await execFile(
		"AzureSignTool",
		["sign", "-kvu", vaultUri, "-kvc", certName, "-tr", TIMESTAMP_URL, "-v", "-kvm", filePath],
		{
			windowsHide: true,
			maxBuffer: 10 * 1024 * 1024,
		},
	);

	if (stderr?.trim()) {
		console.error(stderr);
	}
	if (stdout?.trim()) {
		console.log(stdout);
	}
}
