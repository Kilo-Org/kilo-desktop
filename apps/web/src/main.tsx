import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./globals.css";
import { AppProviders } from "@/app/AppProviders";
import { WEB_FEATURES } from "@/features/features";
import { createLocalApi } from "@/platform/createLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Renderer root element was not found.");

const localApi = createLocalApi();
const featureSystem = createAppFeatureSystem(localApi, WEB_FEATURES);

createRoot(root).render(
	<StrictMode>
		<AppProviders localApi={localApi} system={featureSystem} />
	</StrictMode>,
);
