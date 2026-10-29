# Install the SelfImpulse Code Signing Certificate to the local trust store
$certPath = Join-Path $PSScriptRoot "..\resources\selfimpulse.pfx"
$password = ConvertTo-SecureString -String "SelfImpulse2026" -Force -AsPlainText

if (-not (Test-Path $certPath)) {
    Write-Error "Certificate not found at $certPath"
    exit 1
}

Write-Host "Installing SelfImpulse certificate into Trusted Root and Trusted Publishers..."
Import-PfxCertificate -FilePath $certPath -CertStoreLocation "Cert:\CurrentUser\Root" -Password $password | Out-Null
Import-PfxCertificate -FilePath $certPath -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" -Password $password | Out-Null

Write-Host "Certificate installed and trusted. SelfImpulse installers will run cleanly without warnings."
