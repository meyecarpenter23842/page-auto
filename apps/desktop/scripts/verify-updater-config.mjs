import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appDirectory = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDirectory, '../..')
const builderConfig = readFileSync(resolve(appDirectory, 'electron-builder.yml'), 'utf8')
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

if (desktopPackage.version !== '1.0.1' || rootPackage.version !== desktopPackage.version) {
  throw new Error('Updater live-test version must be 1.0.1 and match root package version')
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
  silentInstall: true
}, null, 2))
