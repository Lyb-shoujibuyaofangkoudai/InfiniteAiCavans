$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $dir "infinite-canvas-launcher.exe")
