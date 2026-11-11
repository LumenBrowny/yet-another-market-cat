param([ValidateSet('local','devnet','staging','mainnet')][string]$Profile='local',[Parameter(Mandatory=$true)][string]$ApiUrl,[Parameter(Mandatory=$true)][string]$RpcUrl,[switch]$Demo,[ValidateSet("localnet","devnet","mainnet-beta")][string]$Cluster,[string]$ProgramId,[string]$TokenMint)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!$env:JAVA_HOME -or !(Test-Path "$env:JAVA_HOME/bin/java.exe")) { throw 'Set JAVA_HOME to JDK 17' }
if (!$env:ANDROID_HOME -or !(Test-Path "$env:ANDROID_HOME/platform-tools/adb.exe")) { throw 'Set ANDROID_HOME to your Android SDK (API/build-tools 36)' }
New-Item -ItemType Directory -Force .dev, artifacts | Out-Null
$env:NODE_ENV='production'
$env:EXPO_NO_DOTENV='1'
$env:EXPO_PUBLIC_BUILD_PROFILE=$Profile
$env:EXPO_PUBLIC_CLUSTER=if($Cluster){$Cluster}elseif($Profile -eq 'mainnet'){'mainnet-beta'}elseif($Profile -eq 'local'){'localnet'}else{'devnet'}
$env:EXPO_PUBLIC_PROGRAM_ID=$ProgramId
$env:EXPO_PUBLIC_TOKEN_MINT=$TokenMint
$env:EXPO_PUBLIC_API_URL=$ApiUrl
$env:EXPO_PUBLIC_RPC_URL=$RpcUrl
$env:EXPO_PUBLIC_DEMO_CONTROLS=if($Demo){'true'}else{'false'}
node --import tsx scripts/validate-release-config.ts
if($LASTEXITCODE -ne 0){throw 'Invalid release configuration'}
if($Profile -eq 'mainnet') {
  foreach($name in @('YAC_ANDROID_KEYSTORE','YAC_ANDROID_STORE_PASSWORD','YAC_ANDROID_KEY_ALIAS','YAC_ANDROID_KEY_PASSWORD')) {
    if(![Environment]::GetEnvironmentVariable($name)){throw 'Mainnet requires all private release signing settings'}
  }
  if($env:YAC_ANDROID_KEY_ALIAS -eq 'androiddebugkey' -or (Split-Path $env:YAC_ANDROID_KEYSTORE -Leaf) -eq 'android-hackathon-005.keystore') {throw 'Mainnet must not use hackathon/debug signing'}
}
# Preserve the development signing identity so the hackathon APK upgrades existing installs.
# This is NOT a production signing key. Use your private release key env vars for staging.
if(!$env:YAC_ANDROID_KEYSTORE) {
  if($Profile -in @('staging','mainnet')){throw 'Release requires explicit private signing key environment'}
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
# Autolinking caches the previous Android package across profile changes.
$androidRoot=[IO.Path]::GetFullPath((Join-Path (Get-Location) 'app/android'))
foreach($relative in @('build/generated/autolinking','app/build/generated/autolinking')) {
  $generated=[IO.Path]::GetFullPath((Join-Path $androidRoot $relative))
  if(!$generated.StartsWith($androidRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Generated path outside Android workspace'}
  if(Test-Path -LiteralPath $generated){Remove-Item -LiteralPath $generated -Recurse -Force}
}
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
if($Profile -eq 'mainnet') {
  $appMetadata.version='1.0.2'
  $appMetadata.android.versionCode=3
  $appMetadata.android.package='cat.yetanothermarket.app'
}
$taskTag=([int]($appMetadata.version.Split(".")[1])).ToString("000")
$artifact="artifacts/app-release-$taskTag-$Profile$suffix.apk"
if($Profile -eq 'mainnet') { $artifact="artifacts/app-release-$($appMetadata.version)-mainnet.apk" }
Copy-Item -LiteralPath 'app/android/app/build/outputs/apk/release/app-release.apk' -Destination $artifact
$info=Get-Item -LiteralPath $artifact
$signatureReport = & "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs $artifact
if($LASTEXITCODE -ne 0){throw 'APK signature verification failed'}
$certificateLine = $signatureReport | Where-Object { $_ -match '^Signer #1 certificate SHA-256 digest: ' } | Select-Object -First 1
if(!$certificateLine){throw 'APK signing certificate not found'}
$certificateSha256 = $certificateLine -replace '^Signer #1 certificate SHA-256 digest: ',''
@{package=$appMetadata.android.package;version=$appMetadata.version;versionCode=$appMetadata.android.versionCode;buildType='release';profile=$Profile;demo=[bool]$Demo;sha256=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant();certificateSha256=$certificateSha256;bytes=$info.Length;builtAt=[DateTimeOffset]::UtcNow.ToString('O');rpc=$RpcUrl;api=$ApiUrl;artifact=$artifact} | ConvertTo-Json | Set-Content -LiteralPath "$artifact.json" -Encoding utf8
