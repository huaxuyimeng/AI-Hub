$client = New-Object System.Net.WebClient
$body = $client.DownloadString('http://localhost:3000/')
Write-Host 'len=' $body.Length
if ($body.Length -lt 500) { Write-Host 'body:' $body } else { Write-Host 'snippet:' $body.Substring(0, 300) }