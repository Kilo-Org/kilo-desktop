import { execFile as execFileCallback } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const TIMESTAMP_URL = "http://timestamp.digicert.com";

export interface AzureWindowsSigningEnvironment {
	readonly AZURE_CERT_NAME?: string;
	readonly AZURE_KEY_VAULT_URI?: string;
}

export function hasAzureWindowsSigningCredentials(
	environment: AzureWindowsSigningEnvironment = process.env,
): boolean {
	return Boolean(environment.AZURE_KEY_VAULT_URI?.trim() && environment.AZURE_CERT_NAME?.trim());
}

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
 * Signs a Windows binary with AzureSignTool using Key Vault Managed Identity / az login.
 * Callers must only invoke this when Azure signing mode is selected; missing credentials fail hard.
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
