// Browser-local User Timing entries, visible in DevTools/Safari Web Inspector.
// No user identifiers or telemetry requests. Bound the retained measurements.
export function recordTiming(
  name: string,
  start: number,
  detail: Record<string, unknown> = {},
) {
  try {
    const key = `istmo:${name}`;
    if (performance.getEntriesByName(key, "measure").length >= 50)
      performance.clearMeasures(key);
    performance.measure(key, { start, end: performance.now(), detail });
  } catch {
    // Diagnostic support must never interrupt report delivery or rendering.
  }
}
