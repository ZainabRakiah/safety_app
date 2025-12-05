from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import os
import joblib
import pandas as pd
import numpy as np
import requests

from db import get_db, init_db

# ======================================================
# APP SETUP
# ======================================================
app = Flask(__name__)
CORS(app)

init_db()

# ======================================================
# PATHS
# ======================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

MODEL_PATH = os.path.join(BASE_DIR, "safety_model.pkl")
GRID_PATH = os.path.join(DATA_DIR, "grid_features.csv")

# ======================================================
# ML LOAD
# ======================================================
safety_model = None
grid_df = None

GRID_STEP = 0.0015


def load_ml():
    global safety_model, grid_df
    try:
        if os.path.exists(MODEL_PATH):
            # Try loading with different compatibility options
            try:
                safety_model = joblib.load(MODEL_PATH, mmap_mode=None)
                print("✅ Safety model loaded")
            except Exception as e1:
                # If that fails, try with pickle protocol compatibility
                print(f"⚠️ Standard load failed ({e1}), trying compatibility mode...")
                try:
                    import pickle
                    # Try loading with pickle protocol 4 (more compatible)
                    with open(MODEL_PATH, 'rb') as f:
                        safety_model = pickle.load(f)
                    print("✅ Safety model loaded (compatibility mode)")
                except Exception as e2:
                    print(f"❌ Model load failed with both methods:")
                    print(f"   Standard: {e1}")
                    print(f"   Compatibility: {e2}")
                    print("   💡 Tip: Retrain the model on Python 3.13 or use the same Python version")
                    safety_model = None
        else:
            print("❌ Safety model file not found:", MODEL_PATH)
            safety_model = None

        if os.path.exists(GRID_PATH):
            grid_df = pd.read_csv(GRID_PATH)
            print(f"✅ Grid features loaded: {len(grid_df)} cells")
        else:
            print("⚠️ grid_features.csv not found – run generate_grid_features.py to create it")
            grid_df = None

    except Exception as e:
        print(f"❌ ML load failed: {e}")
        import traceback
        traceback.print_exc()
        safety_model = None
        # Don't set grid_df to None here, let it try to load separately


load_ml()

# ======================================================
# HELPERS
# ======================================================
def make_cell(lat, lng):
    return (
        round(lat / GRID_STEP) * GRID_STEP,
        round(lng / GRID_STEP) * GRID_STEP,
    )


def get_cell_features(lat, lon):
    """Return [crime_score, camera_count, police_score]."""
    if grid_df is None:
        return [0.0, 0.0, 0.0]

    cell = make_cell(lat, lon)
    row = grid_df[
        (grid_df["cell_lat"] == cell[0]) & (grid_df["cell_lon"] == cell[1])
    ]

    if row.empty:
        return [0.0, 0.0, 0.0]

    r = row.iloc[0]

    crime_score = float(r["incident_count"])
    camera_count = float(r["camera_count"])
    police_score = float(r["police_count"])

    return [crime_score, camera_count, police_score]

# ======================================================
# ROOT
# ======================================================
@app.route("/")
def home():
    status = {
        "status": "✅ SafeWalk Backend Running",
        "model_loaded": safety_model is not None,
        "grid_loaded": grid_df is not None,
        "route_proxy": "available"
    }
    return jsonify(status)


