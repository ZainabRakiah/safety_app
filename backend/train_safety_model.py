import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import joblib
import os
import sys

# Fix encoding for Windows console
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GRID_PATH = os.path.join(BASE_DIR, "data", "grid_features.csv")


def train_model():
    print("Loading grid features...")
    
    # Use the location-specific features from grid_features.csv
    if not os.path.exists(GRID_PATH):
        print("ERROR: grid_features.csv not found. Run generate_grid_features.py first.")
        return
    
    df = pd.read_csv(GRID_PATH)
    print(f"SUCCESS: Loaded {len(df)} grid cells with location-specific features")
    
    # Use the same feature names as in app.py: incident_count, camera_count, police_count
    # Map to the format expected: [incident_count, camera_count, police_count]
    X = df[["incident_count", "camera_count", "police_count"]].values
    
    # Calculate safety score using a formula that gives varied scores
    # Higher cameras and police = safer, higher incidents = less safe
    # Formula: base_score - incidents*penalty + cameras*bonus + police*bonus
    base_score = 5.0  # Base safety score
    incident_penalty = 0.4  # Each incident reduces safety
    camera_bonus = 0.3  # Each camera increases safety
    police_bonus = 1.5  # Police presence significantly increases safety
    
    y = np.clip(
        base_score
        - X[:, 0] * incident_penalty  # incident_count (crime)
        + X[:, 1] * camera_bonus      # camera_count (surveillance)
        + X[:, 2] * police_bonus,      # police_count (police presence)
        1, 10
    )
    
    print(f"   Safety score range: {y.min():.2f} to {y.max():.2f}")
    print(f"   Mean safety score: {y.mean():.2f}")
    
    # Train the model
    model = LinearRegression()
    model.fit(X, y)
    
    # Save the model with protocol 4 for maximum compatibility
    # Protocol 4 works with Python 2.7+ and all Python 3.x versions
    # This ensures compatibility between Python 3.14 (local) and Python 3.13 (Render)
    model_path = os.path.join(BASE_DIR, "safety_model.pkl")
    import pickle
    # Use protocol 4 for maximum compatibility across Python versions
    joblib.dump(model, model_path, protocol=4)
    print(f"SUCCESS: Safety ML model trained & saved to {model_path} (protocol 4, maximum compatibility)")
    
    # Show model coefficients to understand feature importance
    print(f"\nModel coefficients (feature importance):")
    print(f"   Incident count: {model.coef_[0]:.3f} (negative = reduces safety)")
    print(f"   Camera count: {model.coef_[1]:.3f} (positive = increases safety)")
    print(f"   Police count: {model.coef_[2]:.3f} (positive = increases safety)")
    print(f"   Intercept: {model.intercept_:.3f}")


if __name__ == "__main__":
    train_model()
