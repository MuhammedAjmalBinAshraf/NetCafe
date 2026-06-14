!macro customInit
  nsExec::Exec 'taskkill /F /IM "NetCafe Server.exe" /T'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "NetCafe Server.exe" /T'
!macroend
