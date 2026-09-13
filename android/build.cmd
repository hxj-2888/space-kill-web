@echo off
rem ============================================================
rem Space Kill (太空杀) - Android APK build script (no Gradle)
rem Requires: JDK 17 + Android SDK (build-tools 34.0.0 / platform android-34) + 7-Zip
rem Output:   android\SpaceKill.apk
rem
rem Usage:  node android\sync-www.cjs   ^&^&  android\build.cmd
rem
rem Pipeline notes (same constraints as the ping-pong project; do not "simplify"):
rem  - aapt2 cannot open source paths containing non-ASCII characters, so every
rem    build input is copied to %TEMP%\sk_apk_build first and built from there.
rem  - aapt2 link runs WITHOUT -A assets; assets/ and classes.dex are added with
rem    7-Zip afterwards, which keeps resources.arsc STORED (uncompressed).
rem    A compressed resources.arsc makes some devices fail with "invalid package".
rem  - Signing uses a persistent keystore (android\release.keystore) so each build
rem    shares one signature and users can install over older versions. Passwords
rem    are NOT hardcoded: read from the gitignored root .env (KEYSTORE_PASS / KEY_PASS).
rem ============================================================
setlocal
set "SDK=%LOCALAPPDATA%\Android\Sdk"
set "BT=%SDK%\build-tools\34.0.0"
set "PLAT=%SDK%\platforms\android-34\android.jar"
set "SZ=%ProgramFiles%\7-Zip\7z.exe"
set "ROOT=%~dp0"
set "WORK=%TEMP%\sk_apk_build"
set "OUT=%WORK%\build"

if not exist "%BT%\aapt2.exe" ( echo [ERR] build-tools not found: %BT% & exit /b 1 )
if not exist "%PLAT%" ( echo [ERR] platform not found: %PLAT% & exit /b 1 )
if not exist "%SZ%" ( echo [ERR] 7-Zip not found: %SZ% & exit /b 1 )
if not exist "%ROOT%assets\www\index.html" ( echo [ERR] assets/www missing - run: node android\sync-www.cjs & exit /b 1 )

rem copy build inputs to an ASCII temp workspace (aapt2 non-ASCII path fix)
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%" || goto :err
xcopy /E /I /Y /Q "%ROOT%res" "%WORK%\res" >nul || goto :err
xcopy /E /I /Y /Q "%ROOT%assets" "%WORK%\assets" >nul || goto :err
xcopy /E /I /Y /Q "%ROOT%java" "%WORK%\java" >nul || goto :err
copy /Y "%ROOT%AndroidManifest.xml" "%WORK%\AndroidManifest.xml" >nul || goto :err
set "ROOT=%WORK%\"
mkdir "%OUT%\gen" "%OUT%\classes" "%OUT%\dex" 2>nul

echo [1/7] compile resources...
"%BT%\aapt2.exe" compile --dir "%ROOT%res" -o "%OUT%\res.zip" || goto :err

echo [2/7] link manifest + resources (no -A assets: added by 7-Zip in [5/7])...
"%BT%\aapt2.exe" link -o "%OUT%\unsigned.apk" -I "%PLAT%" ^
  --manifest "%ROOT%AndroidManifest.xml" -R "%OUT%\res.zip" --auto-add-overlay ^
  --java "%OUT%\gen" --min-sdk-version 24 --target-sdk-version 34 ^
  --version-code 1 --version-name 1.0.0 || goto :err

echo [3/7] compile java...
javac -encoding UTF-8 -source 1.8 -target 1.8 -classpath "%PLAT%" -d "%OUT%\classes" ^
  "%OUT%\gen\com\sk\game\R.java" "%ROOT%java\com\sk\game\MainActivity.java" || goto :err

echo [4/7] dex...
jar cf "%OUT%\classes.jar" -C "%OUT%\classes" . || goto :err
call "%BT%\d8.bat" --release --lib "%PLAT%" --output "%OUT%\dex" "%OUT%\classes.jar" || goto :err

echo [5/7] add assets + classes.dex via 7-Zip (forward-slash names, arsc stays STORED)...
pushd "%ROOT%"
"%SZ%" a -tzip "%OUT%\unsigned.apk" assets -mx5 || goto :err
popd
pushd "%OUT%\dex"
"%SZ%" a -tzip "%OUT%\unsigned.apk" classes.dex -mx5 || goto :err
popd

echo [6/7] zipalign...
"%BT%\zipalign.exe" -f 4 "%OUT%\unsigned.apk" "%OUT%\aligned.apk" || goto :err

echo [7/7] sign...
if "%KEYSTORE_PASS%"=="" for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0..\.env") do (
  if /i "%%a"=="KEYSTORE_PASS" set "KEYSTORE_PASS=%%b"
)
if "%KEY_PASS%"=="" for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0..\.env") do (
  if /i "%%a"=="KEY_PASS" set "KEY_PASS=%%b"
)
if "%KEYSTORE_PASS%"=="" ( echo [ERR] KEYSTORE_PASS missing - add it to ..\.env & exit /b 1 )
if "%KEY_PASS%"=="" ( echo [ERR] KEY_PASS missing - add it to ..\.env & exit /b 1 )
if not exist "%~dp0release.keystore" (
  keytool -genkeypair -keystore "%~dp0release.keystore" -alias sk -keyalg RSA -keysize 2048 ^
    -validity 10000 -storepass "%KEYSTORE_PASS%" -keypass "%KEY_PASS%" -dname "CN=SpaceKill, OU=SpaceKill, O=SpaceKill, L=CN, S=CN, C=CN" -noprompt
)
call "%BT%\apksigner.bat" sign --ks "%~dp0release.keystore" --ks-pass pass:%KEYSTORE_PASS% ^
  --key-pass pass:%KEY_PASS% --v1-signing-enabled false --out "%OUT%\SpaceKill.apk" "%OUT%\aligned.apk" || goto :err

rem copy the APK back to android/ (build output) and to the site root (deploy input).
rem The published filename is UNVERSIONED on purpose: the download URL stays stable
rem (https://space-kill-web.pages.dev/SpaceKill.apk) so a new build can never leave a
rem dead link behind -- the version lives in the APK (versionName) instead.
copy /Y "%OUT%\SpaceKill.apk" "%~dp0SpaceKill.apk" >nul || goto :err
copy /Y "%OUT%\SpaceKill.apk" "%~dp0..\SpaceKill.apk" >nul || goto :err
echo.
echo [DONE] %~dp0SpaceKill.apk
echo [DONE] %~dp0..\SpaceKill.apk   (deploy copy, served at /SpaceKill.apk)
exit /b 0

:err
echo [ERR] build failed
exit /b 1
