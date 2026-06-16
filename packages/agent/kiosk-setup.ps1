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
Log "INFO:"  "PowerShell version: $($PSVersionTable.PSVersion)"
Log "INFO:"  "Running as: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"

# ─── Determine agent exe path ─────────────────────────────────────────────────
# Installer passes the full path as $args[0].  Fall back to known install location.
$AgentExe = $args[0]
if (-not $AgentExe -or !(Test-Path $AgentExe)) {
    $AgentExe = "C:\Program Files\NetCafe Agent\NetCafe Agent.exe"
}

Log "INFO:" "Agent exe path resolved to: $AgentExe"

# ─── GUARD: abort shell replacement if binary is missing ──────────────────────
if (!(Test-Path $AgentExe)) {
    Log "ERROR:" "Agent binary NOT found at: $AgentExe"
    Log "ERROR:" "Shell replacement SKIPPED — install the NetCafe Agent first, then re-run this script."
    Log "DONE:"  "Setup aborted (agent missing). No registry changes made."
    exit 1
}

Log "OK:" "Agent binary confirmed at: $AgentExe"

# ─── GUARD: restore HKLM Shell to explorer.exe (safety net) ──────────────────
# If a previous run accidentally set HKLM Shell to the agent, fix it now.
Log "STEP:" "Ensuring HKLM Winlogon Shell is explorer.exe (system-wide safety)..."
try {
    $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    $currentShell = (Get-ItemProperty -Path $winlogon -Name "Shell" -ErrorAction SilentlyContinue).Shell
    if ($currentShell -ne "explorer.exe") {
        Set-ItemProperty -Path $winlogon -Name "Shell" -Value "explorer.exe" -Type String -Force
        Log "OK:" "HKLM Shell was '$currentShell' — reset to 'explorer.exe'"
    } else {
        Log "OK:" "HKLM Shell is already 'explorer.exe' — no change needed"
    }
} catch {
    Log "WARN:" "Could not verify/reset HKLM Shell: $_"
}

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
        Log "OK:"   "CafeKiosk user created successfully"
    } else {
        Log "OK:" "CafeKiosk user already exists — skipping creation"
    }
} catch {
    Log "ERROR:" "Failed to create CafeKiosk user: $_"
}

# ─── STEP 2: Configure Auto-Logon ─────────────────────────────────────────────
# AutoAdminLogon auto-logs in CafeKiosk. Shell stays explorer.exe in HKLM.
# The per-user Shell override in NTUSER.DAT (Step 6 below) handles the kiosk shell.
Log "STEP:" "Configuring auto-logon for CafeKiosk..."
try {
    $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon"    -Value "1"              -Type String -Force
    Set-ItemProperty -Path $winlogon -Name "DefaultUserName"   -Value "CafeKiosk"      -Type String -Force
    Set-ItemProperty -Path $winlogon -Name "DefaultPassword"   -Value "CafeKiosk123!"  -Type String -Force
    Set-ItemProperty -Path $winlogon -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String -Force
    Log "OK:" "Auto-logon registry keys written"
} catch {
    Log "ERROR:" "Auto-logon configuration failed: $_"
}

# ─── STEP 3: Enable Shell Launcher Windows Feature ────────────────────────────
Log "STEP:" "Enabling Client-EmbeddedShellLauncher Windows feature (DISM)..."
try {
    $dismOutput = dism /online /Enable-Feature /all /FeatureName:Client-EmbeddedShellLauncher /NoRestart 2>&1
    foreach ($dismLine in $dismOutput) {
        if ($dismLine -and $dismLine.Trim()) { Log "DISM:" $dismLine.Trim() }
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

# ─── STEP 5: Register Custom Shell via WMI (Shell Launcher) ───────────────────
Log "STEP:" "Registering custom shell via WMI Shell Launcher..."
try {
    $ShellLauncherClass = [wmiclass]"\\localhost\root\standardcimv2\embedded:WESL_UserSetting"
    if ($ShellLauncherClass -and $strSID) {
        $ShellLauncherClass.SetEnabled($true)
        $ShellLauncherClass.SetCustomShell($strSID, $AgentExe, $null, $null, 0)
        Log "OK:" "WMI custom shell registered for SID $strSID"
    } else {
        Log "WARN:" "WMI Shell Launcher class not available — will rely on NTUSER.DAT Shell key"
    }
} catch {
    Log "WARN:" "WMI custom shell config failed (non-fatal, NTUSER.DAT fallback will be used): $_"
}

# ─── STEP 6: Pre-create CafeKiosk user profile ────────────────────────────────
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
            Log "WARN:" "Default NTUSER.DAT not found — hive will be created fresh on first logon"
        }
    } else {
        Log "OK:" "Profile directory already exists"
    }
    $icaclsOutput = icacls $profilePath /grant "CafeKiosk:(OI)(CI)F" /T 2>&1
    Log "INFO:" "icacls: $icaclsOutput"
    Log "OK:"   "Profile directory permissions set"
} catch {
    Log "ERROR:" "Profile directory setup failed: $_"
}

