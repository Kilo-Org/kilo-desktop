// Imported before every test file so Vite pre-bundles all shared deps in one
// pass — late discovery mid-run re-optimizes and swaps module instances
// ("Vitest failed to find the current suite" in the next test file).
import "@anaconda-agentic-desktop/feature-sdk";
import "@tanstack/react-query";
import "@testing-library/react";
import "zod";
