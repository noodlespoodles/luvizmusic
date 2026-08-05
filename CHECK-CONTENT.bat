@echo off
REM ===========================================================================
REM  LUVIZMUSIC - CHECK-CONTENT.bat
REM  Double-click this file after editing anything in the content folder.
REM
REM  It reads content\site.js, content\crew.js, content\mixes.js and
REM  content\events.js and tells you either PASS, or exactly which file and
REM  which line has the problem, in plain English.
REM
REM  Nothing is installed, nothing is uploaded, nothing is changed.
REM
REM  The half below the marker line is PowerShell, read back out of this
REM  same file. Do not delete the marker line.
REM ===========================================================================
setlocal
set "LUVIZ_ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath '%~f0' -Raw; iex (($s -split '#:PS-START')[-1])"
echo.
pause
exit /b
#:PS-START

$ErrorActionPreference = 'Stop'

$root = $env:LUVIZ_ROOT
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
$root = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\')

$keys = @('site', 'crew', 'mixes', 'events')

Write-Host ''
Write-Host '  LUVIZMUSIC content check' -ForegroundColor Green
Write-Host "  Folder: $root"
Write-Host ''

foreach ($key in $keys) {
  $file = Join-Path $root "content\$key.js"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Host '  PROBLEM' -ForegroundColor Red
    Write-Host ''
    Write-Host "  The file content\$key.js is missing."
    Write-Host '  It may have been renamed, moved, or deleted. The site needs all'
    Write-Host '  four content files: site.js, crew.js, mixes.js and events.js.'
    return
  }
}

# ---------------------------------------------------------------------------
# Preferred path: Node is installed, so the real JavaScript engine reads the
# files and reports the exact line, exactly as a browser would.
# ---------------------------------------------------------------------------

$node = $null
try { $node = Get-Command node -ErrorAction SilentlyContinue } catch { $node = $null }

if ($node) {

  $checker = @'
'use strict';
const path = require('path');
const root = process.argv[2];
globalThis.window = globalThis;

function label(key) { return 'content/' + key + '.js'; }

try {
  require(path.join(root, 'js', 'namespace.js'));
} catch (err) {
  console.log('PROBLEM');
  console.log('');
  console.log('js/namespace.js could not be read, so nothing else could be checked.');
  console.log(String(err && err.message ? err.message : err));
  process.exit(2);
}

const LUVIZ = globalThis.LUVIZ;
const problems = [];
const broken = {};

for (const key of LUVIZ.CONTENT_KEYS) {
  try {
    require(path.join(root, 'content', key + '.js'));
  } catch (err) {
    broken[key] = true;
    problems.push(LUVIZ.explain(label(key), err));
  }
}

for (const key of LUVIZ._missing()) {
  if (!broken[key]) {
    problems.push(
      label(key) + ' finished without handing its content to the page. ' +
      'Check that its last line is window.LUVIZ._loaded(\'' + key + '\'); and that ' +
      'the line above it sets window.LUVIZ.' + key + '.'
    );
  }
}

for (const message of LUVIZ.validate.all(LUVIZ).errors) {
  problems.push(message);
}

if (problems.length === 0) {
  const counts = [
    LUVIZ.crew.length + ' crew',
    LUVIZ.mixes.length + ' mixes',
    LUVIZ.events.length + ' events'
  ].join(', ');
  console.log('PASS');
  console.log('');
  console.log('All four content files are readable and complete.');
  console.log('Loaded: ' + counts + '.');
  process.exit(0);
}

console.log('PROBLEM');
console.log('');
console.log(problems[0]);
if (problems.length > 1) {
  console.log('');
  console.log('(' + (problems.length - 1) + ' more problem(s) after this one. Fix this one first, then run this check again.)');
}
process.exit(1);
'@

  $temp = Join-Path $env:TEMP 'luviz-check-content.js'
  [IO.File]::WriteAllText($temp, $checker, (New-Object Text.UTF8Encoding($false)))
  try {
    $output = & node $temp $root
    $code = $LASTEXITCODE
  } finally {
    try { Remove-Item -LiteralPath $temp -Force } catch { }
  }

  $first = $true
  foreach ($line in $output) {
    if ($first) {
      $colour = 'Green'
      if ($code -ne 0) { $colour = 'Red' }
      Write-Host "  $line" -ForegroundColor $colour
      $first = $false
    } else {
      Write-Host "  $line"
    }
  }
  return
}

