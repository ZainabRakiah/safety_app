import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import joblib

GRID_SIZE = 0.005  # ≈ 500 meters


def get_cell(lat, lng):
    return (
        round(lat / GRID_SIZE) * GRID_SIZE,
        round(lng / GRID_SIZE) * GRID_SIZE,
    )


def load_data():
    print("📥 Loading datasets...")

    incident = pd.read_excel("data/incident.xlsx")
    police = pd.read_excel("data/police.xlsx")
    surv = pd.read_csv("data/surveillance.csv")

    incident.columns = incident.columns.str.lower()
    police.columns = police.columns.str.lower()
    surv.columns = surv.columns.str.lower()

    return incident, police, surv


def build_features():
    incident, police, surv = load_data()

    # ✅ Camera grid (ONLY GPS DATA WE HAVE)
    surv["cell"] = surv.apply(
        lambda r: get_cell(r["lat"], r["lon"]), axis=1
    )
    cam_count = surv.groupby("cell").size()

    # ✅ Crime severity (AREA LEVEL)
    total_incidents = incident["total_incidents"].sum()
    crime_weight = total_incidents / 1000  # normalize

    # ✅ Police presence (AREA LEVEL)
    police_weight = len(police) / 50  # normalize

    rows = []
    for cell in cam_count.index:
        rows.append({
            "crime_score": crime_weight,
            "camera_count": cam_count[cell],
            "police_score": police_weight
        })

    return pd.DataFrame(rows)


def train_model():
    df = build_features()

    X = df[["crime_score", "camera_count", "police_score"]]
    y = np.clip(
        10
        - X["crime_score"] * 1.2
        + X["camera_count"] * 0.6
        + X["police_score"] * 1.0,
        1, 10
    )

    model = LinearRegression()
    model.fit(X, y)

    joblib.dump(model, "safety_model.pkl")
    print("✅ Safety ML model trained & saved")


if __name__ == "__main__":
    train_model()
