$ErrorActionPreference = "Stop"

$localPython = Get-Command python -ErrorAction SilentlyContinue
$bundledPython = "C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

$scriptArgs = @($args)
if ($scriptArgs.Count -eq 0) {
    $scriptArgs = @("bot.py")
}

if ($localPython) {
    & $localPython.Source $scriptArgs
} elseif (Test-Path $bundledPython) {
    & $bundledPython $scriptArgs
} else {
    Write-Error "Python was not found. Install Python 3.9+ or run with a full path to python.exe."
}
