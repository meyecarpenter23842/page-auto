import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { BrowserSettings } from '../../shared/appSettings'
import type {
  BrowserExecutableResult,
  BrowserTestResult,
  BrowserTestWorkerMessage,
  BrowserTestWorkerRequestMessage
} from '../../shared/browserSettings'

function environmentValue(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (value?.trim()) return value
  }
  return undefined
}

export function chromeExecutableCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [
    environmentValue(env, ['PROGRAMFILES', 'ProgramFiles']),
    environmentValue(env, ['PROGRAMFILES(X86)', 'ProgramFiles(x86)']),
    environmentValue(env, ['LOCALAPPDATA', 'LocalAppData'])
  ].filter((value): value is string => Boolean(value))

  return [...new Set(roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')))]
}

export class BrowserEngineService {
  private readonly workers = new Set<UtilityProcess>()

  async probeExecutable(executablePath: string): Promise<BrowserExecutableResult> {
    const normalized = executablePath.trim()
    if (!normalized || !existsSync(normalized)) {
      return {
        status: 'invalid',
        executablePath: normalized || null,
        version: null,
        message: 'Không tìm thấy file Chrome tại đường dẫn đã chọn.'
      }
    }

    // Important: probing Settings must never execute chrome.exe. On Windows, launching
    // chrome.exe with --version may still open the GUI. Version is read only by the
    // explicit browser test worker, where launching Chrome is a user-requested action.
    return {
      status: 'found',
      executablePath: normalized,
      version: null,
      message: 'Đã tìm thấy file Chrome.'
    }
  }

  async detectChrome(): Promise<BrowserExecutableResult> {
    for (const candidate of chromeExecutableCandidates()) {
      if (!existsSync(candidate)) continue
      return this.probeExecutable(candidate)
    }
    return {
      status: 'not_found',
      executablePath: null,
      version: null,
      message: 'Chưa tìm thấy Chrome. Anh có thể chọn file chrome.exe thủ công.'
    }
  }

  async testBrowser(settings: BrowserSettings): Promise<BrowserTestResult> {
    let executablePath = settings.executablePath?.trim() || null

    if (executablePath) {
      const probed = await this.probeExecutable(executablePath)
      if (probed.status !== 'found') {
        return {
          status: 'failed',
          code: 'invalid_executable',
          executablePath,
          version: null,
          message: probed.message
        }
      }
    } else {
      const detected = await this.detectChrome()
      if (detected.status !== 'found' || !detected.executablePath) {
        return {
          status: 'failed',
          code: 'not_found',
          executablePath: null,
          version: null,
          message: detected.message
        }
      }
      executablePath = detected.executablePath
    }

    const effectiveSettings: BrowserSettings = { ...settings, executablePath }

    return new Promise<BrowserTestResult>((resolve) => {
      const worker = utilityProcess.fork(join(__dirname, 'browser-test-worker.js'), [], {
        serviceName: 'PAGE-AUTO browser test'
      })
      this.workers.add(worker)

      let settled = false
      let started = false
      const finish = (result: BrowserTestResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.workers.delete(worker)
        worker.kill()
        resolve({
          ...result,
          executablePath,
          version: result.version ?? null
        })
      }

      const timeoutMs = settings.startupDelayMs + settings.startupTimeoutMs + 8_000
      const timer = setTimeout(() => {
        finish({
          status: 'failed',
          code: 'timeout',
          executablePath,
          version: null,
          message: 'Chrome mở quá thời gian chờ cho phép.'
        })
      }, timeoutMs)

      worker.on('message', (raw: unknown) => {
        const message = raw as BrowserTestWorkerMessage
        if (message.type === 'ready' && !started) {
          started = true
          const request: BrowserTestWorkerRequestMessage = { type: 'test', settings: effectiveSettings }
          worker.postMessage(request)
          return
        }
        if (message.type === 'result') finish(message.result)
      })

      worker.once('exit', (code) => {
        if (!settled) {
          finish({
            status: 'failed',
            code: 'worker_crashed',
            executablePath,
            version: null,
            message: `Browser worker đã dừng trước khi kiểm tra xong (code ${code}).`
          })
        }
      })
    })
  }

  closeAll(): void {
    for (const worker of this.workers) worker.kill()
    this.workers.clear()
  }
}
