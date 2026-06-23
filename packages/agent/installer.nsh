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
  nsExec::ExecToLog `"$psExe" -NoProfile -ExecutionPolicy Bypass -Command "& { & '${ScriptPath}' ${Params} *>&1 | Tee-Object -FilePath '${LogPath}' }"`
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
  ; ── Stop watchdog service so it cannot restart the agent while we install ──
  nsExec::ExecToLog 'sc stop "NetCafeAgentWatchdog"'
  Pop $0
  Sleep 2000
  ; ── Kill any running agent process ──
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
  Sleep 1000
  ; Clean up legacy global scheduled task from older versions
  nsExec::ExecToLog 'schtasks /Delete /TN "NetCafeAgent" /F'
  Pop $0
!macroend

!macro customInstall
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"
  IfSilent skip_kiosk_setup
  DetailPrint "NetCafe: Running kiosk setup..."
  !insertmacro runPowerShell "$INSTDIR\resources\kiosk-setup.ps1" "'$INSTDIR\NetCafe Agent.exe'" "C:\NetCafe\logs\agent-install.log"
  Pop $0
  DetailPrint "NetCafe: Kiosk setup exited with code $0"
skip_kiosk_setup:

  ; ── Register/Update the watchdog service for both silent and interactive installs ──
  DetailPrint "NetCafe: Installing watchdog service..."
  nsExec::ExecToLog `"$INSTDIR\NetCafe Agent.exe" --install-watchdog --headless --disable-gpu --no-sandbox`
  Pop $0
  DetailPrint "NetCafe: Watchdog service install exited with code $0"
!macroend

!macro customUnInit
  ; Stop watchdog service so it does not restart the agent during uninstall
  nsExec::ExecToLog 'sc stop "NetCafeAgentWatchdog"'
  Pop $0
  Sleep 2000
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customUnInstall
  DetailPrint "NetCafe: Running kiosk uninstall..."
  !insertmacro runPowerShell "$INSTDIR\resources\kiosk-uninstall.ps1" "" "C:\NetCafe\logs\agent-uninstall.log"
  Pop $0
  DetailPrint "NetCafe: Kiosk uninstall exited with code $0"

  ; ── Uninstall/Clean up the watchdog service ──
  DetailPrint "NetCafe: Uninstalling watchdog service..."
  nsExec::ExecToLog `"$INSTDIR\NetCafe Agent.exe" --uninstall-watchdog --headless --disable-gpu --no-sandbox`
  Pop $0
  DetailPrint "NetCafe: Watchdog service uninstall exited with code $0"
!macroend
