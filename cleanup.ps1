# cleanup.ps1  -  run from the model_brawl ROOT folder (the one that contains Backend and Frontend):
#     powershell -ExecutionPolicy Bypass -File .\cleanup.ps1
# Every destructive step asks first. Nothing here touches your source code except removing dead files.

function Ask($q) { return (Read-Host "$q [y/N]") -eq "y" }

Write-Host "`n1) Dead source files (nothing imports them)" -ForegroundColor Cyan
$dead = @(
  "Frontend\src\App.js",                       # old vanilla-JS version of the app (1655 lines)
  "Frontend\src\components\SandboxCard.jsx",   # never imported
  "Frontend\src\context\SandboxContext.jsx",   # never imported
  "Frontend\src\components\PyodideSandbox.jsx",# replaced by NotebookSandbox.jsx
  "Frontend\src\index.css",                    # empty file
  "Frontend\src\components\FloatingIcon.css"   # empty file
)
foreach ($f in $dead) { if (Test-Path $f) { Remove-Item $f -Force; Write-Host "  deleted $f" } }

Write-Host "`n2) Generated / downloaded folders (they can be recreated)" -ForegroundColor Cyan
$gen = @("Frontend\venv","Frontend\dist","Backend\__pycache__",".kilo")
foreach ($d in $gen) { if ((Test-Path $d) -and (Ask "  delete $d ?")) { Remove-Item $d -Recurse -Force; Write-Host "  deleted $d" } }

Write-Host "`n3) Uploaded test data (Backend\.uploads: CSV copies, .bak files, history snapshots, parquet caches)" -ForegroundColor Cyan
if ((Test-Path "Backend\.uploads") -and (Ask "  delete ALL of Backend\.uploads ? (only do this if you don't need those test uploads)")) {
  Remove-Item "Backend\.uploads\*" -Recurse -Force
  Write-Host "  emptied Backend\.uploads"
}

Write-Host "`n4) Stop git from tracking junk (files stay on disk)" -ForegroundColor Cyan
if (Test-Path ".git") {
  git rm -r --cached --ignore-unmatch Backend/.uploads Backend/__pycache__ Frontend/src/App.js | Out-Null
  Write-Host "  done. Now run:  git add .gitignore ; git add -A ; git commit -m 'Clean up + Python notebook'"
}

Write-Host "`n5) Reinstall the frontend packages (removes 'marked', which nothing uses)" -ForegroundColor Cyan
if (Ask "  run npm install in Frontend now?") { Push-Location Frontend; npm install; Pop-Location }

Write-Host "`nDone. The venv in Backend\venv was left alone: recreate it any time with  pip install -r Backend\requirements.txt" -ForegroundColor Green
