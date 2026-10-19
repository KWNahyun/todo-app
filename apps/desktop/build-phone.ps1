# 휴대폰(안드로이드) APK 빌드 → 서명 → (연결돼 있으면) 설치
# Windows 개발자 모드가 꺼져 있어도 되게: tauri 가 만든 .so 를 복사하고 gradle 을 직접 돌림
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\30.0.16248370"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$ver = (Get-Content "$here\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version

# 1) Rust 라이브러리 (마지막 심볼릭 링크 단계에서 실패해도 .so 는 만들어짐)
Push-Location $here
$ErrorActionPreference = "Continue"
npx tauri android build --apk --target aarch64 *> "$env:TEMP\dt-phone-build.log"
$ErrorActionPreference = "Stop"
Pop-Location
$so = "$here\src-tauri\target\aarch64-linux-android\release\libdailytodo_lib.so"
$jni = "$here\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
New-Item -ItemType Directory -Force $jni | Out-Null
Copy-Item $so "$jni\libdailytodo_lib.so" -Force

# 2) APK
Push-Location "$here\src-tauri\gen\android"
.\gradlew.bat assembleArm64Release -x rustBuildArm64Release --console=plain -q
if ($LASTEXITCODE) { throw "gradle 실패" }
Pop-Location

# 3) 서명 (이 PC 의 디버그 키 — 개인 설치용)
$bt = (Get-ChildItem "$env:ANDROID_HOME\build-tools" | Sort-Object Name | Select-Object -Last 1).FullName
$dir = "$here\src-tauri\gen\android\app\build\outputs\apk\arm64\release"
$out = "$here\DailyTodo-phone-$ver.apk"
& "$bt\zipalign.exe" -f -p 4 "$dir\app-arm64-release-unsigned.apk" "$dir\aligned.apk"
& "$bt\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out $out "$dir\aligned.apk"
Remove-Item "$out.idsig" -ErrorAction SilentlyContinue
"APK: $out"

# 4) 휴대폰이 연결돼 있으면 설치
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
if ((& $adb devices) -match "`tdevice") { & $adb install -r $out }