# ======================================================
# AUTH
# ======================================================
@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.json or {}
    name, email, phone, password = (
        data.get("name"),
        data.get("email"),
        data.get("phone"),
        data.get("password"),
    )

    if not name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO users (name, email, phone, password_hash)
            VALUES (?, ?, ?, ?)
        """, (name, email, phone, generate_password_hash(password)))
        conn.commit()
        conn.close()
        return jsonify({"message": "User created"}), 201
    except:
        return jsonify({"error": "Email already exists"}), 409


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    email, password = data.get("email"), data.get("password")

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cur.fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials"}), 401

    return jsonify({
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "phone": user["phone"]
        }
    }), 200


# ======================================================
# ML – POINT SAFETY SCORE (LIVE GPS)
# ======================================================
@app.route("/api/safety-score", methods=["POST"])
def safety_score_point():
    if safety_model is None or grid_df is None:
        return jsonify({"error": "Safety model not loaded"}), 500

    data = request.json
    lat = data.get("lat")
    lng = data.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "lat & lng required"}), 400

    # ✅ SAME features as training
    features = np.array([ get_cell_features(lat, lng) ])

    score = float(safety_model.predict(features)[0])
    score = round(np.clip(score, 1, 10), 2)

    return jsonify({"safety_score": score})

# ======================================================
# OSRM ROUTE PROXY (to avoid CORS issues)
# ======================================================
@app.route("/api/route", methods=["GET"])
def get_route():
    """Proxy endpoint for OSRM routing service to avoid CORS issues."""
    try:
        start_lng = request.args.get("start_lng")
        start_lat = request.args.get("start_lat")
        end_lng = request.args.get("end_lng")
        end_lat = request.args.get("end_lat")
        overview = request.args.get("overview", "full")
        geometries = request.args.get("geometries", "geojson")
        
        if not all([start_lng, start_lat, end_lng, end_lat]):
            return jsonify({"error": "start_lng, start_lat, end_lng, end_lat are required"}), 400
        
        # Build OSRM URL
        osrm_url = (
            f"https://router.project-osrm.org/route/v1/foot/"
            f"{start_lng},{start_lat};{end_lng},{end_lat}"
            f"?overview={overview}&geometries={geometries}"
        )
        
        # Make request to OSRM
        response = requests.get(osrm_url, timeout=10)
        response.raise_for_status()
        
        return jsonify(response.json()), 200
        
    except requests.exceptions.RequestException as e:
        print(f"OSRM request error: {e}")
        return jsonify({"error": f"Failed to fetch route: {str(e)}"}), 500
    except Exception as e:
        print(f"Route proxy error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


# ======================================================
# ML – ROUTE SAFETY SCORE
# ======================================================
@app.route("/api/score-route", methods=["POST"])
def score_route():
    if safety_model is None:
        return jsonify({"error": "Safety model not loaded. Check backend logs."}), 500
    
    if grid_df is None:
        return jsonify({"error": "Grid features not loaded. Run generate_grid_features.py first."}), 500

    data = request.json or {}
    coords = data.get("coords")

    if not coords:
        return jsonify({"error": "coords required"}), 400

    if not isinstance(coords, list) or len(coords) == 0:
        return jsonify({"error": "coords must be a non-empty array"}), 400

    try:
        # Sample coordinates if route is very long (to avoid processing too many points)
        if len(coords) > 1000:
            step = len(coords) // 1000
            coords = coords[::step]
        
        X = np.array([get_cell_features(p[0], p[1]) for p in coords])
        
        if X.shape[0] == 0:
            return jsonify({"error": "No valid coordinates to score"}), 400
        
        preds = safety_model.predict(X)
        
        # Clip scores to valid range (1-10) and calculate mean
        preds_clipped = np.clip(preds, 1, 10)
        avg_score = float(np.mean(preds_clipped))
        
        return jsonify({
            "score": round(avg_score, 2),
            "segments": [round(float(x), 2) for x in preds_clipped[:100]]  # Limit segments for response size
        })
    except Exception as e:
        print(f"Error scoring route: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to calculate safety score: {str(e)}"}), 500


# ======================================================
# SOS ALERT
# ======================================================
@app.route("/api/sos", methods=["POST"])
def sos():
    try:
        d = request.json or {}
        
        # Validate required fields
        lat = d.get("lat")
        lng = d.get("lng")
        timestamp = d.get("timestamp")
        
        if lat is None or lng is None:
            return jsonify({"error": "Latitude and longitude are required"}), 400
        
        if timestamp is None:
            return jsonify({"error": "Timestamp is required"}), 400
        
        # user_id is optional (can be None for anonymous users)
        user_id = d.get("user_id")
        message = d.get("message", "HELP ME")
        
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO sos_alerts (user_id, lat, lng, message, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (
            user_id, lat, lng, message, timestamp
        ))
        conn.commit()
        conn.close()
        
        return jsonify({
            "message": "🚨 SOS alert sent successfully",
            "alert_id": cur.lastrowid
        }), 201
        
    except Exception as e:
        print(f"Error processing SOS alert: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to process SOS alert"}), 500


# ======================================================
# RELOAD ML MODEL (for development)
# ======================================================
@app.route("/api/reload-ml", methods=["POST"])
def reload_ml():
    load_ml()
    if safety_model is None or grid_df is None:
        return jsonify({
            "error": "Failed to reload ML model",
            "tip": "If you see KeyError, the model was trained on a different Python version. Retrain with: python train_safety_model.py"
        }), 500
    return jsonify({"message": "ML model reloaded successfully"}), 200


# ======================================================
# RUN
# ======================================================
if __name__ == "__main__":
    # When running on platforms like Render, the port is provided via the
    # PORT environment variable. Locally, we fall back to 5001.
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
