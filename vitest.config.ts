import { defineConfig } from 'vitest/config';

// Unit tests for the pure logic under src/utils — footprint geometry, the tool
// catalogue, board layout, isolation routing and the paste stencil. None of it
// touches the DOM, so these run in node rather than jsdom; the SPICE engine is
// a WASM binary and is deliberately not loaded here.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Board layout runs a real router over real presets; the default 5s is not
    // enough for the two full-board integration cases.
    testTimeout: 60_000,
  },
});
