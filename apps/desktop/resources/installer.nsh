!macro customRemoveFiles
  StrCpy $R9 "$INSTDIR.__pageauto_data_preserve"
  StrCpy $R8 "0"

  IfFileExists "$R9" 0 pageauto_check_data
  Abort "PageAuto replacement aborted: preserved data directory already exists at $R9"

pageauto_check_data:
  IfFileExists "$INSTDIR\data" pageauto_preserve_data pageauto_remove_old_app

pageauto_preserve_data:
  ClearErrors
  Rename "$INSTDIR\data" "$R9"
  IfErrors pageauto_preserve_failed pageauto_preserved

pageauto_preserve_failed:
  Abort "PageAuto replacement aborted: cannot preserve $INSTDIR\data"

pageauto_preserved:
  StrCpy $R8 "1"

pageauto_remove_old_app:
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      Push ""
      Call un.restoreFiles
      Pop $R0
      ${if} $R8 == "1"
        CreateDirectory "$INSTDIR"
        ClearErrors
        Rename "$R9" "$INSTDIR\data"
        IfErrors pageauto_busy_restore_failed pageauto_busy_abort

pageauto_busy_restore_failed:
        Abort "PageAuto update aborted: preserved data could not be restored to $INSTDIR\data"

pageauto_busy_abort:
      ${endif}
      Abort "PageAuto update aborted: old installation contains a busy file."
    ${endif}
  ${else}
    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
  ${endif}

  ${if} $R8 == "1"
    ClearErrors
    Rename "$R9" "$INSTDIR\data"
    IfErrors pageauto_restore_failed pageauto_remove_done

pageauto_restore_failed:
    Abort "PageAuto replacement aborted: preserved data could not be restored to $INSTDIR\data"
  ${endif}

pageauto_remove_done:
!macroend
