import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('EmailBrowserManager credential wiring', () => {
  const managerSource = readFileSync(new URL('./emailBrowserManager.ts', import.meta.url), 'utf8')
  const workerSource = readFileSync(new URL('./email-browser-worker.ts', import.meta.url), 'utf8')
  const repositorySource = readFileSync(new URL('../database/accountRepository.ts', import.meta.url), 'utf8')
  const serviceSource = readFileSync(new URL('./hotmailService.ts', import.meta.url), 'utf8')

  it('routes canonical PassEmail through repository/service/manager and never the Facebook password field', () => {
    expect(repositorySource).toMatch(/email_password\s+AS\s+emailPassword/)
    expect(repositorySource).toMatch(/emailPassword:\s*row\.emailPassword/)
    expect(serviceSource).toMatch(/this\.accounts\.getById\(accountId\)/)
    expect(managerSource).toMatch(/buildEmailLoginPayload\(account\)/)
    expect(managerSource).toMatch(/currentPassword:\s*account\.emailPassword/)
    expect(managerSource).not.toMatch(/loginPassword:\s*account\.password\b/)
    expect(managerSource).not.toMatch(/currentPassword:\s*account\.password\b/)
  })

  it('posts a fresh command per action and keys live workers by account id/profile UID', () => {
    expect(managerSource).toMatch(/workers\s*=\s*new Map<number, WorkerEntry>\(\)/)
    expect(managerSource).toMatch(/inspectEmailProfile\(profileRoot, account\.uid\)/)
    expect(managerSource).toMatch(/entry\.process\.postMessage\(command\)/)
  })

  it('fills the Microsoft password from the current worker command and verifies the DOM value before submit', () => {
    expect(workerSource).toMatch(/const loginPassword = command\.loginPassword \?\? ''/)
    expect(workerSource).toMatch(/await password\.fill\(loginPassword\)/)
    expect(workerSource).toMatch(/await password\.inputValue\(\)/)
    expect(workerSource).toMatch(/emailCredentialValueMatches\(loginPassword, filledPassword\)/)
    expect(workerSource).not.toMatch(/account\.password/)
  })
})
