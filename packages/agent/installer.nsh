; ─────────────────────────────────────────────────────────────────────────────
; NetCafe Agent — Custom NSIS Installer Script
;
; nsExec::ExecToLog pipes every Write-Output line from the PowerShell scripts
; into the NSIS installer detail log in real time.
;
; IMPORTANT: ShowInstDetails and SetDetailsPrint are COMPILER DIRECTIVES — they
; must appear at global scope in the NSIS script. They are NOT valid inside any
; macro (which gets inlined into a Function or Section). Attempting to use them
; inside a macro causes:
;   "Error: command ShowInstDetails not valid in Function/Section"
; Therefore they are NOT used anywhere in this file.
; ─────────────────────────────────────────────────────────────────────────────

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customInstall
  ; Create log directory
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"

  ; Run the kiosk setup PowerShell script.
  ; nsExec::ExecToLog captures stdout line-by-line into the NSIS install log.
  ; PS1 scripts are bundled as extraResources at $INSTDIR\resources\
  DetailPrint "NetCafe: Running kiosk setup (check C:\NetCafe\logs\agent-install.log for details)..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-setup.ps1" "$INSTDIR\NetCafe Agent.exe"'
  Pop $0

  ${If} $0 == "0"
    DetailPrint "NetCafe: Kiosk setup completed successfully!"
  ${Else}
    DetailPrint "NetCafe: Setup finished (exit $0). See C:\NetCafe\logs\agent-install.log"
  ${EndIf}
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customUnInstall
  DetailPrint "NetCafe: Running kiosk uninstall..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-uninstall.ps1"'
  Pop $0

  ${If} $0 == "0"
    DetailPrint "NetCafe: Kiosk uninstall completed successfully!"
  ${Else}
    DetailPrint "NetCafe: Uninstall finished (exit $0). See C:\NetCafe\logs\agent-uninstall.log"
  ${EndIf}
!macroend