# ─── STEP 7: Load NTUSER.DAT and write ONLY CafeKiosk user Shell ──────────────
# This is the ONLY place the Shell is changed — per-user, not system-wide.
# Other accounts (Admin, etc.) keep explorer.exe because HKLM is untouched.
Log "STEP:" "Loading CafeKiosk NTUSER.DAT hive to write per-user Shell override..."
$ntuserDat = "$profilePath\NTUSER.DAT"
if (Test-Path $ntuserDat) {
    try {
        # Force garbage collection so no .NET handles linger on the hive
        [System.GC]::Collect()
        Start-Sleep -Milliseconds 500

        $loadResult = reg load "HKU\CafeKioskTemp" $ntuserDat 2>&1
        Log "INFO:" "reg load: $loadResult"

        # Create the Winlogon key in the user hive if it does not exist
        New-Item -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" `
                 -Force -ErrorAction SilentlyContinue | Out-Null

        # *** Per-user Shell — only CafeKiosk gets the kiosk shell ***
        Set-ItemProperty `
            -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" `
            -Name  "Shell" `
            -Value $AgentExe `
            -Force
        Log "OK:" "Per-user Shell written for CafeKiosk: $AgentExe"

        # Lock-down GPO policies for this user only
        Log "STEP:" "Writing GPO kiosk restriction policies into user hive..."
        New-Item -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
                 -Force -ErrorAction SilentlyContinue | Out-Null
        Set-ItemProperty `
            -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
            -Name  "DisableTaskMgr"        -Value 1 -Type DWord -Force
        Set-ItemProperty `
            -Path "HKU:\CafeKioskTemp\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
            -Name  "HideFastUserSwitching" -Value 1 -Type DWord -Force

        New-Item -Path "HKU:\CafeKioskTemp\Software\Policies\Microsoft\Windows\System" `
                 -Force -ErrorAction SilentlyContinue | Out-Null
        Set-ItemProperty `
            -Path "HKU:\CafeKioskTemp\Software\Policies\Microsoft\Windows\System" `
            -Name  "DisableCMD" -Value 1 -Type DWord -Force

        Log "OK:" "GPO restriction policies written into CafeKiosk user hive"

        # Flush and unload — must unload or the hive stays locked
        [System.GC]::Collect()
        Start-Sleep -Milliseconds 500
        $unloadResult = reg unload "HKU\CafeKioskTemp" 2>&1
        Log "INFO:" "reg unload: $unloadResult"
        Log "OK:"   "CafeKiosk NTUSER.DAT hive unloaded successfully"

    } catch {
        Log "ERROR:" "NTUSER.DAT hive operations failed: $_"
        try { reg unload "HKU\CafeKioskTemp" 2>&1 | Out-Null } catch {}
    }
} else {
    Log "WARN:" "NTUSER.DAT not found at $ntuserDat — Shell override will be applied on first logon via Scheduled Task"
}

# ─── STEP 8: Register Elevated Scheduled Task ─────────────────────────────────
Log "STEP:" "Registering NetCafeAgent elevated Scheduled Task..."
try {
    $action    = New-ScheduledTaskAction -Execute $AgentExe
    $trigger   = New-ScheduledTaskTrigger -AtLogon -User "CafeKiosk"
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0)
    $principal = New-ScheduledTaskPrincipal -UserId "CafeKiosk" -RunLevel Highest
    Register-ScheduledTask -TaskName "NetCafeAgent" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Log "OK:" "Scheduled Task 'NetCafeAgent' registered (runs at CafeKiosk logon with Highest privileges)"
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
