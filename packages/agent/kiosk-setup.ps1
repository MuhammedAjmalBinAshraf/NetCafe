#Requires -RunAsAdministrator
param(
    [Parameter(Position=0)]
    [string]$AgentExe,
    [Parameter(Position=1)]
    [string]$KioskUser = "CafeKiosk",
    [Parameter(Position=2)]
    [string]$KioskPassword = "CafeKiosk123!"
)
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
        if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force -ErrorAction SilentlyContinue | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

Log "START:" "NetCafe Kiosk Setup launched"
Log "INFO:"  "PowerShell version: $($PSVersionTable.PSVersion)"
Log "INFO:"  "Running as: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"

# ─── Load kiosk.ini configuration override if present ──────────────────────────
$ConfigIni = "C:\NetCafe\kiosk.ini"
if (Test-Path $ConfigIni) {
    Log "INFO:" "Found kiosk configuration file at $ConfigIni"
    try {
        $iniData = Get-Content -Path $ConfigIni -ErrorAction SilentlyContinue | Where-Object { $_ -like "*=*" }
        foreach ($line in $iniData) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $value = $parts[1].Trim()
            if ($key -eq "KioskUser" -and $value -ne "") {
                $KioskUser = $value
                Log "INFO:" "Overrode KioskUser from kiosk.ini: $KioskUser"
            }
            if ($key -eq "KioskPassword") {
                $KioskPassword = $value
                Log "INFO:" "Overrode KioskPassword from kiosk.ini: $KioskPassword"
            }
        }
    } catch {
        Log "WARN:" "Failed to parse $($ConfigIni) - $_"
    }
}

# ─── Determine agent exe path ─────────────────────────────────────────────────
# Installer passes the full path as position 0 parameter. Fall back to known install location.
if (-not $AgentExe -or !(Test-Path $AgentExe)) {
    $AgentExe = "C:\Program Files\NetCafe Agent\NetCafe Agent.exe"
}

Log "INFO:" "Agent exe path resolved to: $AgentExe"

# ─── GUARD: abort shell replacement if binary is missing ──────────────────────
if (!(Test-Path $AgentExe)) {
    Log "ERROR:" "Agent binary NOT found at: $AgentExe"
    Log "ERROR:" "Shell replacement SKIPPED - install the NetCafe Agent first, then re-run this script."
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
        Log "OK:" "HKLM Shell was '$currentShell' - reset to 'explorer.exe'"
    } else {
        Log "OK:" "HKLM Shell is already 'explorer.exe' - no change needed"
    }
} catch {
    Log "WARN:" "Could not verify/reset HKLM Shell: $_"
}

# ─── STEP 1: Create Kiosk User Account if Needed ──────────────────────────────
Log "STEP:" "Checking if $KioskUser user exists..."
try {
    $userExists = [bool](Get-LocalUser -Name $KioskUser -ErrorAction SilentlyContinue)
    if (-not $userExists) {
        if ($KioskUser -eq "CafeKiosk") {
            Log "STEP:" "Creating CafeKiosk user account..."
            $result = net user CafeKiosk "CafeKiosk123!" /add /expires:never /active:yes 2>&1
            Log "INFO:" "net user output: $result"
            $wmicResult = wmic useraccount where "name='CafeKiosk'" set PasswordExpires=FALSE 2>&1
            Log "INFO:" "wmic output: $wmicResult"
            Log "OK:"   "CafeKiosk user created successfully"
        } else {
            Log "ERROR:" "Kiosk user '$KioskUser' does not exist, and cannot be created automatically (custom accounts must be created beforehand)."
            exit 1
        }
    } else {
        Log "OK:" "Kiosk user '$KioskUser' already exists - skipping creation"
    }
} catch {
    Log "ERROR:" "Failed to verify or create kiosk user '$KioskUser': $_"
}

