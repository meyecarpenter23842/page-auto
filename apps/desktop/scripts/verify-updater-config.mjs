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

requireMatch(builderConfig, /^\s*provider:\s*generic\s*$/m, 'generic provider')
requireMatch(builderConfig, new RegExp(`^\\s*url:\\s*${publicFeed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'), 'public R2 feed URL')
requireMatch(builderConfig, /^\s*channel:\s*latest\s*$/m, 'latest channel')
requireMatch(builderConfig, /^\s*include:\s*resources\/installer\.nsh\s*$/m, 'NSIS updater include')

const customUnInit = installerInclude.match(/!macro customUnInit([\s\S]*?)!macroend/)?.[1] ?? ''
if (
  !customUnInit.includes('${GetParameters} $R0') ||
  !customUnInit.includes('${GetOptions} $R0 "/S" $R1') ||
  !customUnInit.includes('${GetOptions} $R0 "--updated" $R1') ||
  !customUnInit.includes('${GetOptions} $R0 "/KEEP_APP_DATA" $R1') ||
  !customUnInit.includes('SetSilent silent') ||
  !customUnInit.includes('SetSilent normal')
) {
  throw new Error(
    'Updater NSIS include must keep update invocations silent while restoring assisted UI for manual uninstall'
  )
}
if (!customUnInit.includes('${if} ${isUpdated}')) {
  throw new Error('Updater NSIS include must retain the framework isUpdated signal as a fallback')
}
requireMatch(
  installerInclude,
  /!ifdef BUILD_UNINSTALLER\s+SilentUnInstall silent\s+!endif/m,
  'early silent-uninstaller default for updater startup'
)

const customRemoveFiles = installerInclude.match(/!macro customRemoveFiles([\s\S]*?)!macroend/)?.[1] ?? ''
if (!customRemoveFiles) {
  throw new Error('Updater installer include must override customRemoveFiles')
}
requireMatch(installerInclude, /Function un\.pageAutoAtomicRMDir/, 'PageAuto program-only atomic removal helper')
requireMatch(installerInclude, /StrCmp \$R2 "data" pageauto_continue/, 'portable data root skip guard')
requireMatch(installerInclude, /StrCmp \$R4 "data_" pageauto_continue/, 'portable data recovery snapshot skip guard')
if (!customRemoveFiles.includes('Call un.pageAutoAtomicRMDir')) {
  throw new Error('Updater installer include must remove only program-owned files through the PageAuto atomic helper')
}
if (!customRemoveFiles.includes('Call un.restoreFiles')) {
  throw new Error('Updater installer include must retain rollback when a program file is busy')
}
for (const forbidden of [
  'Rename "$INSTDIR\\data"',
  'Rename "$R9" "$INSTDIR\\data"',
  '.__pageauto_data_preserve',
  'RMDir /r "$INSTDIR"'
]) {
  if (installerInclude.includes(forbidden)) {
    throw new Error(`Updater/uninstaller must never move or recursively delete portable runtime data: ${forbidden}`)
  }
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
  manualUninstallRemainsInteractive: true,
  portableDataNeverMovedDuringReplacement: true,
  portableDataRecoverySnapshotsNeverMovedDuringReplacement: true
}, null, 2))
