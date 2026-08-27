import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const tauriConfPath = resolve(root, 'src-tauri/tauri.conf.json')
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
tauriConf.version = pkg.version
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n')

// Keep the crate version in sync — sentry::release_name!() derives the
// Sentry release from CARGO_PKG_VERSION, so a stale Cargo.toml would tag
// crashes with the wrong version.
const cargoTomlPath = resolve(root, 'src-tauri/Cargo.toml')
const cargoToml = readFileSync(cargoTomlPath, 'utf8')
writeFileSync(cargoTomlPath, cargoToml.replace(/^version = ".*"$/m, `version = "${pkg.version}"`))

const cargoLockPath = resolve(root, 'src-tauri/Cargo.lock')
const cargoLock = readFileSync(cargoLockPath, 'utf8')
writeFileSync(
  cargoLockPath,
  cargoLock.replace(
    /(\[\[package\]\]\nname = "scoutable"\nversion = ")[^"]+(")/,
    `$1${pkg.version}$2`,
  ),
)

console.log(`Bumped tauri.conf.json, Cargo.toml and Cargo.lock to ${pkg.version}`)
