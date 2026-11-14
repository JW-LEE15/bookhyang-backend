# test-nickname.ps1
# Checks PATCH /api/auth/nickname against your LOCAL dev server (npm run dev) with one test account.
#   - no token -> 401, invalid nicknames -> 400
#   - a valid change -> 200, and an OLD comment of the same user shows the NEW nickname
#     (comments read nicknames through a users join)
#   - the nickname is restored at the end and the test comment is deleted
# Tokens and passwords are never printed.
#
# Usage (Windows PowerShell 5.1 or PowerShell 7):
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-nickname.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-nickname.ps1 -BaseUrl http://localhost:5000/api
#
# Note: the nickname limiter allows 10 requests per hour per user. One run uses 4 of them
# (the 401 request is not counted).
# This script is ASCII only on purpose (Windows PowerShell 5.1 reads files without BOM as ANSI).

param(
  [string]$BaseUrl = 'http://localhost:5000/api',
  [string]$Isbn = '9790000000019'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')

$script:Passed = 0
$script:Failed = 0

function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Sends a request and returns @{ Status = <int>; Body = <object or $null> } for any HTTP status.
function Invoke-Api([string]$Method, [string]$Path, [string]$Token, $Body) {
  $headers = @{ 'ngrok-skip-browser-warning' = 'true' }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{
    Uri             = "$BaseUrl$Path"
    Method          = $Method
    Headers         = $headers
    UseBasicParsing = $true
    ContentType     = 'application/json; charset=utf-8'
  }
  if ($null -ne $Body) {
    $params['Body'] = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
  }
  try {
    $resp = Invoke-WebRequest @params
    $status = [int]$resp.StatusCode
    $text = $resp.Content
  } catch {
    if ($null -eq $_.Exception.Response) { throw "Cannot reach $BaseUrl ($($_.Exception.Message))" }
    $status = [int]$_.Exception.Response.StatusCode
    $text = $_.ErrorDetails.Message
  }
  $parsed = $null
  if ($text) { try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null } }
  return @{ Status = $status; Body = $parsed }
}

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { $script:Passed++; Write-Host "PASS  $Name" -ForegroundColor Green }
  else { $script:Failed++; Write-Host "FAIL  $Name $Detail" -ForegroundColor Red }
}

Write-Host "Server: $BaseUrl"
$email = Read-Host 'Test account email'
$password = Read-Secret 'Test account password'
$login = Invoke-Api 'POST' '/auth/login' $null @{ email = $email; password = $password }
$password = $null
if ($login.Status -ne 200 -or -not $login.Body.token) {
  Write-Host "Login failed (HTTP $($login.Status)). Stopping." -ForegroundColor Red
  exit 1
}
$token = [string]$login.Body.token
$userId = [string]$login.Body.user.id
$originalNickname = [string]$login.Body.user.nickname
$newNickname = 'nick' + (Get-Random -Minimum 1000 -Maximum 9999)
Write-Host "User id: $userId"
Write-Host ''

$commentId = $null
$changed = $false
try {
  # 0. Create an OLD comment (written before the nickname change)
  $r = Invoke-Api 'POST' '/comments' $token @{ isbn = $Isbn; content = 'nickname script comment' }
  if ($r.Status -ne 201) { throw "Could not create the test comment (HTTP $($r.Status))" }
  $commentId = [string]$r.Body.data.id
  Check '0. old comment created with the current nickname' ([string]$r.Body.data.nickname -eq $originalNickname)

  # 1. Auth and validation
  $r = Invoke-Api 'PATCH' '/auth/nickname' $null @{ nickname = $newNickname }
  Check '1. no token -> 401' ($r.Status -eq 401) "(got $($r.Status))"
  $r = Invoke-Api 'PATCH' '/auth/nickname' $token @{ nickname = 'a' }
  Check '1. 1 character -> 400' ($r.Status -eq 400) "(got $($r.Status))"
  $r = Invoke-Api 'PATCH' '/auth/nickname' $token @{ nickname = "ab`ncd" }
  Check '1. newline inside -> 400' ($r.Status -eq 400) "(got $($r.Status))"

  # 2. Valid change
  $r = Invoke-Api 'PATCH' '/auth/nickname' $token @{ nickname = "  $newNickname  " }
  $changed = ($r.Status -eq 200)
  Check '2. valid change (with spaces around) -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  Check '2. response nickname is trimmed' ([string]$r.Body.user.nickname -eq $newNickname)
  Check '2. response has no password field' ($null -eq $r.Body.user.password)
  Check '2. response user id is mine' ([string]$r.Body.user.id -eq $userId)

  # 3. The OLD comment shows the NEW nickname (join, not a stored copy)
  $list = Invoke-Api 'GET' "/comments?isbn=$Isbn&limit=50" $token $null
  $mine = @($list.Body.data) | Where-Object { [string]$_.id -eq $commentId }
  Check '3. old comment now shows the new nickname' ($null -ne $mine -and [string]$mine.nickname -eq $newNickname) "(got '$($mine.nickname)')"

  # 4. Login returns the new nickname too
  $pw = Read-Secret 'Password again (to log in once more)'
  $again = Invoke-Api 'POST' '/auth/login' $null @{ email = $email; password = $pw }
  $pw = $null
  Check '4. login shows the new nickname' ($again.Status -eq 200 -and [string]$again.Body.user.nickname -eq $newNickname)
}
finally {
  # Cleanup: restore the nickname and delete the test comment
  if ($changed) {
    $r = Invoke-Api 'PATCH' '/auth/nickname' $token @{ nickname = $originalNickname }
    if ($r.Status -eq 200) { Write-Host 'Cleanup: nickname restored.' }
    else { Write-Host "Cleanup: could not restore the nickname (HTTP $($r.Status)). Set it back by hand." -ForegroundColor Yellow }
  }
  if ($commentId) {
    $r = Invoke-Api 'DELETE' "/comments/$commentId" $token $null
    Write-Host "Cleanup: test comment delete -> HTTP $($r.Status)"
  }
}

Write-Host ''
Write-Host "Passed: $script:Passed  Failed: $script:Failed"
if ($script:Failed -gt 0) { exit 1 }
