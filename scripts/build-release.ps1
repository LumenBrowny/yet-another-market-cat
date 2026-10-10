param([ValidateSet('local','devnet','staging')][string]$Profile='local',[Parameter(Mandatory=$true)][string]$ApiUrl,[Parameter(Mandatory=$true)][string]$RpcUrl,[switch]$Demo,[ValidateSet("localnet","devnet")][string]$Cluster)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!$env:JAVA_HOME -or !(Test-Path "$env:JAVA_HOME/bin/java.exe")) { throw 'Set JAVA_HOME to JDK 17' }
if (!$env:ANDROID_HOME -or !(Test-Path "$env:ANDROID_HOME/platform-tools/adb.exe")) { throw 'Set ANDROID_HOME to your Android SDK (API/build-tools 36)' }
New-Item -ItemType Directory -Force .dev, artifacts | Out-Null
$env:NODE_ENV='production'
$env:EXPO_NO_DOTENV='1'
$env:EXPO_PUBLIC_BUILD_PROFILE=$Profile
$env:EXPO_PUBLIC_CLUSTER=if($Cluster){$Cluster}elseif($Profile -eq 'local'){'localnet'}else{'devnet'}
$env:EXPO_PUBLIC_API_URL=$ApiUrl
$env:EXPO_PUBLIC_RPC_URL=$RpcUrl
$env:EXPO_PUBLIC_DEMO_CONTROLS=if($Demo){'true'}else{'false'}
node --import tsx scripts/validate-release-config.ts
if($LASTEXITCODE -ne 0){throw 'Invalid release configuration'}
# Preserve the development signing identity so the hackathon APK upgrades existing installs.
# This is NOT a production signing key. Use your private release key env vars for staging.
if(!$env:YAC_ANDROID_KEYSTORE) {
  if($Profile -eq 'staging'){throw 'Staging requires explicit private signing key environment'}
  $key=Join-Path (Get-Location) '.dev/android-hackathon-005.keystore'
  if(!(Test-Path -LiteralPath $key)){
    & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -keystore $key -storepass android -keypass android -alias androiddebugkey -keyalg RSA -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'
    if($LASTEXITCODE -ne 0){throw 'Local debug signing key generation failed'}
  }
  $env:YAC_ANDROID_KEYSTORE=$key
  $env:YAC_ANDROID_STORE_PASSWORD='android'
  $env:YAC_ANDROID_KEY_ALIAS='androiddebugkey'
  $env:YAC_ANDROID_KEY_PASSWORD='android'
}
Push-Location app
try {npx expo prebuild --platform android --no-install;if($LASTEXITCODE -ne 0){throw 'Android prebuild failed'}}finally{Pop-Location}
Push-Location app/android
try {
  # React Native's Gradle inputs can miss PNG/JSON and environment-only changes.
  # Rebundle explicitly, while retaining incremental native compilation.
  ./gradlew.bat :app:createBundleReleaseJsAndAssets --rerun-tasks --no-daemon
  if($LASTEXITCODE -ne 0){throw 'Release JS/assets bundle failed'}
  ./gradlew.bat assembleRelease --no-daemon
  if($LASTEXITCODE -ne 0){throw 'Release build failed'}
}finally{Pop-Location}
$suffix=if($Demo){'-demo'}else{''}
$appMetadata=(Get-Content app/app.json -Raw -Encoding utf8 | ConvertFrom-Json).expo
$taskTag=([int]($appMetadata.version.Split(".")[1])).ToString("000")
$artifact="artifacts/app-release-$taskTag-$Profile$suffix.apk"
Copy-Item -LiteralPath 'app/android/app/build/outputs/apk/release/app-release.apk' -Destination $artifact
$info=Get-Item -LiteralPath $artifact
$signatureReport = & "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs $artifact
if($LASTEXITCODE -ne 0){throw 'APK signature verification failed'}
$certificateLine = $signatureReport | Where-Object { $_ -match '^Signer #1 certificate SHA-256 digest: ' } | Select-Object -First 1
if(!$certificateLine){throw 'APK signing certificate not found'}
$certificateSha256 = $certificateLine -replace '^Signer #1 certificate SHA-256 digest: ',''
@{package='com.yetanothercat.app';version=$appMetadata.version;versionCode=$appMetadata.android.versionCode;buildType='release';profile=$Profile;demo=[bool]$Demo;sha256=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant();certificateSha256=$certificateSha256;bytes=$info.Length;builtAt=[DateTimeOffset]::UtcNow.ToString('O');rpc=$RpcUrl;api=$ApiUrl;artifact=$artifact} | ConvertTo-Json | Set-Content -LiteralPath "$artifact.json" -Encoding utf8
