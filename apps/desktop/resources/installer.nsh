!macro customRemoveFiles
  ${if} ${isUpdated}
    StrCpy $R9 "$INSTDIR.__pageauto_data_preserve"
    StrCpy $R8 "0"

    IfFileExists "$R9" 0 pageauto_check_data
    Abort "PageAuto update aborted: preserved data directory already exists at $R9"

pageauto_check_data:
    IfFileExists "$INSTDIR\data" pageauto_preserve_data pageauto_remove_old_app

pageauto_preserve_data:
    ClearErrors
    Rename "$INSTDIR\data" "$R9"
    IfErrors pageauto_preserve_failed pageauto_preserved

pageauto_preserve_failed:
    Abort "PageAuto update aborted: cannot preserve $INSTDIR\data"

pageauto_preserved:
    StrCpy $R8 "1"

pageauto_remove_old_app:
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
        Rename "$R9" "$INSTDIR\data"
      ${endif}
      Abort "PageAuto update aborted: old installation contains a busy file."
    ${endif}

    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"

    ${if} $R8 == "1"
      ClearErrors
      Rename "$R9" "$INSTDIR\data"
      IfErrors pageauto_restore_failed pageauto_update_remove_done

pageauto_restore_failed:
      Abort "PageAuto update aborted: preserved data could not be restored to $INSTDIR\data"
    ${endif}

pageauto_update_remove_done:
  ${else}
    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
  ${endif}
!macroend
