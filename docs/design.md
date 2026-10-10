# Interface principles

Istmo is a quiet maritime observatory, grounded in Panama and its two oceans. The map is the focus. No safety scores or inferred instructions.

## Visual language

Use deep ocean (#101e2a), coastal slate (#243c4d), sea glass (#8ddbd6), warm paper (#edf0ee) and DM Sans. Report colors run from blue through sand and orange to rose as magnitude increases; numeric labels keep color supplementary. Teal belongs to stations, while blue marks the user's optional location.

Keep data left-aligned, compact and readable. Avoid ornamental dashboards, scrolling text marquees and decorative motion. Reduced-motion preferences suppress pulses and camera animation. Offline is a connection state, never a flat zero trace.

## Layout and navigation

Desktop has a narrow navigation rail, a large globe and a compact activity column. Phones have a small header, flexible map, latest-report strip and safe-area bottom navigation. Activity has its own phone destination. People and Sources keep their headers and controls fixed while content scrolls within the workspace.

The regular app shows agency reports and connected live stations. Recorded replay is opt-in development content only. When a real station is connected, its compact waveform strip can expand into a bounded panel with truthful axes, units and connection status.

## Map interaction

Selecting an Activity item opens Observe and eases to its location without zooming out. Direct marker selection keeps the camera still. Cluster selection replaces existing details. A map click or Escape closes details; a drag does not.

Fresh incremental reports remain individually selectable for three minutes before joining clusters. Initial imports and outage catch-up stay quiet. Cluster counts are agency reports, not unique earthquakes. Station pulses indicate recent data receipt, not detected danger. The separate device-location glow never represents a seismograph.

Circle view reuses the same map and restores the earthquake camera on exit. It shows named gathering places and shared check-in snapshots with age and accuracy. The private device-location dot is distinct from shared circle pins.

## Controls

Notifications begin with two switches: sound while open and device notifications. Both show On/Off in text; only unavailable or busy controls are disabled. Filters, sound choices and previews live under optional disclosures. Previews do not enable alerts. Sound and push keep independent preferences.

Circles persist across occasions. Creating one needs just a circle name and your name. Invite is a single copy-link action with confirmation feedback; opening the link previews the circle before joining. Check-ins record who confirmed whom. Location sharing is a separate, initially unchecked choice on each self check-in.

See [Using Istmo](using-istmo.md) for behavior and privacy details, and [Architecture](architecture.md) for implementation boundaries.
