# Daily Todo: 테스트 → exe 빌드 → 설치 폴더 교체 → 다시 실행
# 사용: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# PATH 에 python 이 없을 때(설치 프로그램이 환경 변수를 바꾼 경우)도 동작하게 직접 경로 사용
$py = Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }

Write-Host '1/4 테스트' -ForegroundColor Green
& $py -m unittest discover -s tests
if ($LASTEXITCODE -ne 0) { throw '테스트 실패 — 빌드하지 않습니다' }

Write-Host '2/4 빌드' -ForegroundColor Green
& $py -m PyInstaller --noconfirm --clean --windowed --name DailyTodo --icon icon.ico --add-data 'icon.ico;.' todo.pyw
if ($LASTEXITCODE -ne 0) { throw '빌드 실패' }

Write-Host '3/4 설치' -ForegroundColor Green
# 데이터는 바뀔 때마다 저장되므로 바로 종료해도 안전 (정상 종료 창을 띄우지 않으려고)
Get-Process DailyTodo -ErrorAction SilentlyContinue | Stop-Process
Start-Sleep -Seconds 1
$dest = Join-Path $env:LOCALAPPDATA 'Programs\DailyTodo'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item 'dist\DailyTodo' $dest -Recurse
Remove-Item build -Recurse -Force
Remove-Item DailyTodo.spec

Write-Host '4/4 실행' -ForegroundColor Green
Start-Process (Join-Path $dest 'DailyTodo.exe')
