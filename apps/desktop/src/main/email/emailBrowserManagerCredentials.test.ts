import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('EmailBrowserManager credential wiring', () => {
  const managerSource = readFileSync(new URL('./emailBrowserManager.ts', import.meta.url), 'utf8')
  const workerSource = readFileSync(new URL('./email-browser-worker.ts', import.meta.url), 'utf8')
  const authControllerSource = readFileSync(new URL('./microsoftAuthV2WorkerController.ts', import.meta.url), 'utf8')
  const commonHandlersSource = readFileSync(new URL('./microsoftCommonAuthHandlers.ts', import.meta.url), 'utf8')
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

  it('delegates Microsoft auth to V2 and verifies the command PassEmail DOM value before submit', () => {
    expect(workerSource).toMatch(/runMicrosoftAuthV2WorkerController\(page, command/)
    expect(authControllerSource).toMatch(/new MicrosoftCommonAuthHandlers\(credentials\)/)
    expect(authControllerSource).toMatch(/createPlaywrightMicrosoftCommonAuthUi\(\s*page,\s*credentials,/)

    expect(commonHandlersSource).toMatch(/const password = this\.credentials\.loginPassword \?\? ''/)
    expect(commonHandlersSource).toMatch(/await password\.fill\(value\)/)
    expect(commonHandlersSource).toMatch(/const filledPassword = await password\.inputValue\(\)/)
    expect(commonHandlersSource).toMatch(/emailCredentialValueMatches\(password, filledPassword\)/)

    const verifyIndex = commonHandlersSource.indexOf('emailCredentialValueMatches(password, filledPassword)')
    const submitIndex = commonHandlersSource.indexOf('ui.clickPrimarySubmit()', verifyIndex)
    expect(verifyIndex).toBeGreaterThanOrEqual(0)
    expect(submitIndex).toBeGreaterThan(verifyIndex)

    expect(workerSource).not.toMatch(/account\.password/)
    expect(commonHandlersSource).not.toMatch(/account\.password/)
  })
})
