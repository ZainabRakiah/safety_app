# How to Retrain the Safety Model

The safety model needs to be retrained on Python 3.13 to work with Render's deployment environment.

## Quick Steps:

### Option 1: Using Python directly

1. Open a terminal/command prompt
2. Navigate to the backend folder:
   ```bash
   cd backend
   ```

3. Make sure you have the required packages:
   ```bash
   pip install pandas numpy scikit-learn joblib openpyxl
   ```

4. Run the training script:
   ```bash
   python train_safety_model.py
   ```

### Option 2: Using the virtual environment

If you have a virtual environment set up:

1. Activate the virtual environment:
   - **Windows (PowerShell):**
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
   - **Windows (CMD):**
     ```cmd
     venv\Scripts\activate.bat
     ```
   - **Mac/Linux:**
     ```bash
     source venv/bin/activate
     ```

2. Install dependencies (if needed):
   ```bash
   pip install -r requirements.txt
   pip install openpyxl  # For reading Excel files
   ```

3. Run the training script:
   ```bash
   python train_safety_model.py
   ```

### Option 3: Using Python 3.13 specifically

If you have Python 3.13 installed:

```bash
python3.13 train_safety_model.py
```

## What the script does:

1. Loads the grid features from `data/grid_features.csv`
2. Trains a LinearRegression model on safety features
3. Saves the model as `safety_model.pkl` with protocol 5 (Python 3.8+ compatible)

## After training:

1. Commit the new `safety_model.pkl` file to your repository
2. Push to GitHub
3. Render will automatically redeploy with the new model
4. The safety scores should now work!

## Troubleshooting:

- **"grid_features.csv not found"**: Run `python generate_grid_features.py` first
- **"Module not found"**: Install missing packages with `pip install <package-name>`
- **Excel file errors**: Install `openpyxl` with `pip install openpyxl`

