import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appDirectory = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDirectory, '../..')
const builderConfig = readFileSync(resolve(appDirectory, 'electron-builder.yml'), 'utf8')
const desktopPackage = JSON.parse(readFileSync(resolve(appDirectory, 'package.json'), 'utf8'))
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))

function requireMatch(pattern, label) {
  if (!pattern.test(builderConfig)) {
    throw new Error(`Installer config missing ${label}`)
  }
}

requireMatch(/^\s*-\s+target:\s*nsis\s*$/m, 'Windows NSIS target')
requireMatch(/^\s*oneClick:\s*false\s*$/m, 'assisted installer mode')
requireMatch(/^\s*allowToChangeInstallationDirectory:\s*true\s*$/m, 'installation-directory chooser')
requireMatch(/^\s*artifactName:\s*PageAuto-Setup-\$\{version\}\.\$\{ext\}\s*$/m, 'stable installer artifact name')
requireMatch(/^\s*createDesktopShortcut:\s*true\s*$/m, 'desktop shortcut')
requireMatch(/^\s*createStartMenuShortcut:\s*true\s*$/m, 'Start Menu shortcut')

if (desktopPackage.scripts?.['package:installer'] !== 'npm run build && electron-builder --win nsis --x64 --publish never') {
  throw new Error('Desktop package:installer script must build NSIS locally with publishing disabled')
}
if (rootPackage.scripts?.['package:installer'] !== 'npm run package:installer -w @page-auto/desktop') {
  throw new Error('Root package:installer script is missing or unexpected')
}
if (/^\s*-\s+(?:from:\s*)?(?:data|browser-profiles)(?:\/|\\|\s|$)/mi.test(builderConfig)) {
  throw new Error('Runtime data must not be packaged into the installer')
}

console.log(JSON.stringify({
  ok: true,
  target: 'nsis',
  assisted: true,
  installationDirectoryChooser: true,
  publish: false
}, null, 2))
