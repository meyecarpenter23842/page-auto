import { describe, expect, it } from 'vitest'
import type { Page, Response } from 'playwright-core'
import {
  MailtoPlusApiDriver,
  parseMailtoPlusDetailPayload,
  parseMailtoPlusListPayload
} from './mailtoPlusApiDriver'

function response(status: number, payload: unknown): Response {
  return {
    status: () => status,
    text: async () => JSON.stringify(payload)
  } as unknown as Response
}

describe('MailtoPlusApiDriver', () => {
  it('parses the public TempMail.Plus list contract without trusting a synthetic timestamp', () => {
    expect(parseMailtoPlusListPayload({
      result: true,
      mail_list: [
        {
          mail_id: 42,
          from_mail: 'account-security-noreply@accountprotection.microsoft.com',
          subject: 'Microsoft account security code',
          time: '10:32'
        }
      ]
    })).toEqual([
      {
        key: 'mailto-plus:42',
        sender: 'account-security-noreply@accountprotection.microsoft.com',
        subject: 'Microsoft account security code',
        preview: 'Microsoft account security code',
        receivedLabel: '10:32',
        receivedAt: null
      }
    ])
  })

  it('verifies exact delivered mailbox before exposing message content', () => {
    const payload = {
      result: true,
      mail_id: 42,
      to: 'Owner@MAILTO.PLUS',
      from_mail: 'account-security-noreply@accountprotection.microsoft.com',
      subject: 'Microsoft account security code',
      text: 'Use security code 123456 to continue.'
    }

    expect(parseMailtoPlusDetailPayload(payload, 'owner@mailto.plus', 'mailto-plus:42')?.bodyText).toContain('123456')
    expect(parseMailtoPlusDetailPayload(payload, 'other@mailto.plus', 'mailto-plus:42')).toBeNull()
    expect(parseMailtoPlusDetailPayload(payload, 'owner@mailto.plus', 'mailto-plus:41')).toBeNull()
  })

  it('uses the public inbox endpoint through the provided Email browser page', async () => {
    const visited: string[] = []
    const page = {
      isClosed: () => false,
      goto: async (url: string) => {
        visited.push(url)
        return response(200, { result: true, mail_list: [] })
      }
    } as unknown as Page
    const driver = new MailtoPlusApiDriver(page)

    const prepared = await driver.ensureMailbox('Owner@MAILTO.PLUS')

    expect(prepared).toEqual({ status: 'ready', activeMailbox: 'owner@mailto.plus' })
    const url = new URL(visited[0] ?? '')
    expect(url.origin).toBe('https://tempmail.plus')
    expect(url.pathname).toBe('/api/mails')
    expect(url.searchParams.get('email')).toBe('owner@mailto.plus')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('epin')).toBe('')
  })

  it('fails closed when the mailbox requires a PIN that PAGE-AUTO does not own canonically', async () => {
    const page = {
      isClosed: () => false,
      goto: async () => response(403, { result: false, message: 'Invalid ePin or PIN protected mailbox' })
    } as unknown as Page
    const driver = new MailtoPlusApiDriver(page)

    expect(await driver.ensureMailbox('owner@mailto.plus')).toMatchObject({ status: 'mailbox_not_found' })
  })
})
