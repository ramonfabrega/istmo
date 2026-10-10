import { t, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import {
  Globe2,
  LocateFixed,
  Navigation,
  Minus,
  Plus,
  X,
  Users,
} from "lucide-react";
import { magnitudeColor } from "./appearance";
import { ago } from "./api";
import { isFreshReport, pointCollection } from "./map-data";
import type { Report, Station } from "../shared/types";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
export interface CirclePin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  detail: string;
  kind: "person" | "place";
}
export interface CircleLayer {
  id: string;
  onDismiss: () => void;
  pins: CirclePin[];
  picking: boolean;
  onPick: (latitude: number, longitude: number) => void;
  onSelect: (pin: CirclePin) => void;
}
export default function Globe({
  reports,
  stations,
  selected,
  focusRequest,
  onSelect,
  onStation,
  circle,
  onDismiss,
  onCircleToggle,
}: {
  reports: Report[];
  stations: Station[];
  selected: Report | null;
  focusRequest: { report: Report; nonce: number } | null;
  onSelect: (r: Report) => void;
  onStation: (s: Station) => void;
  circle?: CircleLayer;
  onDismiss?: () => void;
  onCircleToggle?: () => void;
}) {
  const locale = useLocale();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const refreshLabels = useRef(() => {});
  useEffect(() => {
    refreshLabels.current();
  }, [locale]);
  const latest = useRef({ reports, stations, onSelect, onStation, onDismiss });
  latest.current = { reports, stations, onSelect, onStation, onDismiss };
  const circleRef = useRef(circle);
  circleRef.current = circle;
  const circleFitted = useRef("");
  const beforeCircle = useRef<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  const pickerRequest = useRef(0);
  const freshMarkers = useRef(new Map<string, maplibregl.Marker>());
  const stationMarkers = useRef(new Map<string, maplibregl.Marker>());
  const dataSignatures = useRef({ reports: "" });
  const locationRequest = useRef(0);
  const [position, setPosition] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const requestLocation = (center: boolean) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError(
        t("Location needs HTTPS. Open the secure studio link to use it."),
      );
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        if (request !== locationRequest.current) return;
        const { latitude, longitude, accuracy } = result.coords;
        setPosition({ latitude, longitude, accuracy });
        setLocating(false);
        if (center) {
          setGlobal(false);
          map.current?.easeTo({
            center: [longitude, latitude],
            zoom: Math.max(map.current.getZoom(), 9),
            duration: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? 0
              : 750,
          });
        }
      },
      (failure) => {
        if (request !== locationRequest.current) return;
        setLocating(false);
        if (failure.code === 1) setPosition(null);
        setLocationError(
          failure.code === 1
            ? t(
                "Location is off. You can allow it in your browser’s site settings.",
              )
            : failure.code === 3
              ? t("Location took too long. Tap My location to try again.")
              : t(
                  "Your location is unavailable. Tap My location to try again.",
                ),
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };
  useEffect(() => {
    let active = true;
    let permission: PermissionStatus | undefined;
    const changed = () => {
      if (permission?.state === "denied") {
        locationRequest.current++;
        setPosition(null);
        setLocating(false);
      }
    };
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (!active) return;
        permission = status;
        status.addEventListener("change", changed);
        // Existing permission can show a dot without moving the map or prompting.
        if (status.state === "granted") requestLocation(false);
      })
      .catch(() => {});
    return () => {
      active = false;
      locationRequest.current++;
      permission?.removeEventListener("change", changed);
    };
  }, []);
  const [freshClock, setFreshClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setFreshClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const layoutFreshMarkers = () => {
    const m = map.current;
    if (!m) return;
    const placed: Array<{ x: number; y: number; w: number }> = [];
    for (const marker of freshMarkers.current.values()) {
      const point = m.project(marker.getLngLat());
      const width = marker.getElement().offsetWidth || 100;
      const element = marker.getElement();
      const height = m.getContainer().clientHeight;
      const mapWidth = m.getContainer().clientWidth;
      const visible =
        point.x >= 0 &&
        point.x <= mapWidth &&
        point.y >= 0 &&
        point.y <= height;
      element.style.visibility = visible ? "" : "hidden";
      if (!visible) continue;
      const xOffset =
        Math.max(width / 2 + 8, Math.min(mapWidth - width / 2 - 8, point.x)) -
        point.x;
      const candidates = [8, -44, 50, -86, 92, -128, 134, -170, 176, -212];
      const rise =
        candidates.find((candidate) => {
          const bottom = point.y - candidate;
          return (
            bottom - 36 >= 76 &&
            bottom <= height - 70 &&
            !placed.some(
              (p) =>
                Math.abs(p.x - (point.x + xOffset)) < (p.w + width) / 2 + 6 &&
                Math.abs(p.y - bottom) < 42,
            )
          );
        }) ?? 8;
      marker.setOffset([xOffset, -rise]);
      element.classList.toggle("label-below", rise < 0);
      element.style.setProperty("--stem", `${rise < 0 ? -rise - 36 : rise}px`);
      element.style.setProperty("--stem-x", `${-xOffset}px`);
      placed.push({ x: point.x + xOffset, y: point.y - rise, w: width });
    }
  };
  const [overlap, setOverlap] = useState<Report[]>([]);
  const dismissPanels = () => {
    pickerRequest.current++;
    setOverlap([]);
    setLocationError("");
    latest.current.onDismiss?.();
    circleRef.current?.onDismiss();
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissPanels();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (selected) {
      pickerRequest.current++;
      setOverlap([]);
      circleRef.current?.onDismiss();
    }
  }, [selected]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [global, setGlobal] = useState(false);
  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    const clusterMarkers = new Map<number, maplibregl.Marker>();
    let resizeObserver: ResizeObserver;
    try {
      m = new maplibregl.Map({
        container: el.current,
        center: [-80.2, 8.4],
        zoom: 5.3,
        minZoom: 0.7,
        maxZoom: 14,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            land: { type: "geojson", data: "/land.json" },
            reports: {
              type: "geojson",
              cluster: true,
              clusterRadius: 34,
              clusterMaxZoom: 11,
              data: { type: "FeatureCollection", features: [] },
            },
          },
          layers: [
            {
              id: "ocean",
              type: "background",
              paint: { "background-color": "#132735" },
            },
            {
              id: "land",
              type: "fill",
              source: "land",
              paint: {
                "fill-color": [
                  "case",
                  ["==", ["get", "name"], "Panama"],
                  "#365565",
                  "#253e4e",
                ],
              },
            },
            {
              id: "coast",
              type: "line",
              source: "land",
              paint: {
                "line-color": "#577181",
                "line-width": 0.65,
                "line-opacity": 0.65,
              },
            },
            {
              id: "clusters",
              type: "circle",
              source: "reports",
              filter: ["has", "point_count"],
              paint: {
                "circle-radius": 18,
                "circle-color": "#375665",
                "circle-opacity": 0.15,
              },
            },
            {
              id: "quakes",
              type: "circle",
              source: "reports",
              filter: ["!", ["has", "point_count"]],
              paint: {
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["get", "magnitude"],
                  0,
                  4,
                  4,
                  5,
                  6,
                  7,
                  8,
                  9,
                ],
                "circle-color": [
                  "step",
                  ["get", "magnitude"],
                  "#9bbbd4",
                  4,
                  "#e9c48b",
                  5,
                  "#e9a070",
                  6,
                  "#e99aab",
                ],
                "circle-opacity": 0.9,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#182d3a",
              },
            },
          ],
        },
      });
      map.current = m;
      m.on("click", (event) => {
        if (circleRef.current?.picking) {
          circleRef.current.onPick(event.lngLat.lat, event.lngLat.lng);
          return;
        }
        if (
          !m.getLayer("quakes") ||
          !m.queryRenderedFeatures(event.point, {
            layers: ["quakes", "clusters"],
          }).length
        )
          dismissPanels();
      });
      resizeObserver = new ResizeObserver(() => m.resize());
      resizeObserver.observe(el.current);
      let clusterFrame = 0;
      const updateClusters = () => {
        if (!m.getLayer("clusters")) return;
        const visible = new Set<number>();
        for (const f of m.queryRenderedFeatures(undefined, {
          layers: ["clusters"],
        })) {
          if (!f.properties?.cluster || f.geometry.type !== "Point") continue;
          const id = Number(f.properties.cluster_id);
          if (visible.has(id)) continue;
          visible.add(id);
          const coordinates = f.geometry.coordinates as [number, number];
          if (!clusterMarkers.has(id)) {
            const button = document.createElement("button");
            button.className = "cluster-marker";
            button.textContent = String(f.properties.point_count);
            button.setAttribute(
              "aria-label",
              t("{count} agency reports in this area", {
                count: f.properties.point_count,
              }),
            );
            button.onclick = async (e) => {
              e.stopPropagation();
              dismissPanels();
              const request = ++pickerRequest.current;
              try {
                const leaves = await (
                  m.getSource("reports") as GeoJSONSource
                ).getClusterLeaves(id, 1000, 0);
                if (request !== pickerRequest.current) return;
                const ids = new Set(leaves.map((l) => l.properties?.id));
                setOverlap(
                  latest.current.reports
                    .filter((r) => ids.has(r.id))
                    .sort((a, b) => b.occurred_at - a.occurred_at),
                );
              } catch {
                setOverlap([]);
              }
            };
            clusterMarkers.set(
              id,
              new maplibregl.Marker({ element: button })
                .setLngLat(coordinates)
                .addTo(m),
            );
          } else {
            const marker = clusterMarkers.get(id)!;
            marker.setLngLat(coordinates);
            marker.getElement().textContent = String(f.properties.point_count);
            marker.getElement().setAttribute(
              "aria-label",
              t("{count} agency reports in this area", {
                count: f.properties.point_count,
              }),
            );
          }
        }
        for (const [id, marker] of clusterMarkers)
          if (!visible.has(id)) {
            marker.remove();
            clusterMarkers.delete(id);
          }
      };
      refreshLabels.current = updateClusters;
      // Query the currently rendered tiles while zooming, not only after movement ends.
      m.on("render", () => {
        const now = performance.now();
        if (now - clusterFrame < 50) return;
        clusterFrame = now;
        updateClusters();
      });
      m.on("move", layoutFreshMarkers);
      m.on("moveend", updateClusters);
      m.on("sourcedata", (e) => {
        if (e.sourceId === "reports" && e.isSourceLoaded) updateClusters();
      });
      m.on("load", () => {
        m.setProjection({ type: "globe" });
        setReady(true);
        setError("");
        const places: [string, number, number][] = [
          ["Panamá", -79.5199, 8.9824],
          ["David", -82.43, 8.43],
          ["Santiago", -80.98, 8.1],
          ["Colón", -79.9, 9.35],
          ["Chitré", -80.43, 7.96],
          ["San José", -84.08, 9.93],
        ];
        for (const [name, lng, lat] of places) {
          const label = document.createElement("div");
          label.className = "place-label";
          label.textContent = name;
          new maplibregl.Marker({
            element: label,
            anchor: "left",
            offset: [9, -9],
          })
            .setLngLat([lng, lat])
            .addTo(m);
          const visibility = () => {
            label.style.display = m.getZoom() >= 4 ? "" : "none";
          };
          m.on("zoom", visibility);
          visibility();
        }
      });
      m.on("error", () =>
        setError(
          t("Map unavailable. Reports and station readings remain below."),
        ),
      );
      m.on("click", "quakes", (e) => {
        if (circleRef.current?.picking) return;
        dismissPanels();
        const features = m.queryRenderedFeatures(
          [
            [e.point.x - 14, e.point.y - 14],
            [e.point.x + 14, e.point.y + 14],
          ],
          { layers: ["quakes"] },
        );
        const ids = new Set(features.map((f) => f.properties?.id));
        const matches = latest.current.reports.filter((r) => ids.has(r.id));
        if (matches.length > 1)
          setOverlap(matches.sort((a, b) => b.occurred_at - a.occurred_at));
        else if (matches[0]) {
          setOverlap([]);
          latest.current.onSelect(matches[0]);
        }
      });
      for (const layer of ["quakes"]) {
        m.on(
          "mouseenter",
          layer,
          () => (m.getCanvas().style.cursor = "pointer"),
        );
        m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
      }
    } catch {
      setError(
        t(
          "This browser cannot render the globe. The full activity list is still available.",
        ),
      );
    }
    return () => {
      refreshLabels.current = () => {};
      resizeObserver?.disconnect();
      for (const marker of clusterMarkers.values()) marker.remove();
      for (const marker of freshMarkers.current.values()) marker.remove();
      for (const marker of stationMarkers.current.values()) marker.remove();
      stationMarkers.current.clear();
      m?.remove();
      freshMarkers.current.clear();
      dataSignatures.current = { reports: "" };
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const fresh = reports.filter((r) => isFreshReport(r, freshClock));
    const ids = new Set(fresh.map((r) => r.id));
    const data = pointCollection(reports.filter((r) => !ids.has(r.id)));
    const signature = JSON.stringify(data);
    if (signature !== dataSignatures.current.reports) {
      dataSignatures.current.reports = signature;
      (m.getSource("reports") as GeoJSONSource).setData(data);
    }
    for (const r of fresh) {
      let marker = freshMarkers.current.get(r.id);
      if (!marker) {
        const button = document.createElement("button");
        button.className = "fresh-marker";
        button.onclick = (event) => {
          event.stopPropagation();
          const report = latest.current.reports.find(
            (item) => item.id === r.id,
          );
          if (report) {
            dismissPanels();
            latest.current.onSelect(report);
          }
        };
        marker = new maplibregl.Marker({
          element: button,
          anchor: "bottom",
          offset: [0, -8],
        })
          .setLngLat([r.longitude, r.latitude])
          .addTo(m);
        freshMarkers.current.set(r.id, marker);
      }
      marker.setLngLat([r.longitude, r.latitude]);
      const button = marker.getElement();
      button.style.setProperty("--quake-color", magnitudeColor(r.magnitude));
      button.textContent = t("New report · M {magnitude}", {
        magnitude: r.magnitude.toFixed(1),
      });
      button.setAttribute(
        "aria-label",
        t("New {agency} report, magnitude {magnitude}, {place}", {
          agency: r.source.toUpperCase(),
          magnitude: r.magnitude.toFixed(1),
          place: r.place,
        }),
      );
    }
    for (const [id, marker] of freshMarkers.current) {
      if (!ids.has(id)) {
        marker.remove();
        freshMarkers.current.delete(id);
      }
    }
    layoutFreshMarkers();
  }, [reports, freshClock, ready, locale]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const station of stations) {
      let marker = stationMarkers.current.get(station.id);
      if (!marker) {
        const button = document.createElement("button");
        button.className = "sensor-marker";
        const core = document.createElement("span");
        core.className = "sensor-core";
        button.appendChild(core);
        button.onclick = (event) => {
          event.stopPropagation();
          const current = latest.current.stations.find(
            (item) => item.id === station.id,
          );
          if (current) latest.current.onStation(current);
        };
        marker = new maplibregl.Marker({ element: button })
          .setLngLat([station.longitude, station.latitude])
          .addTo(m);
        stationMarkers.current.set(station.id, marker);
      }
      marker.setLngLat([station.longitude, station.latitude]);
      const receiving =
        !!station.last_received && Date.now() - station.last_received < 45_000;
      const label = `${station.name} · ${station.mode === "replay" ? t("recorded replay") : t("sensor station")} · ${receiving ? t("receiving data") : t("no recent data")}`;
      marker.getElement().classList.toggle("receiving", receiving);
      marker.getElement().setAttribute("aria-label", label);
      marker.getElement().title = label;
    }
    for (const [id, marker] of stationMarkers.current) {
      if (!stations.some((station) => station.id === id)) {
        marker.remove();
        stationMarkers.current.delete(id);
      }
    }
  }, [stations, ready, freshClock, locale]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !position) return;
    const element = document.createElement("div");
    element.className = "user-location-marker";
    const label = t("Your approximate location · accuracy ±{accuracy} m", {
      accuracy: Math.round(position.accuracy),
    });
    element.title = label;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", label);
    const marker = new maplibregl.Marker({ element })
      .setLngLat([position.longitude, position.latitude])
      .addTo(m);
    return () => {
      marker.remove();
    };
  }, [position, ready, locale]);
  useEffect(() => {
    if (!ready || !focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const m = map.current;
      if (!m) return;
      m.resize();
      setOverlap([]);
      setGlobal(false);
      m.easeTo({
        center: [focusRequest.report.longitude, focusRequest.report.latitude],
        zoom: Math.max(m.getZoom(), 7.3),
        offset:
          innerWidth <= 760
            ? [0, -m.getContainer().clientHeight * 0.2]
            : [0, 0],
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 750,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, ready]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !selected) return;
    const element = document.createElement("div");
    element.className = "selected-marker";
    element.style.setProperty(
      "--quake-color",
      magnitudeColor(selected.magnitude),
    );
    element.setAttribute("aria-hidden", "true");
    const marker = new maplibregl.Marker({ element })
      .setLngLat([selected.longitude, selected.latitude])
      .addTo(m);
    return () => {
      marker.remove();
    };
  }, [selected, ready]);
  useEffect(
    () =>
      setOverlap((current) =>
        current
          .map((old) => reports.find((r) => r.id === old.id))
          .filter((r): r is Report => !!r),
      ),
    [reports],
  );
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    pickerRequest.current++;
    setOverlap([]);
    if (circle && !beforeCircle.current) {
      beforeCircle.current = {
        center: m.getCenter().toArray() as [number, number],
        zoom: m.getZoom(),
      };
    } else if (!circle && beforeCircle.current) {
      // An explicit activity-row focus takes priority over restoring the old view.
      if (!selected)
        m.easeTo({
          ...beforeCircle.current,
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : 650,
        });
      beforeCircle.current = null;
      circleFitted.current = "";
    }
  }, [circle?.id, ready]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !circle) return;
    const markers = circle.pins.map((pin) => {
      const button = document.createElement("button");
      button.className = `circle-map-pin ${pin.kind}`;
      button.textContent =
        pin.kind === "place" ? "◇" : pin.name.slice(0, 2).toUpperCase();
      button.title = `${pin.name} · ${pin.detail}`;
      button.setAttribute("aria-label", button.title);
      button.onclick = (event) => {
        event.stopPropagation();
        dismissPanels();
        circleRef.current?.onSelect(pin);
      };
      return new maplibregl.Marker({ element: button })
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(m);
    });
    if (circleFitted.current !== circle.id && circle.pins.length) {
      circleFitted.current = circle.id;
      const bounds = new maplibregl.LngLatBounds();
      circle.pins.forEach((pin) =>
        bounds.extend([pin.longitude, pin.latitude]),
      );
      const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 650;
      setGlobal(false);
      if (circle.pins.length === 1) {
        m.easeTo({
          center: [circle.pins[0].longitude, circle.pins[0].latitude],
          zoom: 9,
          duration,
        });
      } else {
        m.fitBounds(bounds, {
          padding: { top: 160, bottom: 110, left: 50, right: 50 },
          maxZoom: 10,
          duration,
        });
      }
    }
    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [circle?.pins, ready]);
  const view = (world: boolean) => {
    setGlobal(world);
    map.current?.flyTo({
      center: [-80.2, 8.4],
      zoom: world ? 1.4 : 5.3,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 1200,
    });
  };
  return (
    <div className="map-shell">
      <div
        ref={el}
        className="map"
        aria-label={t(
          "Interactive globe showing earthquake reports and stations",
        )}
      />
      {error && <div className="map-error">{error}</div>}
      <div className="map-heading">
        <h1>
          {circle ? t("Your circle, on the map.") : t("Ground in motion.")}
        </h1>
        <p>
          {circle
            ? circle.picking
              ? t("Tap the map to place a gathering spot.")
              : t("Shared check-ins · not live positions.")
            : t("Panama, between two oceans.")}
        </p>
      </div>
      <div className="map-tools">
        {onCircleToggle && (
          <button
            aria-label={t("Toggle circle map")}
            title={t("Circle map")}
            aria-pressed={!!circle}
            className={circle ? "location-active" : ""}
            onClick={onCircleToggle}
          >
            <Users size={17} />
          </button>
        )}
        <button
          aria-label={t("My location")}
          title={
            position
              ? t("My location · accuracy ±{accuracy} m", {
                  accuracy: Math.round(position.accuracy),
                })
              : t("Show my location (only on this device)")
          }
          aria-busy={locating}
          className={position ? "location-active" : ""}
          disabled={!ready || locating}
          onClick={() => requestLocation(true)}
        >
          <Navigation size={17} />
        </button>
        <button className="map-view-toggle" onClick={() => view(!global)}>
          <Globe2 size={16} />
          {global ? t("Panama") : t("Globe")}
        </button>
        <button aria-label={t("Center on Panama")} onClick={() => view(false)}>
          <LocateFixed size={17} />
        </button>
        <button
          aria-label={t("Zoom in")}
          onClick={() =>
            map.current?.zoomIn({
              duration: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? 0
                : 600,
            })
          }
        >
          <Plus size={17} />
        </button>
        <button
          aria-label={t("Zoom out")}
          onClick={() =>
            map.current?.zoomOut({
              duration: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? 0
                : 600,
            })
          }
        >
          <Minus size={17} />
        </button>
      </div>
      {(locating || locationError) && (
        <div className="location-notice" role="status">
          <span>{locating ? t("Finding your location…") : locationError}</span>
          {!locating && (
            <button
              aria-label={t("Dismiss location message")}
              onClick={() => setLocationError("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <div className="map-legend">
        {circle ? (
          <>
            <span>
              <i className="dot" style={{ background: "#9ebfee" }} />
              {t("Check-in")}
            </span>
            <span>
              <i className="dot teal" />
              {t("Gathering spot")}
            </span>
          </>
        ) : (
          <>
            <span>
              <i className="dot" style={{ background: "#9bbbd4" }} />M &lt;4
            </span>
            <span>
              <i className="dot" style={{ background: "#e9c48b" }} />
              4–5
            </span>
            <span>
              <i className="dot" style={{ background: "#e9a070" }} />
              5–6
            </span>
            <span>
              <i className="dot" style={{ background: "#e99aab" }} />
              6+
            </span>
          </>
        )}
        {stations.length > 0 && (
          <span>
            <i className="dot teal" />
            {t("Station")}
          </span>
        )}
        {position && (
          <span>
            <i className="dot" style={{ background: "#9ebfee" }} />
            {circle ? t("You (this device)") : t("You")}
          </span>
        )}
      </div>
      {overlap.length > 0 && (
        <section className="map-picker" aria-label={t("Reports in this area")}>
          <header>
            <div>
              <b>
                {overlap.length} {t("agency reports")}
              </b>
              <small>
                {t("Individual reports, including different agencies")}
              </small>
            </div>
            <button
              aria-label={t("Close nearby reports")}
              onClick={() => setOverlap([])}
            >
              <X size={18} />
            </button>
          </header>
          <button
            className="zoom-group"
            onClick={() => {
              const r = overlap[0];
              map.current?.easeTo({
                center: [r.longitude, r.latitude],
                zoom: Math.min(14, (map.current?.getZoom() || 5) + 2),
                duration: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? 0
                  : 500,
              });
              setOverlap([]);
            }}
          >
            {t("Zoom into this area")} <Plus size={14} />
          </button>
          <div>
            {overlap.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onSelect(r);
                  setOverlap([]);
                }}
              >
                <b style={{ color: magnitudeColor(r.magnitude) }}>
                  M {r.magnitude.toFixed(1)}
                </b>
                <span>
                  {r.place.replace(/^Localizado en /, "")}
                  <small>
                    {r.source.toUpperCase()} · {ago(r.occurred_at)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="map-attribution">MapLibre · Natural Earth</div>
      <div className="geographic-label">8° N &nbsp; / &nbsp; 80° W</div>
    </div>
  );
}
