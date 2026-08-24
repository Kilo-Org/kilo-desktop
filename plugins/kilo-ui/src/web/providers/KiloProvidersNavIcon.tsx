import type { ComponentProps } from "react";
import { CpuIcon } from "lucide-react";

/** Settings-nav icon for the AI Providers section (matches Kilo’s providers chip). */
export function KiloProvidersNavIcon(props: ComponentProps<"svg">) {
	return <CpuIcon {...props} />;
}
