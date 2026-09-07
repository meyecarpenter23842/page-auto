import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appDirectory = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDirectory, '../..')
const builderConfig = readFileSync(resolve(appDirectory, 'electron-builder.yml'), 'utf8')
const installerInclude = readFileSync(resolve(appDirectory, 'resources/installer.nsh'), 'utf8')
const desktopPackage = JSON.parse(readFileSync(resolve(appDirectory, 'package.json'), 'utf8'))
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
const updaterMain = readFileSync(resolve(appDirectory, 'src/main/appUpdaterIpc.ts'), 'utf8')
const updaterUi = readFileSync(resolve(appDirectory, 'src/renderer/src/settings/UpdateSettingsSection.tsx'), 'utf8')
const updaterBridge = readFileSync(resolve(appDirectory, 'src/preload/appUpdaterBridge.ts'), 'utf8')

const publicFeed = 'https://pub-4e0416c66f7b4c7e9542bb6296775673.r2.dev'

function requireMatch(value, pattern, label) {
  if (!pattern.test(value)) throw new Error(`Updater contract missing ${label}`)
}

function extractMacro(name) {
  return installerInclude.match(new RegExp(`!macro ${name}([\\s\\S]*?)!macroend`))?.[1] ?? ''
}

requireMatch(builderConfig, /^\s*provider:\s*generic\s*$/m, 'generic provider')
requireMatch(builderConfig, new RegExp(`^\\s*url:\\s*${publicFeed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'), 'public R2 feed URL')
requireMatch(builderConfig, /^\s*channel:\s*latest\s*$/m, 'latest channel')
requireMatch(builderConfig, /^\s*include:\s*resources\/installer\.nsh\s*$/m, 'NSIS data-preservation include')

const customHeader = extractMacro('customHeader')
for (const required of [
  '!include "getProcessInfo.nsh"',
  'Var pid',
  'Var pageAutoUpdaterReplacement',
  'Var pageAutoUpdateDataPreserved',
  'Var pageAutoUpdateInstallDir',
  'Var pageAutoUpdateGuardPath',
  'Var pageAutoLegacyPreservePath',
  'Var pageAutoUpdateConflictPath'
]) {
  if (!customHeader.includes(required)) {
    throw new Error(`Updater NSIS customHeader missing custom CHECK_APP_RUNNING prerequisite/state: ${required}`)
  }
}

const customInit = extractMacro('customInit')
for (const required of [
  '${GetParameters} $R0',
  '${GetOptions} $R0 "--updated" $R1',
  'StrCpy $pageAutoUpdaterReplacement "1"',
  'StrCpy $pageAutoUpdateInstallDir "$INSTDIR"',
  'StrCpy $pageAutoUpdateGuardPath "$INSTDIR.__pageauto_update_guard"',
  'StrCpy $pageAutoLegacyPreservePath "$INSTDIR.__pageauto_data_preserve"',
  'StrCpy $pageAutoUpdateConflictPath "$INSTDIR.__pageauto_update_conflict"'
]) {
  if (!customInit.includes(required)) {
    throw new Error(`Updater NSIS customInit missing updater detection/path setup: ${required}`)
  }
}
if (customInit.includes('Rename "$pageAutoUpdateInstallDir\\data"')) {
  throw new Error('Updater customInit must not move runtime data before CHECK_APP_RUNNING succeeds')
}

const customCheckAppRunning = extractMacro('customCheckAppRunning')
for (const required of [
  '!insertmacro IS_POWERSHELL_AVAILABLE',
  '!insertmacro _CHECK_APP_RUNNING',
  '${if} $pageAutoUpdaterReplacement != "1"',
  'Rename "$pageAutoLegacyPreservePath" "$pageAutoUpdateGuardPath"',
  'Rename "$pageAutoUpdateInstallDir\\data" "$pageAutoUpdateGuardPath"',
  'StrCpy $pageAutoUpdateDataPreserved "1"'
]) {
  if (!customCheckAppRunning.includes(required)) {
    throw new Error(`Updater NSIS customCheckAppRunning missing post-close data guard step: ${required}`)
  }
}
const stockCloseIndex = customCheckAppRunning.indexOf('!insertmacro _CHECK_APP_RUNNING')
const preserveLiveDataIndex = customCheckAppRunning.indexOf('Rename "$pageAutoUpdateInstallDir\\data" "$pageAutoUpdateGuardPath"')
if (stockCloseIndex < 0 || preserveLiveDataIndex < stockCloseIndex) {
  throw new Error('Runtime data must be guarded only after electron-builder stock CHECK_APP_RUNNING succeeds')
}

const customUnInstallCheck = extractMacro('customUnInstallCheck')
for (const required of [
  '${if} $pageAutoUpdaterReplacement == "1"',
  '${elseif} $R0 == 2',
  'RMDir /r "$pageAutoUpdateInstallDir"',
  'IfFileExists "$pageAutoUpdateInstallDir\\*.*"',
  'Rename "$pageAutoUpdateGuardPath" "$pageAutoUpdateInstallDir\\data"',
  'SetErrorLevel 2',
  'Quit'
]) {
  if (!customUnInstallCheck.includes(required)) {
    throw new Error(`Updater NSIS customUnInstallCheck missing guarded old-uninstaller recovery: ${required}`)
  }
}
const exitCode2Index = customUnInstallCheck.indexOf('${elseif} $R0 == 2')
const guardedCleanupIndex = customUnInstallCheck.indexOf('RMDir /r "$pageAutoUpdateInstallDir"')
const normalizeResultIndex = customUnInstallCheck.indexOf('StrCpy $R0 "0"')
if (exitCode2Index < 0 || guardedCleanupIndex < exitCode2Index || normalizeResultIndex < guardedCleanupIndex) {
  throw new Error('Old-uninstaller exit code 2 must be normalized only after guarded application-file cleanup succeeds')
}

const customInstall = extractMacro('customInstall')
for (const required of [
  '${if} $pageAutoUpdaterReplacement == "1"',
  '${if} $pageAutoUpdateDataPreserved == "1"',
  'Rename "$pageAutoUpdateGuardPath" "$INSTDIR\\data"',
  'StrCpy $pageAutoUpdateDataPreserved "0"'
]) {
  if (!customInstall.includes(required)) {
    throw new Error(`Updater NSIS customInstall missing post-replacement data restore: ${required}`)
  }
}

const customUnInit = extractMacro('customUnInit')
if (
  !customUnInit.includes('${GetParameters} $R0') ||
  !customUnInit.includes('${GetOptions} $R0 "/S" $R1') ||
  !customUnInit.includes('${GetOptions} $R0 "--updated" $R1') ||
  !customUnInit.includes('SetSilent silent')
) {
  throw new Error(
    'Updater NSIS include must re-detect /S and --updated and force the old assisted uninstaller silent during replacement'
  )
}
if (!customUnInit.includes('${if} ${isUpdated}')) {
  throw new Error('Updater NSIS include must retain the framework isUpdated signal as a fallback')
}
if (installerInclude.includes('SilentUnInstall silent')) {
  throw new Error('Updater fix must not make user-started manual uninstall globally silent')
}

const customRemoveFiles = extractMacro('customRemoveFiles')
if (!customRemoveFiles) {
  throw new Error('Updater installer include must override customRemoveFiles')
}
const preserveDataIndex = customRemoveFiles.indexOf('Rename "$INSTDIR\\data" "$R9"')
const updateBranchIndex = customRemoveFiles.indexOf('${if} ${isUpdated}')
if (preserveDataIndex < 0) {
  throw new Error('Updater installer include must retain direct-uninstaller data preservation')
}
if (updateBranchIndex < 0) {
  throw new Error('Updater installer include must retain the updater-specific atomic cleanup branch')
}
if (preserveDataIndex > updateBranchIndex) {
  throw new Error('Direct-uninstaller data must be preserved before updater/manual cleanup branches diverge')
}
if (!customRemoveFiles.includes('Call un.atomicRMDir')) {
  throw new Error('Updater installer include must retain electron-builder atomic old-install removal')
}
if (!customRemoveFiles.includes('Rename "$R9" "$INSTDIR\\data"')) {
  throw new Error('Updater installer include must retain direct-uninstaller rollback/restore')
}

if (desktopPackage.version !== rootPackage.version || !/^\d+\.\d+\.\d+$/.test(desktopPackage.version)) {
  throw new Error('Updater build version must be matching semver in root and desktop package.json')
}
if (desktopPackage.dependencies?.['electron-updater'] !== '6.8.9') {
  throw new Error('electron-updater must be pinned to stable 6.8.9')
}
if (desktopPackage.scripts?.['package:update'] !== 'npm run build && electron-builder --win nsis --x64 --publish never') {
  throw new Error('Desktop package:update must build NSIS locally with publishing disabled')
}
if (rootPackage.scripts?.['package:update'] !== 'npm run package:update -w @page-auto/desktop') {
  throw new Error('Root package:update script is missing or unexpected')
}

for (const forbidden of ['cloudflarestorage.com', 'bae4e0be81d8f56be5b75402ccd3bb9b', 'accessKeyId', 'secretAccessKey']) {
  if (builderConfig.includes(forbidden) || updaterMain.includes(forbidden) || updaterBridge.includes(forbidden)) {
    throw new Error(`Updater runtime/config must not contain R2 private endpoint or credential material: ${forbidden}`)
  }
}

requireMatch(updaterMain, /autoUpdater\.autoDownload\s*=\s*false/, 'manual download control')
requireMatch(updaterMain, /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/, 'explicit install control')
requireMatch(updaterMain, /autoUpdater\.checkForUpdates\(\)/, 'update check')
requireMatch(updaterMain, /autoUpdater\.downloadUpdate\(\)/, 'update download')
requireMatch(updaterMain, /autoUpdater\.quitAndInstall\(true, true\)/, 'silent restart-and-install flow')
requireMatch(updaterUi, /Kiểm tra cập nhật/, 'check-update button')
requireMatch(updaterUi, /Khởi động lại & cập nhật/, 'restart-and-update button')
requireMatch(updaterBridge, /contextBridge\.exposeInMainWorld\('pageAutoUpdater'/, 'typed preload bridge')

console.log(JSON.stringify({
  ok: true,
  version: desktopPackage.version,
  provider: 'generic',
  feed: publicFeed,
  updater: desktopPackage.dependencies['electron-updater'],
  publishFromBuild: false,
  privateR2CredentialsInApp: false,
  silentInstall: true,
  silentOldUninstallerOnUpdate: true,
  outerUpdateDataGuard: true,
  dataGuardAfterAppCloseCheck: true,
  recoversLegacyPreserveDirectory: true,
  verifiesOldUninstallerExitCode2BeforeContinuing: true,
  restoresGuardedDataAfterReplacement: true,
  restoresGuardedDataOnOldUninstallFailure: true,
  preservesPortableDataOnManualReplacement: true
}, null, 2))
