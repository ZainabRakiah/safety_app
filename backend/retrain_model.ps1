# PowerShell script to retrain the safety model

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Retraining Safety Model" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$pythonFound = $false

# Try virtual environment first
if (Test-Path "venv\Scripts\python.exe") {
    Write-Host "Using virtual environment Python..." -ForegroundColor Green
    & "venv\Scripts\python.exe" train_safety_model.py
    $pythonFound = $true
}
elseif (Test-Path "..\backend\venv\Scripts\python.exe") {
    Write-Host "Using virtual environment Python..." -ForegroundColor Green
    & "..\backend\venv\Scripts\python.exe" train_safety_model.py
    $pythonFound = $true
}
else {
    # Try system Python
    Write-Host "Trying system Python..." -ForegroundColor Yellow
    try {
        & python train_safety_model.py
        $pythonFound = $true
    }
    catch {
        try {
            & python3 train_safety_model.py
            $pythonFound = $true
        }
        catch {
            Write-Host ""
            Write-Host "ERROR: Python not found!" -ForegroundColor Red
            Write-Host "Please install Python or activate your virtual environment." -ForegroundColor Red
            Write-Host ""
            Write-Host "See RETRAIN_MODEL.md for instructions." -ForegroundColor Yellow
            exit 1
        }
    }
}

if ($pythonFound) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Training complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Commit the new safety_model.pkl file"
    Write-Host "2. Push to GitHub"
    Write-Host "3. Render will auto-deploy with the new model"
    Write-Host ""
}

