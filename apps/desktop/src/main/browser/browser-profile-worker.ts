import { chromium } from 'playwright-core'

async function run(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (!profileDirectory) {
    throw new Error('Missing browser profile directory.')
  }

  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'chrome',
    headless: false,
    viewport: null
  })

  if (context.pages().length === 0) {
    await context.newPage()
  }

  await new Promise<void>((resolve) => {
    context.once('close', () => resolve())
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO browser worker]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
