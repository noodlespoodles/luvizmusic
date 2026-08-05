@echo off
REM ===========================================================================
REM  LUVIZMUSIC - PREVIEW-SITE.bat
REM  Double-click this file to view the site in your browser.
REM
REM  It starts a tiny web server on this computer only (nobody else can see
REM  it), then opens the site. Nothing is installed, nothing is uploaded.
REM
REM  Leave this black window open while you look at the site.
REM  Close it, or press Ctrl+C, to stop the server.
REM
REM  Why bother, when index.html can just be double-clicked? Because the
REM  mix players (SoundCloud, YouTube, Mixcloud) refuse to run from a bare
REM  file on disk. Everything else - words, type, texture, layout - works
REM  either way.
REM
REM  The half below the marker line is PowerShell, read back out of this
REM  same file. Do not delete the marker line.
REM ===========================================================================
setlocal
set "LUVIZ_ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath '%~f0' -Raw; iex (($s -split '#:PS-START')[-1])"
echo.
echo The preview server has stopped.
pause
exit /b
#:PS-START

$ErrorActionPreference = 'Stop'

$root = $env:LUVIZ_ROOT
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
$root = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\')

# Content types. Without these the browser refuses stylesheets and fonts.
$mime = @{
  '.html'  = 'text/html; charset=utf-8'
  '.htm'   = 'text/html; charset=utf-8'
  '.css'   = 'text/css; charset=utf-8'
  '.js'    = 'text/javascript; charset=utf-8'
  '.mjs'   = 'text/javascript; charset=utf-8'
  '.json'  = 'application/json; charset=utf-8'
  '.svg'   = 'image/svg+xml'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.jpeg'  = 'image/jpeg'
  '.gif'   = 'image/gif'
  '.webp'  = 'image/webp'
  '.avif'  = 'image/avif'
  '.ico'   = 'image/x-icon'
  '.woff2' = 'font/woff2'
  '.woff'  = 'font/woff'
  '.otf'   = 'font/otf'
  '.ttf'   = 'font/ttf'
  '.mp3'   = 'audio/mpeg'
  '.m4a'   = 'audio/mp4'
  '.ogg'   = 'audio/ogg'
  '.wav'   = 'audio/wav'
  '.mp4'   = 'video/mp4'
  '.txt'   = 'text/plain; charset=utf-8'
  '.md'    = 'text/plain; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'
}

# Take the first free port. 8951 normally; the next few if something else
# on the machine already has it.
$listener = $null
$port = 0
foreach ($candidate in 8951..8960) {
  $attempt = New-Object System.Net.HttpListener
  $attempt.Prefixes.Add("http://localhost:$candidate/")
  try {
    $attempt.Start()
    $listener = $attempt
    $port = $candidate
    break
  } catch {
    try { $attempt.Close() } catch { }
  }
}

if ($null -eq $listener) {
  Write-Host ''
  Write-Host 'Could not start the preview server.' -ForegroundColor Red
  Write-Host 'Ports 8951 to 8960 are all in use. Close any other preview'
  Write-Host 'window that is already open and try again.'
  return
}

$address = "http://localhost:$port/"

Write-Host ''
Write-Host '  LUVIZMUSIC preview' -ForegroundColor Green
Write-Host ''
Write-Host "  Serving : $root"
Write-Host "  Address : $address"
Write-Host ''
Write-Host '  Edit anything in content\ and refresh the browser to see it.'
Write-Host '  Close this window, or press Ctrl+C, to stop.'
Write-Host ''

try { Start-Process $address } catch {
  Write-Host "  Could not open the browser automatically. Paste $address into it." -ForegroundColor Yellow
}

while ($listener.IsListening) {

  try {
    $context = $listener.GetContext()
  } catch {
    break
  }

  $request = $context.Request
  $response = $context.Response
  $status = 200

  try {
    $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
    if ($relative -eq '') { $relative = 'index.html' }
    $target = [IO.Path]::GetFullPath((Join-Path $root ($relative -replace '/', '\')))

    # Never serve anything outside this folder.
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      $status = 403
    } else {
      if (Test-Path -LiteralPath $target -PathType Container) {
        $target = Join-Path $target 'index.html'
      }
      if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        $status = 404
      }
    }

    if ($status -eq 200) {
      $extension = [IO.Path]::GetExtension($target).ToLowerInvariant()
      $type = $mime[$extension]
      if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($target)
      $response.ContentType = $type
      # Always fetch fresh, so an edit to content\ shows on a plain refresh.
      $response.Headers.Add('Cache-Control', 'no-store, must-revalidate')
    } else {
      $message = if ($status -eq 404) { "Not found: /$relative" } else { "Refused: /$relative" }
      $bytes = [Text.Encoding]::UTF8.GetBytes($message)
      $response.ContentType = 'text/plain; charset=utf-8'
    }

    $response.StatusCode = $status
    $response.ContentLength64 = $bytes.Length
    if ($request.HttpMethod -ne 'HEAD') {
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    # A browser that walks away mid-response must not take the server down.
    try { $response.StatusCode = 500 } catch { }
  } finally {
    try { $response.OutputStream.Close() } catch { }
    try { $response.Close() } catch { }
  }

  $colour = 'DarkGray'
  if ($status -ne 200) { $colour = 'Yellow' }
  Write-Host "  $status  $($request.Url.AbsolutePath)" -ForegroundColor $colour
}

try { $listener.Stop() } catch { }
try { $listener.Close() } catch { }
