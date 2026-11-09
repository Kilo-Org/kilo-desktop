import type { ComponentProps } from "react";
import { CircleUserIcon } from "lucide-react";

/** Settings-nav icon for the Account section. */
export function AccountNavIcon(props: ComponentProps<"svg">) {
	return <CircleUserIcon {...props} />;
}