# ---------------------------------------------------------------------------
# Fallback: no Node on this machine. PowerShell reads the files itself and
# checks the punctuation - quotes, brackets and braces - which is what nearly
# every content mistake comes down to.
# ---------------------------------------------------------------------------

Write-Host '  (Node is not installed on this computer, so this is the simpler check.)' -ForegroundColor DarkGray
Write-Host ''

function Test-ContentPunctuation {
  param([string]$Path, [string]$Key)

  $text = [IO.File]::ReadAllText($Path)
  $name = "content\$Key.js"
  $line = 1
  $stack = New-Object System.Collections.Stack
  $quote = $null
  $quoteLine = 0
  $inLineComment = $false
  $inBlockComment = $false
  $pairs = @{ '}' = '{'; ']' = '['; ')' = '(' }

  for ($i = 0; $i -lt $text.Length; $i++) {
    $c = $text[$i]
    $next = ''
    if ($i + 1 -lt $text.Length) { $next = $text[$i + 1] }

    if ($c -eq "`n") {
      $line++
      $inLineComment = $false
      if ($quote) {
        return "$name, line $quoteLine`: a quote was opened here and never closed on the same line. Every piece of text needs a quote at the start and a quote at the end."
      }
      continue
    }

    if ($inLineComment) { continue }

    if ($inBlockComment) {
      if ($c -eq '*' -and $next -eq '/') { $inBlockComment = $false; $i++ }
      continue
    }

    if ($quote) {
      if ($c -eq '\') { $i++; continue }
      if ($c -eq $quote) { $quote = $null }
      continue
    }

    if ($c -eq '/' -and $next -eq '/') { $inLineComment = $true; $i++; continue }
    if ($c -eq '/' -and $next -eq '*') { $inBlockComment = $true; $i++; continue }

    if ($c -eq "'" -or $c -eq '"') { $quote = $c; $quoteLine = $line; continue }

    if ($c -eq '{' -or $c -eq '[' -or $c -eq '(') {
      $stack.Push(@{ Char = [string]$c; Line = $line })
      continue
    }

    if ($pairs.ContainsKey([string]$c)) {
      if ($stack.Count -eq 0) {
        return "$name, line $line`: found a $c that does not close anything. There is probably one too many, or something above it was deleted by accident."
      }
      $open = $stack.Pop()
      if ($open.Char -ne $pairs[[string]$c]) {
        return "$name, line $line`: found a $c where a match for the $($open.Char) on line $($open.Line) was expected. Brackets have been crossed over."
      }
    }
  }

  if ($quote) {
    return "$name, line $quoteLine`: a quote was opened here and never closed. Every piece of text needs a quote at the start and a quote at the end."
  }
  if ($stack.Count -gt 0) {
    $open = $stack.Pop()
    return "$name, line $($open.Line)`: this $($open.Char) was never closed. Every { needs a }, every [ needs a ], every ( needs a )."
  }
  if ($text -notmatch [regex]::Escape("window.LUVIZ.$Key")) {
    return "$name`: the line that starts window.LUVIZ.$Key is missing. It may have been deleted by accident."
  }
  if ($text -notmatch [regex]::Escape("_loaded('$Key')")) {
    return "$name`: the last line, window.LUVIZ._loaded('$Key'); is missing. Put it back at the very bottom of the file."
  }
  return $null
}

foreach ($key in $keys) {
  $problem = Test-ContentPunctuation -Path (Join-Path $root "content\$key.js") -Key $key
  if ($problem) {
    Write-Host '  PROBLEM' -ForegroundColor Red
    Write-Host ''
    Write-Host "  $problem"
    Write-Host ''
    Write-Host '  Fix that line, save the file, and run this check again.'
    return
  }
}

Write-Host '  PASS' -ForegroundColor Green
Write-Host ''
Write-Host '  All four content files are punctuated correctly.'
Write-Host '  (Install Node.js if you would like the fuller check as well.)'
