function Probe($url, $method = 'GET', $body = $null, $headers = @{}) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Method = $method
  $req.Timeout = 15000
  foreach ($k in $headers.Keys) { $req.Headers.Add($k, $headers[$k]) }
  if ($body) {
    $req.ContentType = 'application/json'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }
  try {
    $resp = $req.GetResponse()
    $stream = $resp.GetResponseStream()
    $sr = New-Object System.IO.StreamReader($stream)
    $text = $sr.ReadToEnd()
    return @{ Status = [int]$resp.StatusCode; Body = $text; Location = $resp.Headers['Location'] }
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if (-not $r) { return @{ Status = -1; Body = $_.Exception.Message } }
    $stream = $r.GetResponseStream()
    $sr = New-Object System.IO.StreamReader($stream)
    $text = $sr.ReadToEnd()
    return @{ Status = [int]$r.StatusCode; Body = $text; Location = $r.Headers['Location'] }
  }
}

$r1 = Probe 'http://localhost:3000/login'
Write-Host "/login    STATUS=$($r1.Status)  len=$($r1.Body.Length)"

$r2 = Probe 'http://localhost:3000/'
Write-Host "/         STATUS=$($r2.Status)  Location=$($r2.Location)"

$r3 = Probe 'http://localhost:3000/api/auth/register' 'POST' '{"email":"check@test.com","password":"check-pass-123","name":"Check"}'
Write-Host "/register STATUS=$($r3.Status)  body=$($r3.Body.Substring(0, [Math]::Min(200, $r3.Body.Length)))"