# ─── STEP 2: Configure Auto-Logon ─────────────────────────────────────────────
# AutoAdminLogon auto-logs in Kiosk user. Shell stays explorer.exe in HKLM.
# The per-user Shell override in NTUSER.DAT (Step 6 below) handles the kiosk shell.
if ($KioskPassword -ne "SKIP" -and $KioskPassword -ne "") {
    Log "STEP:" "Configuring auto-logon for $KioskUser..."
    try {
        $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
        Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon"    -Value "1"              -Type String -Force
        Set-ItemProperty -Path $winlogon -Name "DefaultUserName"   -Value $KioskUser      -Type String -Force
        Set-ItemProperty -Path $winlogon -Name "DefaultPassword"   -Value $KioskPassword  -Type String -Force
        Set-ItemProperty -Path $winlogon -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String -Force
        Log "OK:" "Auto-logon registry keys written"
    } catch {
        Log "ERROR:" "Auto-logon configuration failed: $_"
    }
} else {
    Log "INFO:" "Skipping auto-logon configuration (KioskPassword is blank or SKIP)"
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

# ─── STEP 4: Get Kiosk User SID ───────────────────────────────────────────────
Log "STEP:" "Resolving $KioskUser account SID..."
$strSID = $null
try {
    $objUser = New-Object System.Security.Principal.NTAccount($KioskUser)
    $strSID  = $objUser.Translate([System.Security.Principal.SecurityIdentifier]).Value
    Log "OK:" "$KioskUser SID: $strSID"
} catch {
    Log "ERROR:" "Could not resolve $KioskUser SID: $_"
}

# ─── STEP 5: Register Custom Shell via WMI (Shell Launcher) ───────────────────
Log "STEP:" "Disabling WMI Shell Launcher globally to avoid blank screens for Administrators..."
try {
    $ShellLauncherClass = [wmiclass]"\\localhost\root\standardcimv2\embedded:WESL_UserSetting"
    if ($ShellLauncherClass) {
        $ShellLauncherClass.SetEnabled($false)
        Log "OK:" "WMI Shell Launcher disabled (NTUSER.DAT Shell override will be used)"
    } else {
        Log "INFO:" "WMI Shell Launcher not available on this edition of Windows"
    }
} catch {
    Log "WARN:" "WMI Shell Launcher disable check skipped: $_"
}

# ─── Helper: Check if user is an Administrator ────────────────────────────────
function Get-IsUserAdmin {
    param([string]$UserName)
    if ($UserName -eq "Administrator") { return $true }
    try {
        # Translate well-known Administrators SID (S-1-5-32-544) to localized group name
        $adminSid = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
        $adminGroupName = $adminSid.Translate([System.Security.Principal.NTAccount]).Value
        # Strip domain prefix if present (e.g. "BUILTIN\Administrators" -> "Administrators")
        if ($adminGroupName -like "*\*") {
            $adminGroupName = $adminGroupName.Split("\")[1]
        }
        $member = Get-LocalGroupMember -Group $adminGroupName -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\$UserName" -or $_.Name -eq $UserName }
        return ($null -ne $member)
    } catch {
        # Fallback using ADSI
        try {
            $user = [ADSI]"WinNT://$env:COMPUTERNAME/$UserName,user"
            $groups = $user.Groups() | ForEach-Object { $_.GetType().InvokeMember("Name", 'GetProperty', $null, $_, $null) }
            return ($groups -contains "Administrators" -or $groups -contains "Administrateurs" -or $groups -contains "Administradores")
        } catch {
            return $false
        }
    }
}

# ─── STEP 6: Configure Standard User Profiles, Shells, and Restrictions ────────
Log "STEP:" "Configuring shell replacement for standard Kiosk user and restoring default explorer shell for other standard users..."
try {
    # Ensure HKEY_USERS (HKU) drive is mounted in PowerShell
    if (!(Get-PSDrive -Name HKU -ErrorAction SilentlyContinue)) {
        New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS -ErrorAction SilentlyContinue | Out-Null
    }

    $users = Get-LocalUser
    foreach ($u in $users) {
        $username = $u.Name
        # Skip system accounts, Guest, and utility VMs
        if ($username -eq "DefaultAccount" -or $username -eq "WDAGUtilityAccount" -or $username -eq "Guest" -or $username -eq "UtilityVM") {
            continue
        }
        
        $isAdmin = Get-IsUserAdmin $username
        if ($isAdmin -and $username -ne $KioskUser) {
            Log "INFO:" "User '$username' is an Administrator - leaving on explorer.exe"
            continue
        }
        
        if ($username -eq $KioskUser) {
            Log "STEP:" "Configuring standard Kiosk user: $username..."
            
            # Find the profile directory
            $profilePath = "C:\Users\$username"
            
            # Ensure the profile directory exists
            if (!(Test-Path $profilePath)) {
                try {
                    New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
                    $defaultNtuser = "C:\Users\Default\NTUSER.DAT"
                    if (Test-Path $defaultNtuser) {
                        Copy-Item -Path $defaultNtuser -Destination "$profilePath\NTUSER.DAT" -Force
                        Log "OK:" "Pre-created profile directory and copied NTUSER.DAT for standard Kiosk user '$username'"
                    }
                    # Grant permissions to the user on their pre-created folder (non-recursive to prevent hangs)
                    $icaclsOutput = icacls $profilePath /grant "${username}:(OI)(CI)F" 2>&1
                    Log "INFO:" "icacls for $($username) - $icaclsOutput"
                } catch {
                    Log "WARN:" "Could not pre-create profile for '$username': $_"
                }
            }

            $userSid = $null
            try {
                $userObj = New-Object System.Security.Principal.NTAccount($username)
                $userSid = $userObj.Translate([System.Security.Principal.SecurityIdentifier]).Value
            } catch {
                Log "WARN:" "Could not resolve SID for user '$username': $_"
            }

            # Load NTUSER.DAT or write directly if already loaded
            $ntuserDat = "$profilePath\NTUSER.DAT"
            if ((Test-Path $ntuserDat) -or ($null -ne $userSid -and (Test-Path "HKU:\$userSid"))) {
                try {
                    $isLoaded = $null -ne $userSid -and (Test-Path "HKU:\$userSid")
                    $tempHiveName = $null
                    if ($isLoaded) {
                        $hivePath = "HKU:\$userSid"
                        Log "INFO:" "User '$username' profile hive is already loaded (active session). Writing directly to $hivePath"
                    } else {
                        [System.GC]::Collect()
                        Start-Sleep -Milliseconds 200
                        $tempHiveName = "${username}Temp"
                        $hivePath = "HKU:\$tempHiveName"
                        $loadResult = reg load "HKU\$tempHiveName" $ntuserDat 2>&1
                        Log "INFO:" "reg load for $($username) - $loadResult"
                    }
                    
                    # Create the Winlogon key in the user hive if it does not exist
                    New-Item -Path "$hivePath\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" `
                             -Force -ErrorAction SilentlyContinue | Out-Null
                    
                    # Per-user Shell - only standard users get the kiosk shell
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" `
                        -Name  "Shell" `
                        -Value $AgentExe `
                        -Force
                    Log "OK:" "Per-user Shell written for standard Kiosk user '$username': $AgentExe"
                    
                    # Lock-down GPO policies for this standard Kiosk user
                    New-Item -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
                             -Force -ErrorAction SilentlyContinue | Out-Null
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
                        -Name  "DisableTaskMgr"        -Value 1 -Type DWord -Force
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
                        -Name  "HideFastUserSwitching" -Value 1 -Type DWord -Force
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" `
                        -Name  "DisableLockWorkstation" -Value 1 -Type DWord -Force
                    
                    New-Item -Path "$hivePath\Software\Policies\Microsoft\Windows\System" `
                             -Force -ErrorAction SilentlyContinue | Out-Null
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Policies\Microsoft\Windows\System" `
                        -Name  "DisableCMD" -Value 1 -Type DWord -Force

                    New-Item -Path "$hivePath\Software\Policies\Microsoft\Internet Explorer\Control Panel" `
                             -Force -ErrorAction SilentlyContinue | Out-Null
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Policies\Microsoft\Internet Explorer\Control Panel" `
                        -Name  "Proxy" -Value 1 -Type DWord -Force

                    # Disable shutdown/restart/sleep from Start Menu and Ctrl+Alt+Del for kiosk user
                    New-Item -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" `
                             -Force -ErrorAction SilentlyContinue | Out-Null
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" `
                        -Name  "NoClose"          -Value 1 -Type DWord -Force
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" `
                        -Name  "NoLogOff"         -Value 1 -Type DWord -Force
                    Set-ItemProperty `
                        -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" `
                        -Name  "NoStartMenuMorePrograms" -Value 1 -Type DWord -Force

                    Log "OK:" "GPO restriction policies (incl. NoClose/NoLogOff) written for standard Kiosk user '$username'"
                    
                    # Flush and unload if we loaded it
                    if (-not $isLoaded) {
                        [System.GC]::Collect()
                        Start-Sleep -Milliseconds 200
                        $unloadResult = reg unload "HKU\$tempHiveName" 2>&1
                        Log "INFO:" "reg unload for $($username) - $unloadResult"
                        Log "OK:" "Standard Kiosk user '$username' profile hive unloaded successfully"
                    }
                } catch {
                    Log "ERROR:" "Profile hive operations failed for standard Kiosk user '$username': $_"
                    if ($null -ne $tempHiveName -and -not $isLoaded) {
                        try { reg unload "HKU\$tempHiveName" 2>&1 | Out-Null } catch {}
                    }
                }
            } else {
                Log "WARN:" "NTUSER.DAT not found and hive not loaded for standard Kiosk user '$username'"
            }

            # ─── Register Elevated Scheduled Task for this standard Kiosk user ───
            Log "STEP:" "Registering NetCafeAgent elevated Scheduled Task for standard Kiosk user '$username'..."
            try {
                $action    = New-ScheduledTaskAction -Execute $AgentExe
                $trigger   = New-ScheduledTaskTrigger -AtLogon -User $username
                $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0)
                $principal = New-ScheduledTaskPrincipal -UserId $username -RunLevel Highest
                Register-ScheduledTask -TaskName "NetCafeAgent_$username" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
                Log "OK:" "Scheduled Task 'NetCafeAgent_$username' registered (runs at $username logon with Highest privileges)"
            } catch {
                Log "ERROR:" "Scheduled Task registration failed for '$username': $_"
            }
        } else {
            Log "STEP:" "Restoring standard non-Kiosk user: $username to default explorer shell and policies..."
            
            # Find the profile directory
            $profilePath = "C:\Users\$username"
            $userSid = $null
            try {
                $userObj = New-Object System.Security.Principal.NTAccount($username)
                $userSid = $userObj.Translate([System.Security.Principal.SecurityIdentifier]).Value
            } catch {
                Log "WARN:" "Could not resolve SID for user '$username': $_"
            }

            # Load NTUSER.DAT or write directly if already loaded
            $ntuserDat = "$profilePath\NTUSER.DAT"
            if ((Test-Path $ntuserDat) -or ($null -ne $userSid -and (Test-Path "HKU:\$userSid"))) {
                try {
                    $isLoaded = $null -ne $userSid -and (Test-Path "HKU:\$userSid")
                    $tempHiveName = $null
                    if ($isLoaded) {
                        $hivePath = "HKU:\$userSid"
                        Log "INFO:" "User '$username' profile hive is already loaded. Restoring directly."
                    } else {
                        [System.GC]::Collect()
                        Start-Sleep -Milliseconds 200
                        $tempHiveName = "${username}RestoreTemp"
                        $hivePath = "HKU:\$tempHiveName"
                        $loadResult = reg load "HKU\$tempHiveName" $ntuserDat 2>&1
                        Log "INFO:" "reg load for $($username) - $loadResult"
                    }
                    
                    # Remove custom Shell override
                    Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "Shell" -ErrorAction SilentlyContinue
                    
                    # Remove GPO policies
                    Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableTaskMgr" -ErrorAction SilentlyContinue
                    Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "HideFastUserSwitching" -ErrorAction SilentlyContinue
                    Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableLockWorkstation" -ErrorAction SilentlyContinue
                    Remove-ItemProperty -Path "$hivePath\Software\Policies\Microsoft\Windows\System" -Name "DisableCMD" -ErrorAction SilentlyContinue
                    Remove-ItemProperty -Path "$hivePath\Software\Policies\Microsoft\Internet Explorer\Control Panel" -Name "Proxy" -ErrorAction SilentlyContinue
                    
                    Log "OK:" "Restored default Shell and removed GPO policies for standard user '$username'"
                    
                    # Flush and unload if we loaded it
                    if (-not $isLoaded) {
                        [System.GC]::Collect()
                        Start-Sleep -Milliseconds 200
                        $unloadResult = reg unload "HKU\$tempHiveName" 2>&1
                        Log "INFO:" "reg unload for $($username) - $unloadResult"
                        Log "OK:" "Standard user '$username' profile hive unloaded successfully"
                    }
                } catch {
                    Log "ERROR:" "Profile hive operations failed for standard user '$username': $_"
                    if ($null -ne $tempHiveName -and -not $isLoaded) {
                        try { reg unload "HKU\$tempHiveName" 2>&1 | Out-Null } catch {}
                    }
                }
            }

            # ─── Remove Scheduled Task if exists ───
            try {
                if (Get-ScheduledTask -TaskName "NetCafeAgent_$username" -ErrorAction SilentlyContinue) {
                    Unregister-ScheduledTask -TaskName "NetCafeAgent_$username" -Confirm:$false | Out-Null
                    Log "OK:" "Scheduled Task 'NetCafeAgent_$username' removed for non-kiosk user '$username'"
                }
            } catch {
                Log "WARN:" "Scheduled Task removal skipped for '$username': $_"
            }
        }
    }
} catch {
    Log "ERROR:" "Failed to configure standard users: $_"
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
Log "INFO:" "Rebooting computer in 5 seconds to apply kiosk shell and policies..."
Start-Sleep -Seconds 5
Restart-Computer -Force
exit 0
