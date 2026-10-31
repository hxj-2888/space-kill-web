@echo off
rem ============================================================
rem 新返航录 - Android APK build script (no Gradle)
rem Requires: JDK 17 + Android SDK (build-tools 34.0.0 / platform android-34) + 7-Zip
rem Output:   android\ReturnLog.apk
rem
rem 与乒乓对决同一套流水线（踩过的坑一并继承）：
rem   aapt2 在 Windows 上会把 zip 条目写成反斜杠，旧流程用 .NET 重新打包还会
rem   把 resources.arsc 压掉；标准 APK 必须保持 resources.arsc STORED（可 mmap）。
rem   所以：aapt2 link 时不带 -A assets，assets 与 classes.dex 由 7-Zip 追加。
rem   aapt2 打不开非 ASCII 路径（本工程目录是中文）→ 先复制到 %TEMP% 的 ASCII 工作目录。
rem   签名 v1+v2+v3 全开：部分国产 ROM 的安装器只认 v1，缺了会报「解析包错误」。
rem   密钥库固定在 android\release.keystore；口令从 ..\.env（KEYSTORE_PASS / KEY_PASS）读。
rem ============================================================
setlocal
if exist "%ANDROID_HOME%\build-tools\34.0.0\aapt2.exe" (
  set "SDK=%ANDROID_HOME%"
) else (
  set "SDK=%LOCALAPPDATA%\Android\Sdk"
)
set "BT=%SDK%\build-tools\34.0.0"
set "PLAT=%SDK%\platforms\android-34\android.jar"
set "SZ=C:\Program Files\7-Zip\7z.exe"
set "ROOT=%~dp0"
set "WORK=%TEMP%\returnlog_apk_build"
set "OUT=%WORK%\build"

if not exist "%BT%\aapt2.exe" ( echo [ERR] build-tools not found: %BT% & exit /b 1 )
if not exist "%PLAT%" ( echo [ERR] platform not found: %PLAT% & exit /b 1 )
if not exist "%SZ%" ( echo [ERR] 7-Zip not found: %SZ% & exit /b 1 )

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

echo [2/7] link manifest + resources (assets added later by 7-Zip)...
"%BT%\aapt2.exe" link -o "%OUT%\unsigned.apk" -I "%PLAT%" ^
  --manifest "%ROOT%AndroidManifest.xml" -R "%OUT%\res.zip" --auto-add-overlay ^
  --java "%OUT%\gen" --min-sdk-version 21 --target-sdk-version 34 ^
  --version-code 1 --version-name V3 || goto :err

echo [3/7] compile java...
javac -encoding UTF-8 -source 1.8 -target 1.8 -classpath "%PLAT%" -d "%OUT%\classes" ^
  "%OUT%\gen\com\hxj\returnlog\R.java" "%ROOT%java\com\hxj\returnlog\MainActivity.java" || goto :err

echo [4/7] dex...
jar cf "%OUT%\classes.jar" -C "%OUT%\classes" . || goto :err
call "%BT%\d8.bat" --release --lib "%PLAT%" --min-api 21 --output "%OUT%\dex" "%OUT%\classes.jar" || goto :err

echo [5/7] add assets + classes.dex via 7-Zip (forward-slash names, arsc stays STORED)...
pushd "%ROOT%"
"%SZ%" a -tzip "%OUT%\unsigned.apk" assets -mx5 || goto :err
popd
pushd "%OUT%\dex"
"%SZ%" a -tzip "%OUT%\unsigned.apk" classes.dex -mx5 || goto :err
popd

echo [6/7] zipalign...
"%BT%\zipalign.exe" -f -p 4 "%OUT%\unsigned.apk" "%OUT%\aligned.apk" || goto :err

echo [7/7] sign...
if "%KEYSTORE_PASS%"=="" for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0..\.env") do (
  if /i "%%a"=="KEYSTORE_PASS" set "KEYSTORE_PASS=%%b"
)
if "%KEY_PASS%"=="" for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0..\.env") do (
  if /i "%%a"=="KEY_PASS" set "KEY_PASS=%%b"
)
if "%KEYSTORE_PASS%"=="" set /p KEYSTORE_PASS=Keystore pass (KEYSTORE_PASS):
if "%KEY_PASS%"=="" set /p KEY_PASS=Key pass (KEY_PASS):
if not exist "%~dp0release.keystore" (
  keytool -genkeypair -keystore "%~dp0release.keystore" -alias returnlog -keyalg RSA -keysize 2048 ^
    -validity 10000 -storepass "%KEYSTORE_PASS%" -keypass "%KEY_PASS%" -dname "CN=ReturnLog, OU=RL, O=RL, L=CN, S=CN, C=CN" -noprompt
)
call "%BT%\apksigner.bat" sign --ks "%~dp0release.keystore" --ks-pass pass:%KEYSTORE_PASS% ^
  --key-pass pass:%KEY_PASS% --v1-signing-enabled true --out "%OUT%\ReturnLog.apk" "%OUT%\aligned.apk" || goto :err

copy /Y "%OUT%\ReturnLog.apk" "%~dp0ReturnLog.apk" >nul || goto :err
echo.
echo [DONE] %~dp0ReturnLog.apk
exit /b 0

:err
echo [ERR] build failed
exit /b 1
