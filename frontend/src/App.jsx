// src/App.jsx
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./index.css";

const OSRM_BASE = "https://router.project-osrm.org";
const BACKEND_BASE = "http://127.0.0.1:5001";

export default function App() {
  const mapRef = useRef(null);
  const liveMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const routeLayerRef = useRef(null);
  const currentPosRef = useRef(null);
  const lastAlertRef = useRef(0);

  const startInputRef = useRef(null);
  const destInputRef = useRef(null);

  const [routeScore, setRouteScore] = useState(null);

  useEffect(() => {
    if (mapRef.current) return; // prevent double init

    // 1) Init map
    const map = L.map("map", {
      zoomControl: true,
    }).setView([12.9716, 77.5946], 13);
    mapRef.current = map;

    // 2) Tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    // 3) Live GPS tracking + real-time safety popup
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const current = [lat, lng];
          currentPosRef.current = current;

          // place / move live marker
          if (!liveMarkerRef.current) {
            liveMarkerRef.current = L.marker(current).addTo(map);
            map.setView(current, 16);
          } else {
            liveMarkerRef.current.setLatLng(current);
          }

          // 🔔 Real-time safety check using ML
          try {
            const res = await fetch(`${BACKEND_BASE}/api/safety-score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat, lng }),
            });
            const data = await res.json();

            if (data.safety_score !== undefined) {
              const now = Date.now();
              if (data.safety_score < 3 && now - lastAlertRef.current > 5 * 60 * 1000) {
                alert("⚠️ You are entering a low-safety area.");
                lastAlertRef.current = now;
              }
            }
          } catch (e) {
            console.error("Safety check failed:", e);
          }
        },
        (err) => {
          console.error("GPS error:", err);
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    } else {
      alert("Geolocation not supported on this device.");
    }

    // cleanup
    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // =========================
  // ROUTE HANDLERS
  // =========================
  async function handleFindRoute() {
    const startText = startInputRef.current.value.trim();
    const destText = destInputRef.current.value.trim();

    if (!destText) {
      alert("Please enter a destination");
      return;
    }

    try {
      let startCoords;

      // Use current GPS if start is empty or 'current'
      if (!startText || startText.toLowerCase().includes("current")) {
        if (!currentPosRef.current) {
          alert("Current location not available yet.");
          return;
        }
        const [lat, lng] = currentPosRef.current;
        startCoords = { lat, lng };
      } else {
        startCoords = await geocode(startText);
      }

      const destCoords = await geocode(destText);
      const route = await fetchRoute(startCoords, destCoords);
      if (!route) {
        alert("No route found");
        return;
      }

      drawRoute(route);

      // 🔢 Ask backend ML for safety score
      const coordsLatLng = route.geometry.coordinates.map(([lng, lat]) => [
        lat,
        lng,
      ]);

      const res = await fetch(`${BACKEND_BASE}/api/score-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coords: coordsLatLng }),
      });

      const data = await res.json();
      if (data.score !== undefined) {
        setRouteScore(Number(data.score).toFixed(1));
      } else {
        setRouteScore(null);
      }
    } catch (err) {
      console.error(err);
      alert("Could not calculate route. Check console for details.");
    }
  }

  function drawRoute(route) {
    const map = mapRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
    }

    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    const polyline = L.polyline(coords, {
      color: "#2563eb",
      weight: 6,
      opacity: 0.9,
    }).addTo(map);

    routeLayerRef.current = polyline;
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
  }

  // =========================
  // SOS
  // =========================
  async function handleSOS() {
    if (!navigator.geolocation) {
      alert("GPS not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const userStr = sessionStorage.getItem("user");
          const userId = userStr ? JSON.parse(userStr).id : null;

          const payload = {
            user_id: userId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            message: "HELP ME",
            timestamp: Date.now(),
          };

          await fetch(`${BACKEND_BASE}/api/sos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          alert("🚨 SOS sent. Location shared!");
        } catch (e) {
          console.error("SOS error:", e);
          alert("Could not send SOS.");
        }
      },
      (err) => {
        console.error("SOS GPS error:", err);
        alert("Could not get location for SOS.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // =========================
  // RENDER
  // =========================
  return (
    <div className="app-root">
      <div className="top-bar">
        <input
          ref={startInputRef}
          className="search-input"
          placeholder="Start (leave blank for current location)"
        />
        <input
          ref={destInputRef}
          className="search-input"
          placeholder="Destination (area / street / place)"
        />

        <button onClick={handleFindRoute} className="primary-btn">
          Find Route
        </button>

        <div className="score-chip">
          Safety:{" "}
          <span className="score-value">
            {routeScore !== null ? routeScore : "—"}
          </span>
          /10
        </div>

        <button onClick={handleSOS} className="sos-btn">
          🚨 SOS
        </button>
      </div>

      <div id="map" />
    </div>
  );
}

/* ============ helpers ============ */

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&q=" +
    encodeURIComponent(query + " Bangalore");

  const res = await fetch(url);
  const data = await res.json();

  if (!data.length) {
    throw new Error("Location not found: " + query);
  }

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

async function fetchRoute(start, end) {
  const url =
    `${OSRM_BASE}/route/v1/foot/` +
    `${start.lng},${start.lat};${end.lng},${end.lat}` +
    `?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.routes || !data.routes.length) {
    return null;
  }

  return data.routes[0];
}
