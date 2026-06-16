; NetCafe Agent - Custom NSIS Installer Script
; nsExec::ExecToLog pipes PowerShell stdout into the NSIS detail log in real time.
; PS1 scripts are bundled as extraResources inside the installer package.
; NOTE: ShowInstDetails and SetDetailsPrint are global compiler directives only
;       and cannot be used inside any macro in electron-builder templates.
ShowInstDetails show
ShowUninstDetails show


!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customInstall
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"
  DetailPrint "NetCafe: Running kiosk setup..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-setup.ps1" "$INSTDIR\NetCafe Agent.exe"'
  Pop $0
  DetailPrint "NetCafe: Kiosk setup exited with code $0"
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customUnInstall
  DetailPrint "NetCafe: Running kiosk uninstall..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-uninstall.ps1"'
  Pop $0
  DetailPrint "NetCafe: Kiosk uninstall exited with code $0"
!macroend
