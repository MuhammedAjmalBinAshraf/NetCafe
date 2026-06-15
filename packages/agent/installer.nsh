!macro customInit
  nsExec::Exec 'taskkill /F /IM "NetCafe Agent.exe" /T'
!macroend

!macro customInstall
  nsExec::ExecToLog '"$INSTDIR\NetCafe Agent.exe" --install-kiosk'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "NetCafe Agent.exe" /T'
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$INSTDIR\NetCafe Agent.exe" --uninstall-kiosk'
!macroend
