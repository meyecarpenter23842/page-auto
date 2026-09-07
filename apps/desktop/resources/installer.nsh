!ifndef BUILD_UNINSTALLER
!macro customCheckAppRunning
  ; Keep electron-builder 26.15.3's stock process-close behavior, then preserve
  ; runtime data only after PageAuto is confirmed closed. This avoids stranding
  ; data if CHECK_APP_RUNNING itself has to abort/quit the updater.
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING

  ${if} $pageAutoUpdaterReplacement != "1"
    Goto pageauto_outer_preserve_done
  ${endif}

  ; Recover a guard left by an interrupted new-installer attempt.
  IfFileExists "$pageAutoUpdateGuardPath" pageauto_check_existing_guard pageauto_check_legacy_preserve

pageauto_check_existing_guard:
  IfFileExists "$pageAutoUpdateInstallDir\data" pageauto_outer_preserve_conflict pageauto_existing_guard_no_live_data

pageauto_existing_guard_no_live_data:
  IfFileExists "$pageAutoLegacyPreservePath" pageauto_outer_preserve_conflict pageauto_outer_preserved

pageauto_check_legacy_preserve:
  ; PR #326/#328 used this sibling path from inside the old uninstaller. Adopt a
  ; stranded legacy preserve directory into the NEW installer's independent guard.
  IfFileExists "$pageAutoLegacyPreservePath" pageauto_adopt_legacy_preserve pageauto_check_live_data

pageauto_adopt_legacy_preserve:
  IfFileExists "$pageAutoUpdateInstallDir\data" pageauto_outer_preserve_conflict pageauto_move_legacy_preserve

pageauto_move_legacy_preserve:
  ClearErrors
  Rename "$pageAutoLegacyPreservePath" "$pageAutoUpdateGuardPath"
  IfErrors pageauto_outer_preserve_failed pageauto_outer_preserved

pageauto_check_live_data:
  IfFileExists "$pageAutoUpdateInstallDir\data" pageauto_move_live_data pageauto_outer_preserve_done

pageauto_move_live_data:
  ClearErrors
  Rename "$pageAutoUpdateInstallDir\data" "$pageAutoUpdateGuardPath"
  IfErrors pageauto_outer_preserve_failed pageauto_outer_preserved

pageauto_outer_preserved:
  StrCpy $pageAutoUpdateDataPreserved "1"
  DetailPrint "PageAuto update guard preserved runtime data after PageAuto closed and before old-version uninstall."
  Goto pageauto_outer_preserve_done

pageauto_outer_preserve_conflict:
  MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: multiple live/preserved data directories exist. Runtime data was not modified." /SD IDOK
  SetErrorLevel 2
  Quit

pageauto_outer_preserve_failed:
  MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: runtime data could not be moved to the update guard." /SD IDOK
  SetErrorLevel 2
  Quit

pageauto_outer_preserve_done:
  ClearErrors
!macroend
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ; Defining customCheckAppRunning makes electron-builder skip these stock
    ; prerequisites, so provide them here before CHECK_APP_RUNNING is expanded.
    !include "getProcessInfo.nsh"
    Var pid
    Var pageAutoUpdaterReplacement
    Var pageAutoUpdateDataPreserved
    Var pageAutoUpdateInstallDir
    Var pageAutoUpdateGuardPath
    Var pageAutoLegacyPreservePath
    Var pageAutoUpdateConflictPath
  !endif
!macroend

!macro customInit
  ; initMultiUser has already resolved the registered install location here.
  ; Only detect updater replacement and prepare paths; runtime data is NOT moved
  ; until customCheckAppRunning has successfully completed the stock close check.
  StrCpy $pageAutoUpdaterReplacement "0"
  StrCpy $pageAutoUpdateDataPreserved "0"
  StrCpy $pageAutoUpdateInstallDir "$INSTDIR"
  StrCpy $pageAutoUpdateGuardPath "$INSTDIR.__pageauto_update_guard"
  StrCpy $pageAutoLegacyPreservePath "$INSTDIR.__pageauto_data_preserve"
  StrCpy $pageAutoUpdateConflictPath "$INSTDIR.__pageauto_update_conflict"

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${ifNot} ${Errors}
    StrCpy $pageAutoUpdaterReplacement "1"
  ${else}
    ClearErrors
    ${if} ${isUpdated}
      StrCpy $pageAutoUpdaterReplacement "1"
    ${endif}
  ${endif}
  ClearErrors
