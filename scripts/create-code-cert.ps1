# Generate a Self-Signed Code Signing Certificate for SelfImpulse
$certPath = Join-Path $PSScriptRoot "..\resources\selfimpulse.pfx"
$password = ConvertTo-SecureString -String "SelfImpulse2026" -Force -AsPlainText

Write-Host "Generating code-signing certificate for SelfImpulse..."
$cert = New-SelfSignedCertificate -Subject "CN=SelfImpulse, O=SelfImpulse Desktop, C=US" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -Type CodeSigningCert `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(5)

Write-Host "Exporting PFX to $certPath..."
Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $password | Out-Null
Write-Host "Certificate generated successfully at $certPath"
