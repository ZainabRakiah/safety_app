from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import os
import joblib
import pandas as pd
import numpy as np

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
        safety_model = joblib.load(MODEL_PATH)
        print("✅ Safety model loaded")

        if os.path.exists(GRID_PATH):
            grid_df = pd.read_csv(GRID_PATH)
            print("✅ Grid features loaded")
        else:
            print("⚠️ grid_features.csv not found – fallback scoring enabled")

    except Exception as e:
        print("❌ ML load failed:", e)


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
    return "✅ SafeWalk Backend Running"


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
# ML – ROUTE SAFETY SCORE
# ======================================================
@app.route("/api/score-route", methods=["POST"])
def score_route():
    data = request.json or {}
    coords = data.get("coords")

    if not coords:
        return jsonify({"error": "coords required"}), 400

    X = np.array([get_cell_features(p[0], p[1]) for p in coords])
    preds = safety_model.predict(X)

    return jsonify({
        "score": float(np.mean(preds)),
        "segments": preds.tolist()
    })


# ======================================================
# SOS ALERT
# ======================================================
@app.route("/api/sos", methods=["POST"])
def sos():
    d = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO sos_alerts (user_id, lat, lng, message, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (
        d["user_id"], d["lat"], d["lng"],
        d["message"], d["timestamp"]
    ))
    conn.commit()
    conn.close()
    return jsonify({"message": "🚨 SOS logged"}), 201


# ======================================================
# RUN
# ======================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
