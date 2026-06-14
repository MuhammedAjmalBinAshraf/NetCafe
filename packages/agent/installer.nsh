!macro customInit
  nsExec::Exec 'taskkill /F /IM "NetCafe Agent.exe" /T'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "NetCafe Agent.exe" /T'
!macroend
