import type { ComponentProps } from "react";

import { KiloMark } from "./KiloMark.js";

/** Settings-nav icon for the Kilo account section. */
export function KiloAccountNavIcon(props: ComponentProps<"svg">) {
	return <KiloMark {...props} />;
}
