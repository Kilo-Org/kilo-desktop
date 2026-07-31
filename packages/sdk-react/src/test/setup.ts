// Imported before every test file so Vite pre-bundles all shared deps in one
// pass — late discovery mid-run re-optimizes and swaps module instances.
import "@tanstack/react-query";
import "@testing-library/react";
import "zod";
