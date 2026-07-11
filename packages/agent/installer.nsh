; NetCafe Agent - Custom NSIS Installer Script
; nsExec::ExecToLog pipes PowerShell stdout into the NSIS detail log in real time.
; PS1 scripts are bundled as extraResources inside the installer package.

Var /GLOBAL psExe

!macro runPowerShell ScriptPath Params LogPath
  IfFileExists "$WINDIR\SysNative\WindowsPowerShell\v1.0\powershell.exe" launch_sysnative launch_system32
launch_sysnative:
  StrCpy $psExe "$WINDIR\SysNative\WindowsPowerShell\v1.0\powershell.exe"
  Goto ps_ready
launch_system32:
  StrCpy $psExe "powershell.exe"
  Goto ps_ready
ps_ready:
  nsExec::ExecToLog `"$psExe" -NoProfile -ExecutionPolicy Bypass -Command "& { & '${ScriptPath}' ${Params} *>&1 | Tee-Object -FilePath '${LogPath}' -Append }"`
!macroend

!macro LogAndExec Command
  ; --- Log the command being executed ---
  ; Split into 3 FileWrite calls: prefix + command (backtick-quoted to handle
  ; embedded double-quotes) + newline.  A single FileWrite with ${Command}
  ; embedded inside a double-quoted string causes NSIS to see 3 tokens when
  ; the command itself contains quotes, triggering "FileWrite expects 2 parameters".
  FileOpen $9 "C:\NetCafe\logs\agent-install.log" a
  FileSeek $9 0 END
  FileWrite $9 "[Installer] Executing: "
  FileWrite $9 `${Command}`
  FileWrite $9 "$\r$\n"
  FileClose $9

  ; --- Run the command ---
  nsExec::ExecToStack `${Command}`
  Pop $0 ; Exit code
  Pop $1 ; stdout/stderr (up to 1024 bytes)

  ; --- Log output and exit code ---
  FileOpen $9 "C:\NetCafe\logs\agent-install.log" a
  FileSeek $9 0 END
  FileWrite $9 "[Installer] Output: "
  FileWrite $9 $1
  FileWrite $9 "$\r$\n[Installer] Exit Code: $0$\r$\n$\r$\n"
  FileClose $9
!macroend


!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

; Enable "View Installation Log" checkbox on the finish page
!define MUI_FINISHPAGE_RUN "$WINDIR\notepad.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "C:\NetCafe\logs\agent-install.log"
!define MUI_FINISHPAGE_RUN_TEXT "View Installation Log"

!macro customInit
  ; Create logs directory so we can write our logs there
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"

  ; Append a start boundary to the log file to separate installation sessions
  FileOpen $9 "C:\NetCafe\logs\agent-install.log" a
  FileSeek $9 0 END
  FileWrite $9 "=========================================================$\r$\n"
  FileWrite $9 "[Installer] NetCafe Agent installation initialized$\r$\n"
  FileWrite $9 "=========================================================$\r$\n"
  FileClose $9

  ; ── Stop watchdog service so it cannot restart the agent while we install ──
  !insertmacro LogAndExec 'sc stop "NetCafeAgentWatchdog"'
  Sleep 2000
  ; ── Kill any running agent process ──
  !insertmacro LogAndExec 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Sleep 1000
  ; Clean up legacy global scheduled task from older versions
  !insertmacro LogAndExec 'schtasks /Delete /TN "NetCafeAgent" /F'

  ; ── Clean up legacy global HKLM browser policies to restore Administrator internet access ──
  DetailPrint "NetCafe: Cleaning up legacy HKLM policies..."
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "ProxySettings" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "BlockExternalExtensions" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "DeveloperToolsAvailability" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "SyncDisabled" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "IncognitoModeAvailability" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "WebRtcIPHandling" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v "DnsOverHttpsMode" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Google\Chrome\URLBlocklist" /f'

  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "ProxySettings" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "BlockExternalExtensions" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "DeveloperToolsAvailability" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "SyncDisabled" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "InPrivateModeAvailability" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "WebRtcIPHandling" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "DnsOverHttpsMode" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist" /f'
  !insertmacro LogAndExec 'reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Edge\URLBlocklist" /f'
!macroend


!macro customInstall
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"
  
  DetailPrint "NetCafe: Running kiosk setup..."
  !insertmacro runPowerShell "$INSTDIR\resources\kiosk-setup.ps1" "'$INSTDIR\NetCafe Agent.exe'" "C:\NetCafe\logs\agent-install.log"
  Pop $0
  DetailPrint "NetCafe: Kiosk setup exited with code $0"

  ; ── Register/Update the watchdog service for both silent and interactive installs ──
  DetailPrint "NetCafe: Installing watchdog service..."
  !insertmacro LogAndExec `"$INSTDIR\NetCafe Agent.exe" --install-watchdog --headless --disable-gpu --no-sandbox`

  ; ── Start the watchdog service so it can relaunch the agent shell ──
  DetailPrint "NetCafe: Starting watchdog service..."
  !insertmacro LogAndExec 'sc start "NetCafeAgentWatchdog"'
!macroend


!macro customUnInit
  ; Stop watchdog service so it does not restart the agent during uninstall
  !insertmacro LogAndExec 'sc stop "NetCafeAgentWatchdog"'
  Sleep 2000
  !insertmacro LogAndExec 'taskkill /F /IM "NetCafe Agent.exe" /T'
!macroend

!macro customUnInstall
  DetailPrint "NetCafe: Running kiosk uninstall..."
  !insertmacro runPowerShell "$INSTDIR\resources\kiosk-uninstall.ps1" "" "C:\NetCafe\logs\agent-uninstall.log"
  Pop $0
  DetailPrint "NetCafe: Kiosk uninstall exited with code $0"

  ; ── Uninstall/Clean up the watchdog service ──
  DetailPrint "NetCafe: Uninstalling watchdog service..."
  !insertmacro LogAndExec `"$INSTDIR\NetCafe Agent.exe" --uninstall-watchdog --headless --disable-gpu --no-sandbox`
!macroend
