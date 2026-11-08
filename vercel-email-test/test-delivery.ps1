# Run locally after deploying. The secret is entered privately, not saved in history.
param([Parameter(Mandatory=$true)][string]$DeploymentUrl)
$endpoint = [Uri]($DeploymentUrl.TrimEnd('/') + '/api/test-email')
if ($endpoint.Scheme -ne 'https' -or $endpoint.Host -notmatch '(^|\.)vercel\.app$') {
    throw 'Use your production HTTPS URL ending in .vercel.app.'
}
$secretValue = Read-Host 'Enter EMAIL_TEST_SECRET from your Vercel settings' -AsSecureString
$credential = New-Object System.Net.NetworkCredential('', $secretValue)
try {
    Invoke-RestMethod -Uri $endpoint.AbsoluteUri -Method Post -TimeoutSec 35 `
        -Headers @{ Authorization = 'Bearer ' + $credential.Password } `
        -ContentType 'application/json' -Body '{}'
} finally {
    $credential = $null
    $secretValue.Dispose()
}
