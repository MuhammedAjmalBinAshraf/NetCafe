#Requires -RunAsAdministrator
param(
    [string]$LogDir = "C:\NetCafe\logs",
    [string]$LogFile = "diagnostic-trace.txt",
    [int]$IntervalSeconds = 2,
    [int]$MaxLogSizeMB = 50
)

$LogPath = Join-Path -Path $LogDir -ChildPath $LogFile

if (!(Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    $line = "[$ts] $Message"
    
    # Rollover logic
    if (Test-Path $LogPath) {
        $fileSize = (Get-Item $LogPath).Length / 1MB
        if ($fileSize -gt $MaxLogSizeMB) {
            $backupPath = $LogPath + ".bak"
            Move-Item -Path $LogPath -Destination $backupPath -Force
        }
    }
    
    Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

Write-Log "--- DIAGNOSTIC LOGGER STARTED ---"
Write-Log "System Boot Time: $((Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime)"

# Ensure we have the WMI classes for foreground window
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

while ($true) {
    try {
        # 1. Shell Registry State
        $winlogonShell = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'Shell' -ErrorAction SilentlyContinue).Shell
        if (-not $winlogonShell) { $winlogonShell = "<MISSING OR DEFAULT>" }
        
        $hklmShell = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'Shell' -ErrorAction SilentlyContinue).Shell
        if (-not $hklmShell) { $hklmShell = "<MISSING OR DEFAULT>" }

        # 2. Key Processes
        $agentProcs = Get-Process -Name "NetCafe Agent" -ErrorAction SilentlyContinue
        $explorerProcs = Get-Process -Name "explorer" -ErrorAction SilentlyContinue
        
        $agentCount = if ($agentProcs) { @($agentProcs).Count } else { 0 }
        $explorerCount = if ($explorerProcs) { @($explorerProcs).Count } else { 0 }

        # 3. Foreground Window
        $hwnd = [WindowHelper]::GetForegroundWindow()
        $fgPid = 0
        [WindowHelper]::GetWindowThreadProcessId($hwnd, [ref]$fgPid) | Out-Null
        $fgProcName = "<Unknown>"
        if ($fgPid -gt 0) {
            $fgProc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
            if ($fgProc) { $fgProcName = $fgProc.ProcessName }
        }

        # 4. Kiosk User Active Check
        $queryUser = (query user 2>&1) -join " | "
        $isKioskActive = $queryUser -match "cafekiosk"

        # 5. Network Connections (Summary)
        $netstat = netstat -ano | Select-String "ESTABLISHED"
        $connCount = if ($netstat) { @($netstat).Count } else { 0 }

        # Compile snapshot
        $snapshot = "Shell[HKCU: $winlogonShell | HKLM: $hklmShell] " +
                    "Procs[Agent: $agentCount | Explorer: $explorerCount] " +
                    "Foreground[$fgProcName] " +
                    "KioskActive[$isKioskActive] " +
                    "Connections[$connCount]"

        Write-Log $snapshot

    } catch {
        Write-Log "ERROR IN LOGGER LOOP: $_"
    }

    Start-Sleep -Seconds $IntervalSeconds
}
