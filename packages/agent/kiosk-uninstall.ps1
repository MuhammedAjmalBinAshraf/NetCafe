#Requires -RunAsAdministrator
# NetCafe Kiosk Uninstall Script
# Outputs detailed progress to stdout so NSIS nsExec::ExecToLog shows it in the installer detail window.
# Also writes to C:\NetCafe\logs\agent-install.log

$LogDir  = "C:\NetCafe\logs"
$LogFile = "$LogDir\agent-uninstall.log"

function Log {
    param([string]$Level, [string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Level $Message"
    Write-Output $line
    try {
        if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {}
}

Log "START:" "NetCafe Kiosk Uninstall launched"
Log "INFO:" "Running as: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"

# ─── STEP 1: Disable Auto-Logon ───────────────────────────────────────────────
Log "STEP:" "Disabling auto-logon..."
try {
    $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -Value "0" -Type String -Force
    Remove-ItemProperty -Path $winlogon -Name "DefaultUserName" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $winlogon -Name "DefaultPassword" -ErrorAction SilentlyContinue
    Log "OK:" "Auto-logon disabled"
} catch {
    Log "ERROR:" "Failed to disable auto-logon: $_"
}

# ─── STEP 2: Disable WMI Shell Launcher ───────────────────────────────────────
Log "STEP:" "Disabling WMI custom shell launcher..."
try {
    $ShellLauncherClass = [wmiclass]"\\localhost\root\standardcimv2\embedded:WESL_UserSetting"
    if ($ShellLauncherClass) {
        $ShellLauncherClass.SetEnabled($false)
        Log "OK:" "WMI Shell Launcher disabled"
    }
} catch {
    Log "WARN:" "WMI Shell Launcher disable skipped (non-fatal): $_"
}

# ─── STEP 3: Remove Scheduled Task ────────────────────────────────────────────
Log "STEP:" "Removing NetCafeAgent Scheduled Task..."
try {
    Unregister-ScheduledTask -TaskName "NetCafeAgent" -Confirm:$false -ErrorAction SilentlyContinue
    Log "OK:" "Scheduled Task removed"
} catch {
    Log "WARN:" "Scheduled Task removal skipped: $_"
}

# ─── STEP 4: Delete CafeKiosk user ────────────────────────────────────────────
Log "STEP:" "Deleting CafeKiosk user account..."
try {
    $deleteResult = net user CafeKiosk /delete 2>&1
    Log "INFO:" "net user delete: $deleteResult"
    Log "OK:" "CafeKiosk user deleted"
} catch {
    Log "WARN:" "CafeKiosk user deletion failed (may not exist): $_"
}

# ─── STEP 5: Clean up profile list registry entries ───────────────────────────
Log "STEP:" "Cleaning up CafeKiosk profile registry entries..."
try {
    $profileListPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList"
    Get-ChildItem -Path $profileListPath | ForEach-Object {
        $val = Get-ItemProperty -Path $_.PSPath
        if ($val.ProfileImagePath -like "*CafeKiosk") {
            Remove-Item -Path $_.PSPath -Force -Recurse -ErrorAction SilentlyContinue
            Log "OK:" "Removed profile list entry: $($_.PSPath)"
        }
    }
    Log "OK:" "Profile registry cleanup complete"
} catch {
    Log "WARN:" "Profile registry cleanup error: $_"
}

# ─── STEP 6: Remove profile directory ─────────────────────────────────────────
Log "STEP:" "Removing C:\Users\CafeKiosk directory..."
try {
    Remove-Item -Path "C:\Users\CafeKiosk" -Force -Recurse -ErrorAction SilentlyContinue
    Log "OK:" "CafeKiosk profile directory removed"
} catch {
    Log "WARN:" "Profile directory removal failed: $_"
}

# ─── STEP 7: Remove installed flag ────────────────────────────────────────────
Log "STEP:" "Removing C:\NetCafe\installed.flag..."
try {
    Remove-Item -Path "C:\NetCafe\installed.flag" -Force -ErrorAction SilentlyContinue
    Log "OK:" "installed.flag removed"
} catch {
    Log "WARN:" "installed.flag removal skipped: $_"
}

Log "DONE:" "NetCafe Kiosk Uninstall completed. Review log at $LogFile"
exit 0
