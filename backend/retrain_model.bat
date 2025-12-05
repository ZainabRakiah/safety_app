@echo off
echo ========================================
echo Retraining Safety Model
echo ========================================
echo.

REM Try different Python commands
if exist "venv\Scripts\python.exe" (
    echo Using virtual environment Python...
    venv\Scripts\python.exe train_safety_model.py
) else if exist "..\backend\venv\Scripts\python.exe" (
    echo Using virtual environment Python...
    ..\backend\venv\Scripts\python.exe train_safety_model.py
) else (
    echo Trying system Python...
    python train_safety_model.py
    if errorlevel 1 (
        echo Trying python3...
        python3 train_safety_model.py
        if errorlevel 1 (
            echo.
            echo ERROR: Python not found!
            echo Please install Python or activate your virtual environment.
            echo.
            echo See RETRAIN_MODEL.md for instructions.
            pause
            exit /b 1
        )
    )
)

echo.
echo ========================================
echo Training complete!
echo ========================================
echo.
echo Next steps:
echo 1. Commit the new safety_model.pkl file
echo 2. Push to GitHub
echo 3. Render will auto-deploy with the new model
echo.
pause

