param([string]$ApiUrl='https://yetanothermarket.cat',[string]$RpcUrl='https://api.devnet.solana.com',[switch]$Demo)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!$env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 17' }
New-Item -ItemType Directory -Force .dev | Out-Null
$signingPath=Join-Path (Get-Location) '.dev/android-release-006.json'
$keystorePath=Join-Path (Get-Location) '.dev/android-release-006.p12'
if(!(Test-Path -LiteralPath $signingPath)) {
    if(Test-Path -LiteralPath $keystorePath){throw 'Keystore exists without password file; restore signing backup first'}
    $secret=[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    @{password=$secret;alias='yac-release';keystore=$keystorePath} | ConvertTo-Json | Set-Content -LiteralPath $signingPath -Encoding utf8
}
$signing=Get-Content -LiteralPath $signingPath -Raw | ConvertFrom-Json
$env:YAC_ANDROID_KEYSTORE=$keystorePath
$env:YAC_ANDROID_STORE_PASSWORD=$signing.password
$env:YAC_ANDROID_KEY_PASSWORD=$signing.password
$env:YAC_ANDROID_KEY_ALIAS=$signing.alias
if(!(Test-Path -LiteralPath $keystorePath)) {
    & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -keystore $keystorePath -storetype PKCS12 -storepass:env YAC_ANDROID_STORE_PASSWORD -keypass:env YAC_ANDROID_KEY_PASSWORD -alias $signing.alias -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Yet Another Cat Hackathon, O=Yet Another Cat'
    if($LASTEXITCODE -ne 0){throw 'Signing key generation failed'}
}
$buildProfile=if($Demo){'devnet'}else{'staging'}
& ./scripts/build-release.ps1 -Profile $buildProfile -ApiUrl $ApiUrl -RpcUrl $RpcUrl -Cluster devnet -Demo:$Demo
if($LASTEXITCODE -ne 0){throw 'APK build failed'}
