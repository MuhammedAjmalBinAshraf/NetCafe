#Requires -RunAsAdministrator
# NetCafe Kiosk Setup Script
# Outputs detailed progress to stdout so NSIS nsExec::ExecToLog shows it in the installer detail window.
# Also writes to C:\NetCafe\logs\agent-install.log for post-install review.

$LogDir  = "C:\NetCafe\logs"
$LogFile = "$LogDir\agent-install.log"

function Log {
    param([string]$Level, [string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Level $Message"
    # Write to stdout -> captured by NSIS ExecToLog -> shown in installer detail window
    Write-Output $line
    # Also persist to disk
    try {
        if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {}
}

Log "START:" "NetCafe Kiosk Setup launched"
Log "INFO:" "PowerShell version: $($PSVersionTable.PSVersion)"
Log "INFO:" "Running as: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"

# Determine agent exe path (passed as first argument, or auto-detect)
$AgentExe = $args[0]
if (-not $AgentExe) {
    $AgentExe = Join-Path $PSScriptRoot "..\NetCafe Agent.exe"
}
if (!(Test-Path $AgentExe)) {
    # Try resolving relative to script location (extraResources path)
    $AgentExe = Join-Path (Split-Path $PSScriptRoot -Parent) "NetCafe Agent.exe"
}
Log "INFO:" "Agent exe path: $AgentExe"

# ─── STEP 1: Create CafeKiosk user ────────────────────────────────────────────
Log "STEP:" "Checking if CafeKiosk user exists..."
try {
    $userExists = [bool](Get-LocalUser -Name "CafeKiosk" -ErrorAction SilentlyContinue)
    if (-not $userExists) {
        Log "STEP:" "Creating CafeKiosk user account..."
        $result = net user CafeKiosk "CafeKiosk123!" /add /expires:never /active:yes 2>&1
        Log "INFO:" "net user output: $result"
        $wmicResult = wmic useraccount where "name='CafeKiosk'" set PasswordExpires=FALSE 2>&1
        Log "INFO:" "wmic output: $wmicResult"
        Log "OK:" "CafeKiosk user created successfully"
    } else {
        Log "OK:" "CafeKiosk user already exists — skipping creation"
    }
} catch {
    Log "ERROR:" "Failed to create CafeKiosk user: $_"
}

# ─── STEP 2: Configure Auto-Logon ─────────────────────────────────────────────
Log "STEP:" "Configuring auto-logon for CafeKiosk..."
try {
    $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon"   -Value "1"             -Type String -Force
    Set-ItemProperty -Path $winlogon -Name "DefaultUserName"  -Value "CafeKiosk"     -Type String -Force
    Set-ItemProperty -Path $winlogon -Name "DefaultPassword"  -Value "CafeKiosk123!" -Type String -Force
    Set-ItemProperty -Path $winlogon -Name "DefaultDomainName"-Value $env:COMPUTERNAME -Type String -Force
    Log "OK:" "Auto-logon registry keys written"
} catch {
    Log "ERROR:" "Auto-logon configuration failed: $_"
}

# ─── STEP 3: Enable Shell Launcher Windows Feature ────────────────────────────
Log "STEP:" "Enabling Client-EmbeddedShellLauncher Windows feature (DISM)..."
try {
    $dismOutput = dism /online /Enable-Feature /all /FeatureName:Client-EmbeddedShellLauncher /NoRestart 2>&1
    foreach ($dismLine in $dismOutput) {
        if ($dismLine -and $dismLine.Trim()) {
            Log "DISM:" $dismLine.Trim()
        }
    }
    Log "OK:" "Shell Launcher feature enabled (or already enabled)"
} catch {
    Log "ERROR:" "DISM Shell Launcher feature enable failed: $_"
}

# ─── STEP 4: Get CafeKiosk SID ────────────────────────────────────────────────
Log "STEP:" "Resolving CafeKiosk account SID..."
$strSID = $null
try {
    $objUser = New-Object System.Security.Principal.NTAccount("CafeKiosk")
    $strSID  = $objUser.Translate([System.Security.Principal.SecurityIdentifier]).Value
    Log "OK:" "CafeKiosk SID: $strSID"
} catch {
    Log "ERROR:" "Could not resolve CafeKiosk SID: $_"
}

# ─── STEP 5: Register Custom Shell via WMI ────────────────────────────────────
Log "STEP:" "Registering custom shell via WMI Shell Launcher..."
try {
    $ShellLauncherClass = [wmiclass]"\\localhost\root\standardcimv2\embedded:WESL_UserSetting"
    if ($ShellLauncherClass -and $strSID) {
        $ShellLauncherClass.SetEnabled($true)
        $ShellLauncherClass.SetCustomShell($strSID, $AgentExe, $null, $null, 0)
        Log "OK:" "WMI custom shell registered for SID $strSID"
    } else {
        Log "WARN:" "WMI Shell Launcher class not available — skipping"
    }
} catch {
    Log "WARN:" "WMI custom shell config failed (non-fatal): $_"
}

# ─── STEP 6: Pre-create user profile directory ────────────────────────────────
$profilePath = "C:\Users\CafeKiosk"
Log "STEP:" "Ensuring CafeKiosk profile directory exists at $profilePath..."
try {
    if (!(Test-Path $profilePath)) {
        New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
        $defaultNtuser = "C:\Users\Default\NTUSER.DAT"
        if (Test-Path $defaultNtuser) {
            Copy-Item -Path $defaultNtuser -Destination "$profilePath\NTUSER.DAT" -Force
            Log "OK:" "Profile directory created and NTUSER.DAT copied from Default"
        } else {
            Log "WARN:" "Default NTUSER.DAT not found — profile hive will be created fresh on first logon"
        }
    } else {
        Log "OK:" "Profile directory already exists"
    }
    $icaclsOutput = icacls $profilePath /grant "CafeKiosk:(OI)(CI)F" /T 2>&1
    Log "INFO:" "icacls: $icaclsOutput"
    Log "OK:" "Profile directory permissions set"
} catch {
    Log "ERROR:" "Profile directory setup failed: $_"
}

# ─── STEP 7: Load NTUSER.DAT hive and write user-specific policies ────────────
Log "STEP:" "Loading CafeKiosk NTUSER.DAT hive to write user-level registry policies..."
try {
    $loadResult = reg load "HKU\CafeKioskTemp" "$profilePath\NTUSER.DAT" 2>&1
    Log "INFO:" "reg load: $loadResult"

    Log "STEP:" "Writing user Shell registry key..."
    New-Item -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -Force -ErrorAction SilentlyContinue | Out-Null
    Set-ItemProperty -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "Shell" -Value $AgentExe -Force
    Log "OK:" "User Shell key written: $AgentExe"

    Log "STEP:" "Writing GPO kiosk restriction policies..."
    New-Item -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Force -ErrorAction SilentlyContinue | Out-Null
    Set-ItemProperty -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableTaskMgr"        -Value 1 -Type DWord -Force
    Set-ItemProperty -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "HideFastUserSwitching" -Value 1 -Type DWord -Force
    New-Item -Path "HKU:\CafeKioskTemp\Software\Policies\Microsoft\Windows\System" -Force -ErrorAction SilentlyContinue | Out-Null
    Set-ItemProperty -Path "HKU:\CafeKioskTemp\Software\Policies\Microsoft\Windows\System" -Name "DisableCMD" -Value 1 -Type DWord -Force
    Log "OK:" "GPO restriction policies written"

    $unloadResult = reg unload "HKU\CafeKioskTemp" 2>&1
    Log "INFO:" "reg unload: $unloadResult"
    Log "OK:" "NTUSER.DAT hive unloaded successfully"
} catch {
    Log "ERROR:" "NTUSER.DAT hive operations failed: $_"
    try { reg unload "HKU\CafeKioskTemp" 2>&1 | Out-Null } catch {}
}

# ─── STEP 8: Register Elevated Scheduled Task ─────────────────────────────────
Log "STEP:" "Registering NetCafeAgent elevated Scheduled Task..."
try {
    $action    = New-ScheduledTaskAction -Execute $AgentExe
    $trigger   = New-ScheduledTaskTrigger -AtLogon
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0)
    $principal = New-ScheduledTaskPrincipal -UserId "CafeKiosk" -RunLevel Highest
    Register-ScheduledTask -TaskName "NetCafeAgent" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Log "OK:" "Scheduled Task 'NetCafeAgent' registered at logon with Highest privileges"
} catch {
    Log "ERROR:" "Scheduled Task registration failed: $_"
}

# ─── STEP 9: Write installed flag ─────────────────────────────────────────────
Log "STEP:" "Writing C:\NetCafe\installed.flag..."
try {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Set-Content -Path "C:\NetCafe\installed.flag" -Value "installed=$ts" -Encoding UTF8
    Log "OK:" "installed.flag written"
} catch {
    Log "ERROR:" "Failed to write installed.flag: $_"
}

Log "DONE:" "NetCafe Kiosk Setup completed. Review log at $LogFile"
exit 0
