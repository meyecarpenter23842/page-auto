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
requireMatch(builderConfig, /^\s*include:\s*resources\/installer\.nsh\s*$/m, 'NSIS data-preservation include')

const customUnInit = installerInclude.match(/!macro customUnInit([\s\S]*?)!macroend/)?.[1] ?? ''
if (!customUnInit.includes('${if} ${isUpdated}') || !customUnInit.includes('SetSilent silent')) {
  throw new Error('Updater NSIS include must force the old assisted uninstaller silent only during update replacement')
}
if (installerInclude.includes('SilentUnInstall silent')) {
  throw new Error('Updater fix must not make user-started manual uninstall globally silent')
}

const customRemoveFiles = installerInclude.match(/!macro customRemoveFiles([\s\S]*?)!macroend/)?.[1] ?? ''
if (!customRemoveFiles) {
  throw new Error('Updater installer include must override customRemoveFiles')
}
const preserveDataIndex = customRemoveFiles.indexOf('Rename "$INSTDIR\\data" "$R9"')
const updateBranchIndex = customRemoveFiles.indexOf('${if} ${isUpdated}')
if (preserveDataIndex < 0) {
  throw new Error('Updater installer include must move the portable data directory out before replacing app files')
}
if (updateBranchIndex < 0) {
  throw new Error('Updater installer include must retain the updater-specific atomic cleanup branch')
}
if (preserveDataIndex > updateBranchIndex) {
  throw new Error('Portable data must be preserved before updater/manual replacement cleanup branches diverge')
}
if (!customRemoveFiles.includes('Call un.atomicRMDir')) {
  throw new Error('Updater installer include must retain electron-builder atomic old-install removal')
}
if (!customRemoveFiles.includes('Rename "$R9" "$INSTDIR\\data"')) {
  throw new Error('Updater installer include must restore the portable data directory before new files are installed')
}
requireMatch(
  customRemoveFiles,
  /\$\{endif\}\s+CreateDirectory "\$INSTDIR"\s+\$\{if\} \$R8 == "1"/m,
  'common install-directory recreation before preserved data restore'
)

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
  preservesPortableDataOnUpdate: true,
  preservesPortableDataOnManualReplacement: true
}, null, 2))
