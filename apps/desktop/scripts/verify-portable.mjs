import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const distDirectory = resolve(import.meta.dirname, '../../../dist')
const unpackedDirectory = join(distDirectory, 'win-unpacked')
const executable = join(unpackedDirectory, 'PageAuto.exe')
const appAsar = join(unpackedDirectory, 'resources', 'app.asar')
const appIcon = join(unpackedDirectory, 'resources', 'app-icon.png')

function requireFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`${label} not found: ${filePath}`)
  }
}

if (!existsSync(distDirectory)) {
  throw new Error(`Portable dist directory not found: ${distDirectory}`)
}

requireFile(executable, 'PageAuto.exe')
requireFile(appAsar, 'resources/app.asar')
requireFile(appIcon, 'packaged app icon')

const rootFiles = readdirSync(distDirectory)
const zipFiles = rootFiles.filter((name) => /^PageAuto-\d+\.\d+\.\d+-win-x64\.zip$/i.test(name))
if (zipFiles.length !== 1) {
  throw new Error(`Expected exactly one PageAuto Windows ZIP artifact, found: ${zipFiles.join(', ') || 'none'}`)
}

const forbiddenInstaller = rootFiles.find((name) => /setup|installer|nsis/i.test(name) && /\.exe$/i.test(name))
if (forbiddenInstaller) {
  throw new Error(`Unexpected installer artifact in MVP portable build: ${forbiddenInstaller}`)
}

console.log(JSON.stringify({
  ok: true,
  executable,
  portableFolder: unpackedDirectory,
  zip: join(distDirectory, zipFiles[0])
}, null, 2))