!macroend

!macro customUnInstallCheck
  ; This hook runs in the NEW installer after electron-builder finishes
  ; calling/retrying the old uninstaller. Never accept exit code 2 blindly: data
  ; is outside $INSTDIR, so continue only if guarded cleanup proves the old
  ; application directory can actually be removed.
  ${if} $pageAutoUpdaterReplacement == "1"
    IfErrors pageauto_outer_old_uninstall_not_launched pageauto_outer_old_uninstall_result

pageauto_outer_old_uninstall_not_launched:
    DetailPrint "Old PageAuto uninstaller could not be launched; attempting guarded application-file cleanup."
    Goto pageauto_outer_try_cleanup

pageauto_outer_old_uninstall_result:
    ${if} $R0 == 0
      ClearErrors
      Goto pageauto_outer_uninstall_check_done
    ${elseif} $R0 == 2
      DetailPrint "Old PageAuto uninstaller returned exit code 2; verifying with guarded application-file cleanup."
      Goto pageauto_outer_try_cleanup
    ${else}
      Goto pageauto_outer_uninstall_failed
    ${endif}

pageauto_outer_try_cleanup:
    SetOutPath $TEMP
    ClearErrors
    RMDir /r "$pageAutoUpdateInstallDir"
    IfErrors pageauto_outer_uninstall_failed pageauto_outer_verify_cleanup

pageauto_outer_verify_cleanup:
    IfFileExists "$pageAutoUpdateInstallDir\*.*" pageauto_outer_uninstall_failed pageauto_outer_cleanup_empty_dir

pageauto_outer_cleanup_empty_dir:
    IfFileExists "$pageAutoUpdateInstallDir" 0 pageauto_outer_cleanup_success
    ClearErrors
    RMDir "$pageAutoUpdateInstallDir"
    IfErrors pageauto_outer_uninstall_failed pageauto_outer_cleanup_success

pageauto_outer_cleanup_success:
    StrCpy $R0 "0"
    ClearErrors
    DetailPrint "Guarded old-application cleanup succeeded; continuing update."
    Goto pageauto_outer_uninstall_check_done

pageauto_outer_uninstall_failed:
    DetailPrint "PageAuto update failed while removing the old application."
    ${if} $pageAutoUpdateDataPreserved == "1"
      CreateDirectory "$pageAutoUpdateInstallDir"
      IfFileExists "$pageAutoUpdateInstallDir\data" pageauto_outer_quarantine_conflict pageauto_outer_restore_data

pageauto_outer_quarantine_conflict:
      IfFileExists "$pageAutoUpdateConflictPath" pageauto_outer_restore_conflict pageauto_outer_move_conflict

pageauto_outer_move_conflict:
      ClearErrors
      Rename "$pageAutoUpdateInstallDir\data" "$pageAutoUpdateConflictPath"
      IfErrors pageauto_outer_restore_conflict pageauto_outer_restore_data

pageauto_outer_restore_data:
      ClearErrors
      Rename "$pageAutoUpdateGuardPath" "$pageAutoUpdateInstallDir\data"
      IfErrors pageauto_outer_restore_failed pageauto_outer_restore_ok

pageauto_outer_restore_ok:
      StrCpy $pageAutoUpdateDataPreserved "0"
      DetailPrint "PageAuto update guard restored runtime data after old-application removal failure."
    ${endif}
    MessageBox MB_OK|MB_ICONEXCLAMATION "PageAuto update aborted while removing the old application. Runtime data was restored when present." /SD IDOK
    SetErrorLevel 2
    Quit

pageauto_outer_restore_conflict:
    MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: old application removal failed and guarded runtime data could not be restored safely. Guarded data remains at $pageAutoUpdateGuardPath." /SD IDOK
    SetErrorLevel 2
    Quit

