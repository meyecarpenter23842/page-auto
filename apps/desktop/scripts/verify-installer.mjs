import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const appDirectory = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDirectory, '../..')
const distDirectory = resolve(repositoryRoot, 'dist')
const desktopPackage = JSON.parse(readFileSync(resolve(appDirectory, 'package.json'), 'utf8'))
const installer = join(distDirectory, `PageAuto-Setup-${desktopPackage.version}.exe`)
const unpackedDirectory = join(distDirectory, 'win-unpacked')

function requireFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`)
  }
  if (statSync(filePath).size === 0) {
    throw new Error(`${label} is empty: ${filePath}`)
  }
}

requireFile(installer, 'PageAuto NSIS installer')
requireFile(join(unpackedDirectory, 'PageAuto.exe'), 'packaged PageAuto.exe')
requireFile(join(unpackedDirectory, 'resources', 'app.asar'), 'resources/app.asar')

for (const forbiddenPath of [
  join(unpackedDirectory, 'data'),
  join(unpackedDirectory, 'browser-profiles'),
  join(unpackedDirectory, 'resources', 'data'),
  join(unpackedDirectory, 'resources', 'browser-profiles')
]) {
  if (existsSync(forbiddenPath)) {
    throw new Error(`Runtime data must not be packaged with the installer: ${forbiddenPath}`)
  }
}

console.log(JSON.stringify({
  ok: true,
  installer,
  version: desktopPackage.version,
  runtimeDataPackaged: false
}, null, 2))
