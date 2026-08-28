import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FACEBOOK_CHECKPOINT282_PRESET,
  assertValidFacebookCheckpoint282Preset,
  parseFacebookCheckpoint282Preset
} from './checkpoint282Workbench'

describe('checkpoint282 workbench contract', () => {
  it('falls back to a safe app-local preset when stored data is absent or invalid', () => {
    expect(parseFacebookCheckpoint282Preset(undefined)).toEqual(DEFAULT_FACEBOOK_CHECKPOINT282_PRESET)
    expect(parseFacebookCheckpoint282Preset('{"surface":"bad"}')).toEqual(DEFAULT_FACEBOOK_CHECKPOINT282_PRESET)
  })

  it('keeps only non-secret CP282 preset fields', () => {
    const preset = parseFacebookCheckpoint282Preset(JSON.stringify({
      surface: 'mobile',
      locale: 'en-US',
      sourceImageFolder: 'F:\\Page-Auto\\CP282-Source'
    }))
    expect(preset).toEqual({
      surface: 'mobile',
      locale: 'en-US',
      sourceImageFolder: 'F:\\Page-Auto\\CP282-Source'
    })
  })

  it('rejects oversized or unsupported preset values', () => {
    expect(() => assertValidFacebookCheckpoint282Preset({
      surface: 'mbasic',
      locale: 'xx-XX',
      sourceImageFolder: null
    })).toThrow(/locale/i)
  })
})
