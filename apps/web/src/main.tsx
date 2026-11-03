import "./kernel/instrument";

import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";

import "./globals.css";
import { startRenderer } from "./kernel/boot";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Renderer root element was not found.");

void startRenderer(
	createRoot(root, {
		// @ts-expect-error -- reactErrorHandler types ErrorInfo against React 18 (componentStack: string|null); React 19 uses string|undefined
		onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
			console.warn("Uncaught error", error, errorInfo.componentStack);
		}),
		// @ts-expect-error -- same React 18/19 ErrorInfo mismatch
		onCaughtError: Sentry.reactErrorHandler(),
		onRecoverableError: Sentry.reactErrorHandler(),
	}),
	{ onBootError: (error) => Sentry.captureException(error) },
);
