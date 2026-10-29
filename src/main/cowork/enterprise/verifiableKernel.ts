import crypto from 'node:crypto'
import type { ToolAttestedProof } from './types'

export class VerifiableKernel {
  private secretKey: string;
  private attestedProofs: Map<string, ToolAttestedProof> = new Map();

  constructor(secretKey?: string) {
    this.secretKey = secretKey || crypto.randomBytes(32).toString('hex');
  }

  public attestToolExecution(
    toolName: string,
    inputPayload: Record<string, unknown>,
    outputPayload: Record<string, unknown>
  ): ToolAttestedProof {
    const proofId = `proof_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const timestamp = Date.now();

    const inputDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify(inputPayload, Object.keys(inputPayload).sort()))
      .digest('hex');

    const outputDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify(outputPayload, Object.keys(outputPayload).sort()))
      .digest('hex');

    const signaturePayload = `${proofId}:${toolName}:${inputDigest}:${outputDigest}:${timestamp}`;
    const attestationSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(signaturePayload)
      .digest('hex');

    const proof: ToolAttestedProof = {
      proofId,
      toolName,
      inputDigest,
      outputDigest,
      timestamp,
      attestationSignature,
      verified: true
    };

    this.attestedProofs.set(proofId, proof);
    return proof;
  }

  public verifyProof(proof: ToolAttestedProof): boolean {
    const signaturePayload = `${proof.proofId}:${proof.toolName}:${proof.inputDigest}:${proof.outputDigest}:${proof.timestamp}`;
    const expected = crypto
      .createHmac('sha256', this.secretKey)
      .update(signaturePayload)
      .digest('hex');

    return proof.attestationSignature === expected;
  }

  public listProofs(): ToolAttestedProof[] {
    return Array.from(this.attestedProofs.values());
  }

  public getProof(proofId: string): ToolAttestedProof | undefined {
    return this.attestedProofs.get(proofId);
  }
}
