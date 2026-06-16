; ─────────────────────────────────────────────────────────────────────────────
; NetCafe Agent — Custom NSIS Installer Script
;
; Uses nsExec::ExecToLog so every Write-Output line from the PowerShell scripts
; appears live in the NSIS installer "Details" panel — like Windows File Copy's
; "More details" dropdown.
; ─────────────────────────────────────────────────────────────────────────────

!macro customInit
  ; Show the details panel automatically so the user can see progress
  ShowInstDetails show
  SetDetailsPrint both

  DetailPrint "NetCafe: Stopping any running agent processes..."
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
  DetailPrint "NetCafe: Agent stopped (exit: $0)"
!macroend

!macro customInstall
  ShowInstDetails show
  SetDetailsPrint both

  ; Ensure log directory exists
  DetailPrint "NetCafe: Creating log directory..."
  CreateDirectory "C:\NetCafe"
  CreateDirectory "C:\NetCafe\logs"
  DetailPrint "NetCafe: Log directory ready -> C:\NetCafe\logs\"

  ; Run the kiosk setup PowerShell script.
  ; nsExec::ExecToLog captures stdout line-by-line and prints each line to
  ; the NSIS detail log window in real time.
  ; The PS1 script is bundled as an extraResource at $INSTDIR\resources\kiosk-setup.ps1
  DetailPrint "NetCafe: Starting kiosk configuration — see details below..."
  DetailPrint "─────────────────────────────────────────"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-setup.ps1" "$INSTDIR\NetCafe Agent.exe"'
  Pop $0
  DetailPrint "─────────────────────────────────────────"
  DetailPrint "NetCafe: Kiosk setup script exited with code $0"

  ${If} $0 == "0"
    DetailPrint "NetCafe: ✅ Kiosk setup completed successfully!"
  ${Else}
    DetailPrint "NetCafe: ⚠️ Setup finished with warnings. Check C:\NetCafe\logs\agent-install.log"
  ${EndIf}

  DetailPrint "NetCafe: Installation complete."
!macroend

!macro customUnInit
  ShowInstDetails show
  SetDetailsPrint both

  DetailPrint "NetCafe: Stopping agent processes before uninstall..."
  nsExec::ExecToLog 'taskkill /F /IM "NetCafe Agent.exe" /T'
  Pop $0
!macroend

!macro customUnInstall
  ShowInstDetails show
  SetDetailsPrint both

  DetailPrint "NetCafe: Starting kiosk uninstall — see details below..."
  DetailPrint "─────────────────────────────────────────"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\kiosk-uninstall.ps1"'
  Pop $0
  DetailPrint "─────────────────────────────────────────"
  DetailPrint "NetCafe: Kiosk uninstall script exited with code $0"

  ${If} $0 == "0"
    DetailPrint "NetCafe: ✅ Kiosk uninstall completed successfully!"
  ${Else}
    DetailPrint "NetCafe: ⚠️ Uninstall finished with warnings. Check C:\NetCafe\logs\agent-uninstall.log"
  ${EndIf}
!macroend
