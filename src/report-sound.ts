import { useEffect, useRef, useState } from "react";
import type { Report } from "../shared/types";
import { api, safeRead, safeWrite } from "./api";

export function newAudibleReports(
  reports: Report[],
  seen: Set<string>,
  since: number,
  now: number,
  source: string,
  magnitude: number,
) {
  return reports.filter(
    (r) =>
      !seen.has(r.id) &&
      r.new_report_at != null &&
      r.new_report_at >= since &&
      r.occurred_at >= now - 15 * 60_000 &&
      r.occurred_at <= now + 60_000 &&
      r.source === source &&
      r.magnitude >= magnitude,
  );
}

export type SoundMode = "simple" | "magnitude";
export const magnitudeBands = [
  { magnitude: 3, note: "C4", frequency: 261.63 },
  { magnitude: 3.5, note: "D4", frequency: 293.66 },
  { magnitude: 4, note: "E4", frequency: 329.63 },
  { magnitude: 4.5, note: "F4", frequency: 349.23 },
  { magnitude: 5, note: "G4", frequency: 392 },
  { magnitude: 5.5, note: "A4", frequency: 440 },
  { magnitude: 6, note: "B4", frequency: 493.88 },
  { magnitude: 6.5, note: "C5", frequency: 523.25 },
] as const;
export function magnitudeBand(magnitude: number) {
  const index = Number.isFinite(magnitude)
    ? Math.max(0, Math.min(7, Math.floor((magnitude - 3) * 2)))
    : 0;
  return magnitudeBands[index];
}

export function useReportSound() {
  const [preferred, setPreferred] = useState(() =>
    safeRead("istmo-sound", false),
  );
  const [enabled, setEnabled] = useState(false);
  const [source, setSource] = useState(() =>
    safeRead("istmo-sound-source", "up"),
  );
  const [magnitude, setMagnitude] = useState(() =>
    safeRead("istmo-sound-mag", 3),
  );
  const [mode, setMode] = useState<SoundMode>(() =>
    safeRead<string>("istmo-sound-mode", "magnitude") === "simple"
      ? "simple"
      : "magnitude",
  );
  const [message, setMessage] = useState("");
  const context = useRef<AudioContext | null>(null);
  const voices = useRef(
    new Set<{ oscillator: OscillatorNode; gain: GainNode }>(),
  );
  const prefs = useRef({ source, magnitude, mode });
  prefs.current = { source, magnitude, mode };
  const chime = (reportedMagnitude = 4, soundMode = prefs.current.mode) => {
    const audio = context.current;
    if (!audio || audio.state !== "running") return false;
    // Rapid preview taps replace the previous chime without accumulating volume.
    for (const voice of voices.current) {
      voice.gain.gain.cancelScheduledValues(audio.currentTime);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, audio.currentTime);
      voice.gain.gain.linearRampToValueAtTime(0, audio.currentTime + 0.02);
      voice.oscillator.stop(audio.currentTime + 0.025);
    }
    voices.current.clear();
    const base =
      soundMode === "simple" ? 660 : magnitudeBand(reportedMagnitude).frequency;
    for (const [offset, frequency] of [
      [0, base],
      [0.19, (base * 4) / 3],
    ]) {
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      const start = audio.currentTime + offset;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.4);
      const voice = { oscillator, gain };
      voices.current.add(voice);
      oscillator.onended = () => {
        voices.current.delete(voice);
        oscillator.disconnect();
        gain.disconnect();
      };
    }
    return true;
  };
  const playFromGesture = async (
    reportedMagnitude: number,
    soundMode: SoundMode,
  ) => {
    context.current ||= new AudioContext();
    await context.current.resume();
    if (!chime(reportedMagnitude, soundMode))
      throw new Error(
        "Your browser has paused audio. Try again with this tab in front.",
      );
  };
  const preview = async (
    reportedMagnitude = 4,
    soundMode = prefs.current.mode,
  ) => {
    try {
      await playFromGesture(reportedMagnitude, soundMode);
      setMessage(
        soundMode === "simple"
          ? "Simple chime preview."
          : `M ${reportedMagnitude.toFixed(1)} preview · ${magnitudeBand(reportedMagnitude).note}.`,
      );
    } catch (error) {
      setMessage(String(error));
    }
  };
  const enable = async () => {
    try {
      await playFromGesture(4, prefs.current.mode);
      setPreferred(true);
      safeWrite("istmo-sound", true);
      setEnabled(true);
      setMessage("Sound is on for this session.");
    } catch (error) {
      setMessage(String(error));
    }
  };
  const disable = () => {
    setEnabled(false);
    setPreferred(false);
    safeWrite("istmo-sound", false);
    setMessage("Sound is off.");
  };
  useEffect(() => {
    safeWrite("istmo-sound-source", source);
    safeWrite("istmo-sound-mag", magnitude);
    safeWrite("istmo-sound-mode", mode);
  }, [source, magnitude, mode]);
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      inFlight = false,
      initialized = false;
    let since = Date.now();
    const seen = new Set<string>();
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      const started = Date.now();
      try {
        const result = await api<{ reports: Report[] }>(
          "/api/reports?hours=1&magnitude=0&scope=panama",
        );
        if (!active) return;
        const fresh = newAudibleReports(
          result.reports,
          seen,
          since,
          started,
          prefs.current.source,
          prefs.current.magnitude,
        );
        // First response is a baseline, never an audible backlog. Revisions retain IDs.
        if (initialized && fresh.length) {
          const strongest = Math.max(...fresh.map((r) => r.magnitude));
          if (chime(strongest))
            setMessage(
              `Played a sound for ${fresh.length} new report${fresh.length === 1 ? "" : "s"} · strongest M ${strongest.toFixed(1)}.`,
            );
          else
            setMessage(
              "Audio was paused by your browser. Tap Test sound to resume it.",
            );
        }
        result.reports.forEach((r) => seen.add(r.id));
        since = started;
        initialized = true;
      } catch {
        /* The main connection indicator covers temporary outages. */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled]);
  useEffect(
    () => () => {
      void context.current?.close();
      context.current = null;
      voices.current.clear();
    },
    [],
  );
  return {
    preferred,
    enabled,
    source,
    setSource,
    magnitude,
    setMagnitude,
    message,
    mode,
    setMode,
    preview,
    enable,
    disable,
    test: () => preview(),
  };
}
export type ReportSound = ReturnType<typeof useReportSound>;
