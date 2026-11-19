import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { toast } from "@kilo-desktop/ui/components/sonner";

/** Opens an update's download link in the browser, explaining when that fails. */
export function useOpenDownload(): (url: string) => Promise<void> {
	const os = useDomainObject(KernelOs);
	return async (url: string) => {
		try {
			if (os && (await os.methods.openExternal({ url }))) return;
			toast.error("Could not open the download link", { description: url });
		} catch (error) {
			toast.error("Could not open the download link", {
				description: error instanceof Error ? error.message : url,
			});
		}
	};
}
