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

# Helper: Check if user is an Administrator
function Get-IsUserAdmin {
    param([string]$UserName)
    if ($UserName -eq "Administrator") { return $true }
    try {
        $adminSid = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
        $adminGroupName = $adminSid.Translate([System.Security.Principal.NTAccount]).Value
        if ($adminGroupName -like "*\*") {
            $adminGroupName = $adminGroupName.Split("\")[1]
        }
        $member = Get-LocalGroupMember -Group $adminGroupName -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\$UserName" -or $_.Name -eq $UserName }
        return ($null -ne $member)
    } catch {
        try {
            $user = [ADSI]"WinNT://$env:COMPUTERNAME/$UserName,user"
            $groups = $user.Groups() | ForEach-Object { $_.GetType().InvokeMember("Name", 'GetProperty', $null, $_, $null) }
            return ($groups -contains "Administrators" -or $groups -contains "Administrateurs" -or $groups -contains "Administradores")
        } catch {
            return $false
        }
    }
}

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

# ─── STEP 3: Remove Scheduled Tasks ───────────────────────────────────────────
Log "STEP:" "Removing NetCafeAgent Scheduled Tasks..."
try {
    Get-ScheduledTask -TaskName "NetCafeAgent*" -ErrorAction SilentlyContinue | ForEach-Object {
        Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false | Out-Null
        Log "OK:" "Scheduled Task '$($_.TaskName)' removed"
    }
} catch {
    Log "WARN:" "Scheduled Task removal skipped: $_"
# ─── STEP 3.5: Restore Explorer Shell & Remove GPO Restrictions for Standard Users ───
Log "STEP:" "Restoring default Explorer shell and removing GPO policies for standard users..."
try {
    $users = Get-LocalUser
    foreach ($u in $users) {
        $username = $u.Name
        if ($username -eq "DefaultAccount" -or $username -eq "WDAGUtilityAccount" -or $username -eq "Guest" -or $username -eq "UtilityVM") {
            continue
        }
        
        $isAdmin = Get-IsUserAdmin $username
        if ($isAdmin) {
            continue
        }
        
        Log "STEP:" "Restoring standard user '$username' profile registry settings..."
        
        $profilePath = "C:\Users\$username"
        $userSid = $null
        try {
            $userObj = New-Object System.Security.Principal.NTAccount($username)
            $userSid = $userObj.Translate([System.Security.Principal.SecurityIdentifier]).Value
        } catch {
            Log "WARN:" "Could not resolve SID for user '$username': $_"
        }

        $ntuserDat = "$profilePath\NTUSER.DAT"
        if (Test-Path $ntuserDat -or ($null -ne $userSid -and (Test-Path "HKU:\$userSid"))) {
            try {
                $isLoaded = $null -ne $userSid -and (Test-Path "HKU:\$userSid")
                $tempHiveName = $null
                if ($isLoaded) {
                    $hivePath = "HKU:\$userSid"
                    Log "INFO:" "User '$username' profile hive is already loaded. Restoring directly."
                } else {
                    [System.GC]::Collect()
                    Start-Sleep -Milliseconds 200
                    $tempHiveName = "${username}UninstallTemp"
                    $hivePath = "HKU:\$tempHiveName"
                    $loadResult = reg load "HKU\$tempHiveName" $ntuserDat 2>&1
                    Log "INFO:" "reg load for $username: $loadResult"
                }
                
                # Delete per-user custom Winlogon Shell if present
                Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "Shell" -ErrorAction SilentlyContinue
                Log "OK:" "Restored default Shell for standard user '$username'"
                
                # Remove GPO restriction policies
                Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableTaskMgr" -ErrorAction SilentlyContinue
                Remove-ItemProperty -Path "$hivePath\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "HideFastUserSwitching" -ErrorAction SilentlyContinue
                Remove-ItemProperty -Path "$hivePath\Software\Policies\Microsoft\Windows\System" -Name "DisableCMD" -ErrorAction SilentlyContinue
                Log "OK:" "GPO restriction policies removed for standard user '$username'"
                
                # Flush and unload if we loaded it
                if (-not $isLoaded) {
                    [System.GC]::Collect()
                    Start-Sleep -Milliseconds 200
                    $unloadResult = reg unload "HKU\$tempHiveName" 2>&1
                    Log "INFO:" "reg unload for $username: $unloadResult"
                    Log "OK:" "Standard user '$username' profile hive unloaded successfully"
                }
            } catch {
                Log "ERROR:" "Profile hive operations failed for standard user '$username': $_"
                if ($null -ne $tempHiveName -and -not $isLoaded) {
                    try { reg unload "HKU\$tempHiveName" 2>&1 | Out-Null } catch {}
                }
            }
        }
    }
} catch {
    Log "ERROR:" "Failed to clean up standard user registry hives: $_"
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

# ─── STEP 8: Disable System Proxy for Current User ────────────────────────────
Log "STEP:" "Disabling system proxy for current user..."
try {
    $proxyKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    Set-ItemProperty -Path $proxyKey -Name "ProxyEnable" -Value 0 -Type DWord -Force
    # Notify WinINet
    Add-Type -MemberDefinition '[DllImport("wininet.dll", SetLastError = true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);' -Name WinINetHelper -Namespace WinINet
    [WinINet.WinINetHelper]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
    Log "OK:" "System proxy disabled for current user"
} catch {
    Log "WARN:" "Could not disable system proxy for current user: $_"
}

Log "DONE:" "NetCafe Kiosk Uninstall completed. Review log at $LogFile"
exit 0
