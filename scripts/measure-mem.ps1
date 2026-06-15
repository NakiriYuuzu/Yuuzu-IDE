# measure-mem.ps1 -- Yuuzu-IDE current memory / cold-launch probe (Windows / WebView2)
# Usage (cold launch): powershell -ExecutionPolicy Bypass -File scripts\measure-mem.ps1
# Usage (attach):      powershell -ExecutionPolicy Bypass -File scripts\measure-mem.ps1 -AttachPid <pid> -SettleSeconds 0
# Launches (or attaches to) the app, walks the whole process tree, and buckets
# memory into Shell (UI) / Language server / Other. Attach mode is how you get the
# real "one/three workspace idle" numbers: open workspaces in the GUI, let the LSP
# servers spin up, then re-run with -AttachPid pointing at the running app.
param(
    [string]$Exe = "D:\AI\Yuuzu-IDE\src-tauri\target\release\yuuzu-ide.exe",
    [int]$SettleSeconds = 8,
    [int]$LaunchTimeoutSeconds = 30,
    [int]$AttachPid = 0
)

if ($AttachPid -le 0 -and -not (Test-Path $Exe)) { Write-Error "exe not found: $Exe"; exit 1 }

# Collect all descendant processes from root pid (WebView2 / LSP / pty are all children of the app)
function Get-Tree([int]$rootPid) {
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
    $ids = New-Object System.Collections.Generic.HashSet[int]
    [void]$ids.Add($rootPid)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($p in $all) {
            if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
                [void]$ids.Add([int]$p.ProcessId); $changed = $true
            }
        }
    }
    return [int[]]@($ids)
}

function Bucket([string]$name) {
    if ($name -in @('yuuzu-ide','msedgewebview2')) { return 'Shell (UI)' }
    if ($name -match 'rust-analyzer|typescript-language-server|gopls|pyright' -or $name -eq 'node') { return 'Language-server' }
    return 'Other-pty-child'
}

if ($AttachPid -gt 0) {
    $proc = Get-Process -Id $AttachPid -ErrorAction Stop
    $launchMs = -1
} else {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $Exe -PassThru
    while (-not $proc.HasExited -and $proc.MainWindowHandle -eq 0 -and $sw.Elapsed.TotalSeconds -lt $LaunchTimeoutSeconds) {
        Start-Sleep -Milliseconds 40
        $proc.Refresh()
    }
    $launchMs = $sw.ElapsedMilliseconds
    if ($proc.HasExited) { Write-Error "app exited right after launch (exit $($proc.ExitCode))"; exit 1 }
}

Start-Sleep -Seconds $SettleSeconds

$ids   = Get-Tree $proc.Id
$procs = Get-Process -Id $ids -ErrorAction SilentlyContinue
$rows  = $procs | Select-Object Id, ProcessName, WorkingSet64, @{n='Bucket';e={ Bucket $_.ProcessName }}
$total = ($procs | Measure-Object WorkingSet64 -Sum).Sum

Write-Output ""
Write-Output "=== Yuuzu-IDE current measurement (Windows / WebView2) ==="
if ($launchMs -ge 0) {
    Write-Output ("Cold launch -> window shown : {0:N0} ms  (note: WebView2 already warm, true cold is higher)" -f $launchMs)
    Write-Output ("Sample point                : {0}s after launch, NO workspace opened yet" -f $SettleSeconds)
} else {
    Write-Output ("Cold launch -> window shown : n/a  (attached to PID {0}, did not launch)" -f $AttachPid)
    Write-Output ("Sample point                : {0}s after attach, whatever workspaces are open right now" -f $SettleSeconds)
}
Write-Output ("Process tree count          : {0}" -f $procs.Count)
Write-Output ("Tree total working set      : {0:N0} MB" -f ($total/1MB))
Write-Output ""
Write-Output "--- By bucket (only the Shell bucket changes if you switch Tauri -> GPUI) ---"
$rows | Group-Object Bucket | Sort-Object Name | ForEach-Object {
    Write-Output ("{0,-18} {1,8:N0} MB   ({2} procs)" -f $_.Name, (($_.Group | Measure-Object WorkingSet64 -Sum).Sum/1MB), $_.Count)
}
Write-Output ""
Write-Output "--- Per-process (working set) ---"
$rows | Sort-Object WorkingSet64 -Descending |
    Format-Table Id, ProcessName, @{n='WS_MB';e={'{0:N0}' -f ($_.WorkingSet64/1MB)}}, Bucket -AutoSize | Out-String | Write-Output

Write-Output ("roadmap targets: one workspace idle < 180 MB / three < 300 MB / cold launch < 2000 ms")
Write-Output ("PID={0} still running -> open a code workspace, let LSP spin up, then re-run for the real 'one workspace idle'." -f $proc.Id)
Write-Output ("Stop app: Stop-Process -Id {0}" -f $proc.Id)
