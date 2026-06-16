; NetCafe Agent - Custom NSIS Installer Script
; nsExec::ExecToLog pipes PowerShell stdout into the NSIS detail log in real time.
; PS1 scripts are bundled as extraResources inside the installer package.
!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

; Enable "View Installation Log" checkbox on the finish page
!define MUI_FINISHPAGE_RUN "$WINDIR\notepad.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "C:\NetCafe\logs\agent-install.log"
!define MUI_FINISHPAGE_RUN_TEXT "View Installation Log"

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
  ; Clean up legacy global scheduled task from older versions
  nsExec::ExecToLog 'schtasks /Delete /TN "NetCafeAgent" /F'
  Pop $0
!macroend

!macro customInstall
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"
  DetailPrint "NetCafe: Running kiosk setup..."
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { & '$INSTDIR\resources\kiosk-setup.ps1' '$INSTDIR\NetCafe Agent.exe' *>&1 | Tee-Object -FilePath 'C:\NetCafe\logs\agent-install.log' }"`
  Pop $0
  DetailPrint "NetCafe: Kiosk setup exited with code $0"
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customUnInstall
  DetailPrint "NetCafe: Running kiosk uninstall..."
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { & '$INSTDIR\resources\kiosk-uninstall.ps1' *>&1 | Tee-Object -FilePath 'C:\NetCafe\logs\agent-uninstall.log' }"`
  Pop $0
  DetailPrint "NetCafe: Kiosk uninstall exited with code $0"
!macroend
