# Build a Chrome Web Store distribution zip (Windows / PowerShell).
# Includes only the files the extension needs to run; output goes to dist/.
#   Usage:  pwsh ./scripts/package.ps1   (or run from Windows PowerShell)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot   # scripts/ -> repo root
$name = 'tab-groups-for-github'
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$dist  = Join-Path $root 'dist'
$stage = Join-Path $dist 'pkg'
$zip   = Join-Path $dist "$name-$version.zip"

# Fresh staging dir (dist/pkg).
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'icons') | Out-Null

# Allowlist: copy only the runtime files, preserving structure.
Copy-Item (Join-Path $root 'manifest.json') $stage
Copy-Item (Join-Path $root 'popup.html'),(Join-Path $root 'popup.js'),(Join-Path $root 'popup.css') $stage
Copy-Item (Join-Path $root 'LICENSE') $stage
Copy-Item -Recurse (Join-Path $root '_locales') $stage
Copy-Item -Recurse (Join-Path $root 'src') $stage
foreach ($i in '16','32','48','128') {
  Copy-Item (Join-Path $root "icons/icon$i.png") (Join-Path $stage 'icons')
}

# Zip the staging contents. Build entries by hand with forward-slash names —
# .NET's CreateFromDirectory writes backslash paths on Windows, which the
# Chrome Web Store mis-handles (manifest icon/script paths would break).
if (Test-Path $zip) { Remove-Item -Force $zip }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Recurse -File $stage | ForEach-Object {
    $rel = $_.FullName.Substring($stage.Length + 1) -replace '\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel) | Out-Null
  }
} finally {
  $archive.Dispose()
}
Remove-Item -Recurse -Force $stage

$kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "Created $zip ($kb KB)"
