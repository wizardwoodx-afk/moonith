import { describe, expect, it } from 'vitest'
import { impulseSkillRegistry } from './lobeRegistry'

describe('ImpulseSkillRegistry & LobeChat Skills Index', () => {
  it('searches skills across the local registry', () => {
    const results = impulseSkillRegistry.search('design')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].category).toBe('design')

    const creative = impulseSkillRegistry.search('', 'creative')
    expect(creative.some((s) => s.identifier === 'impulse_svg_canvas_renderer')).toBe(true)
  })

  it('translates registered skills into ProviderToolSpec for LLMs', () => {
    const spec = impulseSkillRegistry.toProviderToolSpec('impulse_multimodal_document_parser')
    expect(spec).not.toBeNull()
    expect(spec?.name).toBe('impulse_multimodal_document_parser')
    expect(spec?.parameters.type).toBe('object')
  })
})
