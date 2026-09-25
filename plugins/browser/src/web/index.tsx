import { EarthIcon } from "lucide-react";
import { useEffect, useState } from "react";

export function BrowserIcon({ className, iconKey }: { className?: string; iconKey?: string }) {
	const [failedIcon, setFailedIcon] = useState<string>();
	useEffect(() => setFailedIcon(undefined), [iconKey]);
	return iconKey && failedIcon !== iconKey ? (
		<img
			src={iconKey}
			alt=""
			className={className}
			draggable={false}
			onError={() => setFailedIcon(iconKey)}
		/>
	) : (
		<EarthIcon className={className} />
	);
}

export { BrowserView } from "./BrowserView.js";
