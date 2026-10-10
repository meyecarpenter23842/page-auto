import { describe, expect, it } from 'vitest'
import { parseGoogleServiceAccountJson } from './googleServiceAccountCredential'

describe('Google service account credential parser', () => {
  it('accepts a Google Cloud service-account JSON and keeps only required fields', () => {
    const credential = parseGoogleServiceAccountJson(JSON.stringify({
      type: 'service_account',
      project_id: 'page-auto-project',
      private_key_id: 'private-id',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      client_email: 'agent-support@page-auto-project.iam.gserviceaccount.com',
      client_id: '123',
      token_uri: 'https://oauth2.googleapis.com/token'
    }), 'project-agent-support.json')

    expect(credential).toEqual({
      type: 'service_account',
      projectId: 'page-auto-project',
      clientEmail: 'agent-support@page-auto-project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      tokenUri: 'https://oauth2.googleapis.com/token',
      sourceFileName: 'project-agent-support.json'
    })
  })

  it('does not mistake an Agent definition for a cloud credential', () => {
    expect(() => parseGoogleServiceAccountJson(JSON.stringify({
      name: 'Facebook Content',
      instructions: 'Write Facebook posts.',
      model: 'gemini'
    }), 'agent.json')).toThrow('cấu hình Agent')
  })

  it('rejects generic JSON instead of reporting a fake Agent parse error', () => {
    expect(() => parseGoogleServiceAccountJson(JSON.stringify({
      project_id: 'x'
    }), 'wrong.json')).toThrow('service-account')
  })
})
