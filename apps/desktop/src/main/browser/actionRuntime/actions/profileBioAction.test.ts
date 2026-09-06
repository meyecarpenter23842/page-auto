import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./profileBioAction.ts', import.meta.url), 'utf8')

describe('Profile Bio atomic action', () => {
  it('uses only the live-audited empty-state contract before mutation', () => {
    expect(source).toContain('https://www.facebook.com/me?sk=about_details')
    expect(source).toContain('Details about you')
    expect(source).toContain('Write some details about yourself')
    expect(source).toContain("page.locator('textarea:visible')")
    expect(source).toContain('SAVE_NAME')
    expect(source).toContain('CANCEL_NAME')
    expect(source).not.toContain('.nth(')
    expect(source).not.toMatch(/getByRole\([^\n]+(?:Edit|Sửa)/i)
    expect(source).toContain('profile_bio_existing_edit_audit_required')
  })

  it('fills, checks staged text, saves once, revisits and requires read-back verification', () => {
    expect(source).toContain('await editor.textarea.fill(target)')
    expect(source).toContain('await editor.textarea.inputValue()')
    expect(source).toContain('await editor.save.click()')
    expect(source.match(/await editor\.save\.click\(\)/g)).toHaveLength(1)
    expect(source).toContain('renderedBioInAuditedSection(page, target)')
    expect(source).toContain('ACTION_VERIFICATION_UNCERTAIN_CODE')
    expect(source).toContain('không retry tự động')
  })

  it('honors pause/stop before Save but always verifies after a consequential Save', () => {
    expect(source).toContain('waitForControl(context)')
    expect(source).toContain('From this point a consequential Save may already have committed')
    const saveIndex = source.indexOf('await editor.save.click()')
    const verifyIndex = source.indexOf('renderedBioInAuditedSection(page, target)', saveIndex)
    expect(saveIndex).toBeGreaterThan(0)
    expect(verifyIndex).toBeGreaterThan(saveIndex)
  })
})
