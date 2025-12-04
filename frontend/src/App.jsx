// src/App.jsx
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./index.css";

const OSRM_BASE = "https://router.project-osrm.org";
// Use env var in production, fall back to local Flask for dev
const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:5001";

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
  const [isCalculatingScore, setIsCalculatingScore] = useState(false);
  const [isLocating, setIsLocating] = useState(true);
  const routeCalculationRef = useRef(null);

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
    // Automatically request location on page load
    if (navigator.geolocation) {
      // First, try to get current position immediately
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const current = [lat, lng];
          currentPosRef.current = current;

          // Create and place marker with custom blue icon
          const icon = L.divIcon({
            className: "user-location-marker",
            html: '<div style="background-color: #3b82f6; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });

          liveMarkerRef.current = L.marker(current, { icon }).addTo(map);
          map.setView(current, 16);
          setIsLocating(false);
          console.log("📍 Location found:", lat, lng);
        },
        (err) => {
          console.warn("Initial location request failed, will try watchPosition:", err);
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 15000 }
      );

      // Then start watching position for continuous updates
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const current = [lat, lng];
          currentPosRef.current = current;

          // Create icon for user location marker
          const icon = L.divIcon({
            className: "user-location-marker",
            html: '<div style="background-color: #3b82f6; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });

          // place / move live marker
          if (!liveMarkerRef.current) {
            liveMarkerRef.current = L.marker(current, { icon }).addTo(map);
            map.setView(current, 16);
            setIsLocating(false);
            console.log("📍 Location tracking started:", lat, lng);
          } else {
            liveMarkerRef.current.setLatLng(current);
            setIsLocating(false);
            // Smoothly update map view (only if user hasn't manually moved map)
            if (map.getZoom() >= 15) {
              map.setView(current, map.getZoom(), { animate: true, duration: 0.5 });
            }
          }

          // 🔔 Real-time safety check using ML
          try {
            const res = await fetch(`${BACKEND_BASE}/api/safety-score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat, lng }),
            });
            
            if (!res.ok) {
              throw new Error(`API error: ${res.status}`);
            }
            
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
            // Don't show alert for safety check failures, just log
          }
        },
        (err) => {
          console.error("GPS watchPosition error:", err);
          let errorMsg = "";
          
          if (err.code === err.PERMISSION_DENIED) {
            errorMsg = "❌ Location permission denied.\n\nPlease enable location access in your browser settings to use this feature.";
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            errorMsg = "❌ Location information unavailable.\n\nPlease check your GPS settings.";
          } else if (err.code === err.TIMEOUT) {
            errorMsg = "⏱️ Location request timed out.\n\nPlease try again.";
          } else {
            errorMsg = "❌ Could not get your location.\n\nError code: " + err.code;
          }
          
          // Only show alert once, not on every error
          if (!currentPosRef.current) {
            setIsLocating(false);
            alert(errorMsg);
          }
        },
        { 
          enableHighAccuracy: true, 
          maximumAge: 5000,  // Accept cached position up to 5 seconds old
          timeout: 15000     // Wait up to 15 seconds
        }
      );
    } else {
      alert("❌ Geolocation is not supported on this device or browser.");
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

    // Cancel any previous route calculation
    if (routeCalculationRef.current) {
      routeCalculationRef.current.cancelled = true;
    }

    // Reset score immediately when starting a new route search
    setRouteScore(null);
    setIsCalculatingScore(true);

    // Create a new calculation tracker
    const calculation = { cancelled: false };
    routeCalculationRef.current = calculation;

    try {
      let startCoords;

      // Use current GPS if start is empty or 'current'
      if (!startText || startText.toLowerCase().includes("current")) {
        if (!currentPosRef.current) {
          alert("Waiting for GPS signal… please try again in a few seconds.");
          setIsCalculatingScore(false);
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
        setIsCalculatingScore(false);
        return;
      }

      drawRoute(route);

      // 🔢 Automatically calculate safety score for the route
      const coordsLatLng = route.geometry.coordinates.map(([lng, lat]) => [
        lat,
        lng,
      ]);

      try {
        console.log("Calculating safety score for route with", coordsLatLng.length, "points");
        const res = await fetch(`${BACKEND_BASE}/api/score-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coords: coordsLatLng }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error("Safety score API error:", errorData);
          throw new Error(errorData.error || "Failed to calculate safety score");
        }

        const data = await res.json();
        console.log("Safety score response:", data);
        
        // Check if this calculation was cancelled
        if (calculation.cancelled) {
          console.log("Route calculation was cancelled, ignoring result");
          return;
        }
        
        if (data.score !== undefined && data.score !== null) {
          const score = Number(data.score).toFixed(1);
          console.log("Setting safety score to:", score);
          setRouteScore(score);
          
          // Force a small delay to ensure state update
          setTimeout(() => {
            if (!calculation.cancelled) {
              console.log("Safety score confirmed:", score);
            }
          }, 100);
          
          // Alert if route is unsafe
          if (data.score < 3) {
            alert(`⚠️ Warning: This route has a low safety score (${score}/10). Consider an alternative route.`);
          }
        } else {
          console.warn("Safety score was undefined in response");
          if (!calculation.cancelled) {
            setRouteScore(null);
          }
        }
      } catch (scoreErr) {
        console.error("Safety score calculation error:", scoreErr);
        if (!calculation.cancelled) {
          setRouteScore(null);
        }
        // Don't block the route display if scoring fails, but log it
        console.error("Full error details:", scoreErr);
      } finally {
        if (!calculation.cancelled) {
          setIsCalculatingScore(false);
        }
      }
    } catch (err) {
      console.error("Route calculation error:", err);
      alert("Could not calculate route. Check console for details.");
      setIsCalculatingScore(false);
      setRouteScore(null);
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
    // Show confirmation before sending SOS
    const confirmed = window.confirm(
      "🚨 Are you sure you want to send an SOS alert?\n\n" +
      "Your current location will be shared with emergency services."
    );

    if (!confirmed) {
      return;
    }

    // Prefer using the already-tracked live location if available
    if (currentPosRef.current) {
      const [lat, lng] = currentPosRef.current;
      await sendSOSWithCoords(lat, lng);
      return;
    }

    if (!navigator.geolocation) {
      alert("❌ GPS not supported on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendSOSWithCoords(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        console.error("SOS GPS error:", err);
        let errorMsg = "Could not get your location for SOS.";

        if (err.code === err.PERMISSION_DENIED) {
          errorMsg =
            "❌ Location permission denied.\n\nPlease enable location access in your browser settings.";
        } else if (err.code === err.TIMEOUT) {
          errorMsg =
            "❌ Location request timed out.\n\nPlease make sure location is enabled and try again.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          errorMsg =
            "❌ Location information unavailable.\n\nPlease check your GPS settings.";
        }

        alert(errorMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000, // give more time for location
        maximumAge: 15000, // allow a recent cached fix
      }
    );
  }

  // =========================
  // RENDER
  // =========================
  return (
    <div className="app-root" style={{ position: "relative" }}>
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
            {isCalculatingScore ? "..." : routeScore !== null ? routeScore : "—"}
          </span>
          /10
        </div>

        <button onClick={handleSOS} className="sos-btn">
          🚨 SOS
        </button>
      </div>

      <div id="map" />
      {isLocating && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(255, 255, 255, 0.95)",
          padding: "20px 30px",
          borderRadius: "10px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          zIndex: 1000,
          textAlign: "center"
        }}>
          <div style={{ fontSize: "24px", marginBottom: "10px" }}>📍</div>
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>Getting your location...</div>
          <div style={{ fontSize: "14px", color: "#666" }}>Please allow location access</div>
        </div>
      )}
    </div>
  );
}

/* ============ helpers ============ */

// Reusable helper to send SOS to the backend with given coordinates
async function sendSOSWithCoords(lat, lng) {
  try {
    // Get user info if logged in (optional)
    let userId = null;
    try {
      const userStr = sessionStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr);
        userId = user?.id || null;
      }
    } catch (e) {
      console.log("No user session found, sending anonymous SOS");
    }

    const payload = {
      user_id: userId,
      lat,
      lng,
      message: "HELP ME",
      timestamp: Date.now(),
    };

    console.log("Sending SOS alert:", payload);

    const res = await fetch(`${BACKEND_BASE}/api/sos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to send SOS alert");
    }

    alert(
      "✅ " +
        (data.message || "SOS alert sent successfully!") +
        "\n\n" +
        "Your location has been shared. Help is on the way!"
    );
  } catch (e) {
    console.error("SOS error:", e);
    alert(
      "❌ Could not send SOS alert.\n\n" +
        "Error: " +
        (e.message || "Unknown error") +
        "\n\n" +
        "Please check your internet connection and try again."
    );
  }
}

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