pageauto_outer_restore_failed:
    MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: guarded runtime data could not be restored from $pageAutoUpdateGuardPath." /SD IDOK
    SetErrorLevel 2
    Quit

pageauto_outer_uninstall_check_done:
  ${else}
    ; Preserve electron-builder's stock behavior for manual installs/reinstalls.
    IfErrors pageauto_default_uninstall_launch_error pageauto_default_uninstall_result

pageauto_default_uninstall_launch_error:
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    Return

pageauto_default_uninstall_result:
    ${if} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      SetErrorLevel 2
      Quit
    ${endif}
  ${endif}
!macroend

!macro customInstall
  ; New application files are in place. Restore guarded runtime data before
  ; electron-builder can launch PageAuto.
  ${if} $pageAutoUpdaterReplacement == "1"
    ${if} "$INSTDIR" != "$pageAutoUpdateInstallDir"
      MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: install directory changed during updater replacement. Guarded runtime data remains at $pageAutoUpdateGuardPath." /SD IDOK
      SetErrorLevel 2
      Quit
    ${endif}

    ${if} $pageAutoUpdateDataPreserved == "1"
      IfFileExists "$INSTDIR\data" pageauto_install_quarantine_conflict pageauto_install_restore_data

pageauto_install_quarantine_conflict:
      IfFileExists "$pageAutoUpdateConflictPath" pageauto_install_restore_conflict pageauto_install_move_conflict

pageauto_install_move_conflict:
      ClearErrors
      Rename "$INSTDIR\data" "$pageAutoUpdateConflictPath"
      IfErrors pageauto_install_restore_conflict pageauto_install_restore_data

pageauto_install_restore_data:
      ClearErrors
      Rename "$pageAutoUpdateGuardPath" "$INSTDIR\data"
      IfErrors pageauto_install_restore_failed pageauto_install_restore_ok

pageauto_install_restore_ok:
      StrCpy $pageAutoUpdateDataPreserved "0"
      DetailPrint "PageAuto update guard restored runtime data after application replacement."
      Goto pageauto_install_restore_done

pageauto_install_restore_conflict:
      MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: existing data could not be quarantined before guarded runtime data restore. Guarded data remains at $pageAutoUpdateGuardPath." /SD IDOK
      SetErrorLevel 2
      Quit

pageauto_install_restore_failed:
      MessageBox MB_OK|MB_ICONSTOP "PageAuto update aborted: guarded runtime data could not be restored to $INSTDIR\data. Guarded data remains at $pageAutoUpdateGuardPath." /SD IDOK
      SetErrorLevel 2
      Quit

pageauto_install_restore_done:
    ${endif}
  ${endif}
!macroend

!macro customUnInit
  ; electron-updater launches the old assisted uninstaller during an upgrade.
  ; electron-builder normally passes both /S and --updated. The generated
  ; uninstaller handles /S before this hook, but keep both explicit signals as
  ; defensive fallbacks while leaving user-started manual uninstall interactive.
  ${GetParameters} $R0

  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${ifNot} ${Errors}
    SetSilent silent
  ${else}
    ClearErrors
    ${GetOptions} $R0 "--updated" $R1
    ${ifNot} ${Errors}
      SetSilent silent
    ${else}
      ${if} ${isUpdated}
        SetSilent silent
      ${endif}
    ${endif}
  ${endif}
!macroend

!macro customRemoveFiles
  ; Direct/manual uninstall compatibility. During updater replacement the NEW
  ; installer normally moved data to __pageauto_update_guard first, so the old
  ; uninstaller sees no live data and cannot strand it during internal retries.
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
  ${endif}

  CreateDirectory "$INSTDIR"

  ${if} $R8 == "1"
    ClearErrors
    Rename "$R9" "$INSTDIR\data"
    IfErrors pageauto_restore_failed pageauto_remove_done

pageauto_restore_failed:
    Abort "PageAuto replacement aborted: preserved data could not be restored to $INSTDIR\data"
  ${endif}

pageauto_remove_done:
!macroend
