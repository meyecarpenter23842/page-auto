import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const appDirectory = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDirectory, '../..')
const distDirectory = resolve(repositoryRoot, 'dist')
const desktopPackage = JSON.parse(readFileSync(resolve(appDirectory, 'package.json'), 'utf8'))
const version = desktopPackage.version
const installerName = `PageAuto-Setup-${version}.exe`
const installer = join(distDirectory, installerName)
const blockmap = `${installer}.blockmap`
const latestYml = join(distDirectory, 'latest.yml')
const appUpdateYml = join(distDirectory, 'win-unpacked', 'resources', 'app-update.yml')
const publicFeed = 'https://pub-4e0416c66f7b4c7e9542bb6296775673.r2.dev'

function requireFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    throw new Error(`${label} not found or empty: ${filePath}`)
  }
}

requireFile(installer, 'PageAuto installer')
requireFile(blockmap, 'PageAuto installer blockmap')
requireFile(latestYml, 'latest.yml')
requireFile(appUpdateYml, 'packaged app-update.yml')

const latest = readFileSync(latestYml, 'utf8')
const appUpdate = readFileSync(appUpdateYml, 'utf8')
const installerSha512 = createHash('sha512').update(readFileSync(installer)).digest('base64')

if (!new RegExp(`^version:\\s*${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(latest)) {
  throw new Error(`latest.yml version does not match ${version}`)
}
if (!latest.includes(installerName)) {
  throw new Error(`latest.yml does not reference ${installerName}`)
}
if (!latest.includes(installerSha512)) {
  throw new Error('latest.yml SHA512 does not match the installer bytes')
}
if (!/^provider:\s*generic\s*$/m.test(appUpdate)) {
  throw new Error('app-update.yml is not configured for generic provider')
}
if (!appUpdate.includes(publicFeed)) {
  throw new Error('app-update.yml does not contain the expected public R2 feed URL')
}
if (/cloudflarestorage\.com|bae4e0be81d8f56be5b75402ccd3bb9b|accessKeyId|secretAccessKey/i.test(appUpdate)) {
  throw new Error('app-update.yml contains private R2 endpoint or credential material')
}

console.log(JSON.stringify({
  ok: true,
  version,
  feed: publicFeed,
  artifacts: [installer, blockmap, latestYml],
  uploadOrder: [installerName, `${installerName}.blockmap`, 'latest.yml'],
  publishLatestYmlLast: true
}, null, 2))
