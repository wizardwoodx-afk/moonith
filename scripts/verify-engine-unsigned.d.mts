/**
 * Types for the packaging guard. The script itself is plain ESM so that
 * electron-builder can load it directly.
 */
export function certificateTable(
  buffer: Buffer
): { offset: number; size: number } | null
export function embeddedCertificateSubjects(buffer: Buffer): string[]
export function carriesSelfImpulseCertificate(buffer: Buffer): string[]
export function sha256(buffer: Buffer): string
export function afterPack(context: {
  appOutDir: string
  packager: { info: { projectDir: string } }
}): Promise<void>
export default afterPack
