import { describe, expect, it } from 'vitest'
import { ObsignaEngine } from './index'
import { ephemeralSigner } from '../../sphragis/signer'

describe('Obsigna Evidence Subsystem', () => {
  it('mints signed receipts linked to journal records and verifies signatures', () => {
    const signer = ephemeralSigner()
    const engine = new ObsignaEngine(signer)

    const record = {
      actionId: 'act-obs-1',
      agentId: 'captain',
      tool: 'write_file',
      timestamp: new Date().toISOString(),
      argsDigest: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      status: 'executed' as const,
      resultDigest: 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f'
    }

    const receipt = engine.mintReceipt(record)
    expect(receipt.actionId).toBe('act-obs-1')
    expect(receipt.signature).toBeDefined()
    expect(receipt.keyId).toBe(signer.keyId)

    const isValid = ObsignaEngine.verifyReceipt(receipt, signer.publicKeyHex)
    expect(isValid).toBe(true)
  })

  it('detects tampering in receipt data', () => {
    const signer = ephemeralSigner()
    const engine = new ObsignaEngine(signer)

    const record = {
      actionId: 'act-obs-2',
      agentId: 'captain',
      tool: 'delete_file',
      timestamp: new Date().toISOString(),
      argsDigest: '1111111111111111111111111111111111111111111111111111111111111111',
      status: 'executed' as const
    }

    const receipt = engine.mintReceipt(record)
    // Tamper with receipt
    const tampered = { ...receipt, tool: 'tampered_tool' }
    const isValid = ObsignaEngine.verifyReceipt(tampered, signer.publicKeyHex)
    expect(isValid).toBe(false)
  })

  it('validates unbroken chain of receipts and catches broken links', () => {
    const signer = ephemeralSigner()
    const engine = new ObsignaEngine(signer)

    const r1 = engine.mintReceipt({
      actionId: 'act-chain-1',
      agentId: 'captain',
      tool: 'tool_1',
      timestamp: new Date().toISOString(),
      argsDigest: '0001',
      status: 'executed' as const
    })

    const r2 = engine.mintReceipt({
      actionId: 'act-chain-2',
      agentId: 'captain',
      tool: 'tool_2',
      timestamp: new Date().toISOString(),
      argsDigest: '0002',
      status: 'executed' as const
    })

    const chainResult = ObsignaEngine.verifyChain([r1, r2], signer.publicKeyHex)
    expect(chainResult.valid).toBe(true)

    // Tamper with chaining link
    const brokenR2 = { ...r2, prevHash: 'broken_hash' }
    const brokenResult = ObsignaEngine.verifyChain([r1, brokenR2], signer.publicKeyHex)
    expect(brokenResult.valid).toBe(false)
  })
})
