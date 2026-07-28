import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import "./globals.css";
import { createDesktopQueryClient } from "@/lib/query/client";
import { createLocalApi } from "@/platform/createLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";
import { router } from "@/router";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Renderer root element was not found.");

const localApi = createLocalApi();
const queryClient = createDesktopQueryClient();

createRoot(root).render(
	<StrictMode>
		<LocalApiProvider api={localApi}>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</LocalApiProvider>
	</StrictMode>,
);
