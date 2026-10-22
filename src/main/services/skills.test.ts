import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown } from './skills'

describe('skill markdown parsing', () => {
  it('reads frontmatter name and description', () => {
    const skill = parseSkillMarkdown(
      [
        '---',
        'name: release-notes',
        'description: Turn a pile of commits into clean release notes.',
        '---',
        '',
        '# Release notes',
        '',
        'Group changes by type.'
      ].join('\n')
    )
    expect(skill.name).toBe('release-notes')
    expect(skill.description).toBe('Turn a pile of commits into clean release notes.')
    expect(skill.body).toContain('Group changes by type.')
  })

  it('falls back to the first heading and paragraph', () => {
    const skill = parseSkillMarkdown(
      ['# Invoice triage', '', 'Sort incoming invoices by urgency.', '', 'Then file them.'].join('\n')
    )
    expect(skill.name).toBe('Invoice triage')
    expect(skill.description).toBe('Sort incoming invoices by urgency.')
    expect(skill.body).toContain('Then file them.')
  })

  it('quotes are stripped from frontmatter values', () => {
    const skill = parseSkillMarkdown(
      ['---', 'name: "Weekly report"', "description: 'Draft the Friday report.'", '---', 'Body'].join(
        '\n'
      )
    )
    expect(skill.name).toBe('Weekly report')
    expect(skill.description).toBe('Draft the Friday report.')
  })

  it('survives a bundle with no headings or frontmatter', () => {
    const skill = parseSkillMarkdown('Just a plain instruction with no structure at all.')
    expect(skill.name).toBe('Skill')
    expect(skill.description).toBe('Just a plain instruction with no structure at all.')
    expect(skill.body).toBe('Just a plain instruction with no structure at all.')
  })
})
