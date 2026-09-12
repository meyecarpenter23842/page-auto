import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
}

function importSources(fileSource: string): string[] {
  return [...fileSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
}

function expectNoConcreteMailboxImports(fileName: string): void {
  const imports = importSources(source(fileName))
  const forbidden = [
    './inboxesProvider',
    './inboxesPlaywrightDriver',
    './inboxesMailboxRuntime',
    './fviaInboxesProvider',
    './fviaInboxesPlaywrightDriver',
    './fviaInboxesMailboxRuntime',
    './mailtoPlusProvider',
    './mailtoPlusApiDriver',
    './mailtoPlusMailboxRuntime',
    './microsoftMailboxProvider',
    './microsoftMailboxRuntime',
    './browserMailProviderFactory'
  ]

  for (const dependency of forbidden) {
    expect(imports, `${fileName} must not import concrete mailbox module ${dependency}`).not.toContain(dependency)
  }
}

describe('Email mailbox architecture guard', () => {
  it('keeps the generic mailbox coordinator free of concrete provider/runtime ownership', () => {
    const coordinator = source('mailboxCodeService.ts')
    expectNoConcreteMailboxImports('mailboxCodeService.ts')
    expect(importSources(coordinator)).not.toContain('./emailPageRegistry')
    expect(importSources(coordinator)).not.toContain('./mailboxProviderBrowserRuntime')
    expect(coordinator).not.toMatch(/\bcreate(?:Inboxes|FviaInboxes|MailtoPlus)MailboxRuntime\b/)
  })

  it('keeps the router provider-neutral', () => {
    expectNoConcreteMailboxImports('mailboxProviderRouter.ts')
    const imports = importSources(source('mailboxProviderRouter.ts'))
    expect(imports).not.toContain('./mailboxCodeService')
    expect(imports).not.toContain('./mailboxProviderComposition')
  })

  it('keeps Microsoft recovery behind the typed router/composition boundary', () => {
    expectNoConcreteMailboxImports('microsoftRecoveryChallenge.ts')
    const imports = importSources(source('microsoftRecoveryChallenge.ts'))
    expect(imports).not.toContain('./mailboxCodeService')
    expect(imports).not.toContain('./mailProviderRegistry')
  })

  it('keeps concrete provider imports confined to the composition/provider side', () => {
    const compositionImports = importSources(source('mailboxProviderComposition.ts'))
    expect(compositionImports).toContain('./inboxesMailboxRuntime')
    expect(compositionImports).toContain('./fviaInboxesMailboxRuntime')
    expect(compositionImports).toContain('./mailtoPlusMailboxRuntime')
    expect(compositionImports).toContain('./mailboxCodeService')
  })
})
