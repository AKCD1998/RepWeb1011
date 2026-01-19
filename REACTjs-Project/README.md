# Rx1011 Local Development

## Local Development (Windows PowerShell)

### 1) Place the patients CSV
- Default location: `REACTjs-Project\patients_rows.csv`
- Optional override: set `PATIENTS_CSV_PATH` to any full path (e.g. Downloads)

### 2) Run both backend + frontend (one command)
```powershell
$env:API_KEY="your-secret-key"
$env:VITE_API_KEY="your-secret-key"
$env:PATIENTS_CSV_PATH="C:\Users\scgro\Downloads\patients_rows.csv"  # optional
npm run dev:full
```

### 3) Run in two terminals (optional)
Terminal 1:
```powershell
$env:API_KEY="your-secret-key"
$env:PATIENTS_CSV_PATH="C:\Users\scgro\Downloads\patients_rows.csv"  # optional
npm run server
```

Terminal 2:
```powershell
$env:VITE_API_KEY="your-secret-key"
npm run dev
```

### 4) Test API with PowerShell
```powershell
$headers = @{ "X-API-KEY" = "your-secret-key" }
Invoke-RestMethod -Uri "http://localhost:3001/api/patients" -Headers $headers
```

Notes:
- Backend uses `PATIENTS_CSV_PATH` if provided, otherwise reads `patients_rows.csv` in the project root.
- If the CSV is missing, `/api/patients` returns a 500 with a helpful message.
