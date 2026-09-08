; The updater invokes the previously installed assisted uninstaller before the
; new build is copied in. Start uninstallers hidden at process startup so an
; update can never flash the assisted "PageAuto Uninstall" wizard before
; un.onInit has a chance to parse /S. customUnInit restores normal UI for a
; user-started manual uninstall.
!ifdef BUILD_UNINSTALLER
  SilentUnInstall silent
!endif

!macro customUnInit
  ${GetParameters} $R0
  StrCpy $R2 "0"

  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${ifNot} ${Errors}
    StrCpy $R2 "1"
  ${endif}

  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${ifNot} ${Errors}
    StrCpy $R2 "1"
  ${endif}

  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${ifNot} ${Errors}
    StrCpy $R2 "1"
  ${endif}

  ${if} ${isUpdated}
    StrCpy $R2 "1"
  ${endif}

  ${if} $R2 == "1"
    SetSilent silent
  ${else}
    ; SilentUnInstall only protects updater startup. Manual uninstall stays
    ; assisted/interactive exactly as before.
    SetSilent normal
  ${endif}
!macroend

; electron-builder's stock atomic remover walks every entry under $INSTDIR.
; PageAuto deliberately keeps portable runtime data beside PageAuto.exe, so a
; replacement/uninstall must never move, rename, copy, or delete that data.
; This variant keeps the same atomic rollback for program files while skipping
; runtime data roots at the top level. `data_*` is also protected because those
; are operator-created recovery snapshots seen in real installations.
Function un.pageAutoAtomicRMDir
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4

  StrCpy $R3 "$INSTDIR$R0\*.*"
  FindFirst $R1 $R2 $R3

  pageauto_loop:
    StrCmp $R2 "" pageauto_break
    StrCmp $R2 "." pageauto_continue
    StrCmp $R2 ".." pageauto_continue

    ; Only root-level runtime directories are protected. Nested app files are
    ; still replaced atomically as normal.
    StrCmp $R0 "" 0 pageauto_not_protected_root
    StrCmp $R2 "data" pageauto_continue
    StrCpy $R4 $R2 5
    StrCmp $R4 "data_" pageauto_continue

  pageauto_not_protected_root:
    IfFileExists "$INSTDIR$R0\$R2\*.*" pageauto_is_dir pageauto_is_file

  pageauto_is_dir:
    CreateDirectory "$PLUGINSDIR\old-install$R0\$R2"

    Push "$R0\$R2"
    Call un.pageAutoAtomicRMDir
    Pop $R3

    ; This Function is parsed before electron-builder's LogicLib helpers are
    ; available, so use native NSIS branching here instead of ${if}/${endif}.
    StrCmp $R3 "0" 0 pageauto_done
    Goto pageauto_continue

  pageauto_is_file:
    ClearErrors
    Rename "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"

    ; Ignore an inability to rename the uninstaller itself, matching
    ; electron-builder's stock rollback helper.
    StrCmp "$R0\$R2" "${UNINSTALL_FILENAME}" 0 +2
    ClearErrors

    IfErrors 0 +3
    StrCpy $R3 "$INSTDIR$R0\$R2"
    Goto pageauto_done

  pageauto_continue:
    FindNext $R1 $R2
    Goto pageauto_loop

  pageauto_break:
    StrCpy $R3 0

  pageauto_done:
    FindClose $R1
    StrCpy $R0 $R3

    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

!macro customRemoveFiles
  ; Keep runtime data in place. Only program-owned files are moved to the
  ; temporary rollback area. No Rename/Copy/RMDir is ever issued against
  ; $INSTDIR\data or a top-level data_* recovery snapshot.
  CreateDirectory "$PLUGINSDIR\old-install"

  Push ""
  Call un.pageAutoAtomicRMDir
  Pop $R0

  ${if} $R0 != 0
    DetailPrint "File is busy, aborting: $R0"

    Push ""
    Call un.restoreFiles
    Pop $R0

    Abort "PageAuto replacement aborted: old installation contains a busy program file."
  ${endif}

  ; Do not RMDir /r $INSTDIR here. The install directory intentionally remains
  ; because it owns portable runtime data that is independent from app files.
  SetOutPath $TEMP
!macroend
