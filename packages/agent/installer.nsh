; ─────────────────────────────────────────────────────────────────────────────
; NetCafe Agent — Custom NSIS Installer Script
;
; Uses nsExec::ExecToLog so every Write-Output line from the PowerShell scripts
; appears live in the NSIS installer "Details" panel — like Windows File Copy's
; "More details" dropdown.
;
; NOTE: ShowInstDetails / SetDetailsPrint are Section-level commands only.
;       They CANNOT be placed inside customInit / customUnInit because those
;       macros are expanded inside .onInit / un.onInit Functions.
; ─────────────────────────────────────────────────────────────────────────────

!macro customInit
  ; Kill any running agent before install (no ShowInstDetails here — Function context)
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customInstall
  ; Section context — ShowInstDetails and SetDetailsPrint are valid here
  ShowInstDetails show
  SetDetailsPrint both

  ; Ensure log directory exists
  DetailPrint "NetCafe: Creating log directory C:\NetCafe\logs ..."
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"
  DetailPrint "NetCafe: Log directory ready."

  ; Run the kiosk setup PowerShell script.
  ; nsExec::ExecToLog captures stdout line-by-line and prints each line to
  ; the NSIS detail log window in real time.
  ; The PS1 script is bundled as extraResource at $INSTDIR\resources\kiosk-setup.ps1
  DetailPrint "NetCafe: Starting kiosk configuration (see details below)..."
  DetailPrint "─────────────────────────────────────────"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-setup.ps1" "$INSTDIR\NetCafe Agent.exe"'
  Pop $0
  DetailPrint "─────────────────────────────────────────"
  DetailPrint "NetCafe: Kiosk setup script exited with code: $0"

  ${If} $0 == "0"
    DetailPrint "NetCafe: Kiosk setup completed successfully!"
  ${Else}
    DetailPrint "NetCafe: Setup finished with warnings. Check C:\NetCafe\logs\agent-install.log"
  ${EndIf}

  DetailPrint "NetCafe: Installation complete."
!macroend

!macro customUnInit
  ; Kill any running agent before uninstall (Function context — no ShowInstDetails)
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customUnInstall
  ; Section context — ShowInstDetails and SetDetailsPrint are valid here
  ShowInstDetails show
  SetDetailsPrint both

  DetailPrint "NetCafe: Starting kiosk uninstall (see details below)..."
  DetailPrint "─────────────────────────────────────────"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-uninstall.ps1"'
  Pop $0
  DetailPrint "─────────────────────────────────────────"
  DetailPrint "NetCafe: Kiosk uninstall script exited with code: $0"

  ${If} $0 == "0"
    DetailPrint "NetCafe: Kiosk uninstall completed successfully!"
  ${Else}
    DetailPrint "NetCafe: Uninstall finished with warnings. Check C:\NetCafe\logs\agent-uninstall.log"
  ${EndIf}
!macroend
