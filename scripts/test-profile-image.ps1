# test-profile-image.ps1
# Checks the profile image API against your LOCAL dev server (npm run dev) with one test account.
# Run 20261114_users_profile_image.sql in Supabase FIRST (the new code reads users.profile_image_updated_at).
#   PUT    /api/auth/profile-image        (JSON { image: <base64> }, login required)
#   DELETE /api/auth/profile-image
#   GET    /api/users/:id/profile-image   (public, returns the image bytes)
# What it checks:
#   - no token -> 401, GIF / random bytes -> 400, too big -> 413
#   - JPEG and PNG upload -> 200 with profile_image_url, GET returns the same bytes with the right Content-Type
#   - a comment written by the user shows profile_image_url in the comment list
#   - DELETE -> url is null, GET -> 404, DELETE again -> 200
# At the end the account's previous image is restored (downloaded first, uploaded again) or removed if there was none.
# Tokens, passwords and base64 image data are never printed.
#
# Usage (Windows PowerShell 5.1 or PowerShell 7 on Windows, needs System.Drawing):
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-profile-image.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-profile-image.ps1 -BaseUrl http://localhost:5000/api
#
# Note: PUT and DELETE share a limit of 20 requests per hour per user. One run uses about 10
# (the 401 request is not counted).
# This script is ASCII only on purpose (Windows PowerShell 5.1 reads files without BOM as ANSI).

param(
  [string]$BaseUrl = 'http://localhost:5000/api',
  [string]$Isbn = '9790000000019'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$Root = $BaseUrl -replace '/api$', ''   # image urls from the server start with /api/...
Add-Type -AssemblyName System.Drawing

$script:Passed = 0
$script:Failed = 0

function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Sends a JSON request and returns @{ Status = <int>; Body = <object or $null> } for any HTTP status.
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

# GETs an image url (relative to the server root, no token) and returns Status, Bytes, ContentType.
function Get-ImageRaw([string]$RelativeUrl) {
  try {
    $resp = Invoke-WebRequest -Uri "$Root$RelativeUrl" -Method Get -UseBasicParsing -Headers @{ 'ngrok-skip-browser-warning' = 'true' }
    $bytes = $resp.Content
    if ($bytes -is [string]) { $bytes = [Text.Encoding]::UTF8.GetBytes($bytes) }
    return @{ Status = [int]$resp.StatusCode; Bytes = [byte[]]$bytes; ContentType = [string]$resp.Headers['Content-Type'] }
  } catch {
    if ($null -eq $_.Exception.Response) { throw "Cannot reach $Root ($($_.Exception.Message))" }
    return @{ Status = [int]$_.Exception.Response.StatusCode; Bytes = @(); ContentType = '' }
  }
}

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { $script:Passed++; Write-Host "PASS  $Name" -ForegroundColor Green }
  else { $script:Failed++; Write-Host "FAIL  $Name $Detail" -ForegroundColor Red }
}

# Makes a small test picture (64x64) as bytes. Format: Jpeg, Png or Gif.
function New-TestImage([string]$Format) {
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::SteelBlue)
    $g.FillEllipse([System.Drawing.Brushes]::Gold, 12, 12, 40, 40)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::$Format)
    return , $ms.ToArray()
  } finally { $bmp.Dispose() }
}

# Random bytes that start like a JPEG and end like a JPEG (only the size is wrong on purpose)
function New-FakeJpeg([int]$Size) {
  $bytes = New-Object byte[] $Size
  (New-Object System.Random).NextBytes($bytes)
  $bytes[0] = 0xFF; $bytes[1] = 0xD8; $bytes[2] = 0xFF; $bytes[3] = 0xE0
  $bytes[$Size - 2] = 0xFF; $bytes[$Size - 1] = 0xD9
  return , $bytes
}

function Test-SameBytes([byte[]]$A, [byte[]]$B) {
  if ($A.Length -ne $B.Length) { return $false }
  for ($i = 0; $i -lt $A.Length; $i++) { if ($A[$i] -ne $B[$i]) { return $false } }
  return $true
}

Write-Host "Server: $BaseUrl"
$email = Read-Host 'Test account email'
$password = Read-Secret 'Test account password'
$login = Invoke-Api 'POST' '/auth/login' $null @{ email = $email; password = $password }
$password = $null
if ($login.Status -ne 200 -or -not $login.Body.token) {
  Write-Host "Login failed (HTTP $($login.Status)). Stopping." -ForegroundColor Red
  Write-Host 'If it says a column does not exist, run 20261114_users_profile_image.sql in Supabase first.'
  exit 1
}
$token = [string]$login.Body.token
$userId = [string]$login.Body.user.id
$originalUrl = $login.Body.user.profile_image_url
Write-Host "User id: $userId"
Check '0. login response has a profile_image_url field (null or a path), no password' (
  ($login.Body.user.PSObject.Properties.Name -contains 'profile_image_url') -and ($null -eq $login.Body.user.password))

# Remember the current image so it can be restored
$originalBytes = $null
if ($originalUrl) {
  $orig = Get-ImageRaw ([string]$originalUrl)
  if ($orig.Status -eq 200) { $originalBytes = $orig.Bytes }
}
Write-Host ''

$commentId = $null
try {
  # 1. Rejections
  $r = Invoke-Api 'PUT' '/auth/profile-image' $null @{ image = [Convert]::ToBase64String((New-TestImage 'Jpeg')) }
  Check '1. no token -> 401' ($r.Status -eq 401) "(got $($r.Status))"

  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String((New-TestImage 'Gif')) }
  Check '1. GIF -> 400' ($r.Status -eq 400) "(got $($r.Status))"

  $junk = New-Object byte[] 500
  (New-Object System.Random).NextBytes($junk)
  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String($junk) }
  Check '1. random bytes (not an image) -> 400' ($r.Status -eq 400) "(got $($r.Status))"

  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = 'this is not base64 !!!' }
  Check '1. not base64 -> 400' ($r.Status -eq 400) "(got $($r.Status))"

  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String((New-FakeJpeg (110 * 1024))) }
  Check '1. 110KB (over 100KB) -> 413' ($r.Status -eq 413) "(got $($r.Status))"

  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String((New-FakeJpeg (200 * 1024))) }
  Check '1. 200KB body (over the 150KB body limit) -> 413, not 500' ($r.Status -eq 413) "(got $($r.Status))"

  # 2. JPEG upload, then read it back without a token
  $jpeg = New-TestImage 'Jpeg'
  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String($jpeg) }
  Check '2. JPEG upload -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  $url = [string]$r.Body.user.profile_image_url
  Check '2. response has profile_image_url for my user id' ($url -like "/api/users/$userId/profile-image?v=*") "(got '$url')"
  Check '2. response user has no password' ($null -eq $r.Body.user.password)

  $img = Get-ImageRaw $url
  Check '2. GET image without token -> 200' ($img.Status -eq 200) "(got $($img.Status))"
  Check '2. Content-Type is image/jpeg' ($img.ContentType -like 'image/jpeg*') "(got '$($img.ContentType)')"
  Check '2. returned bytes are exactly what was uploaded' (Test-SameBytes $img.Bytes $jpeg)

  # 3. The user's comment shows the url in the list
  $c = Invoke-Api 'POST' '/comments' $token @{ isbn = $Isbn; content = 'profile image script comment' }
  if ($c.Status -ne 201) { throw "Could not create the test comment (HTTP $($c.Status))" }
  $commentId = [string]$c.Body.data.id
  Check '3. new comment response has the profile_image_url' ([string]$c.Body.data.profile_image_url -eq $url)
  $list = Invoke-Api 'GET' "/comments?isbn=$Isbn&limit=50" $null $null
  $mine = @($list.Body.data) | Where-Object { [string]$_.id -eq $commentId }
  Check '3. comment list (no token) shows the same profile_image_url' ($null -ne $mine -and [string]$mine.profile_image_url -eq $url)

  # 4. PNG replaces JPEG, the url changes
  Start-Sleep -Milliseconds 20
  $png = New-TestImage 'Png'
  $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String($png) }
  Check '4. PNG upload -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  $pngUrl = [string]$r.Body.user.profile_image_url
  Check '4. url changed after the new upload (cache buster)' ($pngUrl -ne $url -and $pngUrl -like "/api/users/$userId/profile-image?v=*")
  $img = Get-ImageRaw $pngUrl
  Check '4. Content-Type is image/png' ($img.ContentType -like 'image/png*') "(got '$($img.ContentType)')"
  Check '4. returned bytes are exactly what was uploaded' (Test-SameBytes $img.Bytes $png)

  # 5. Delete
  $r = Invoke-Api 'DELETE' '/auth/profile-image' $null $null
  Check '5. DELETE without token -> 401' ($r.Status -eq 401) "(got $($r.Status))"
  $r = Invoke-Api 'DELETE' '/auth/profile-image' $token $null
  Check '5. DELETE -> 200 and profile_image_url is null' ($r.Status -eq 200 -and $null -eq $r.Body.user.profile_image_url) "(got $($r.Status))"
  $img = Get-ImageRaw $pngUrl
  Check '5. GET the old url -> 404' ($img.Status -eq 404) "(got $($img.Status))"
  $list = Invoke-Api 'GET' "/comments?isbn=$Isbn&limit=50" $null $null
  $mine = @($list.Body.data) | Where-Object { [string]$_.id -eq $commentId }
  Check '5. comment list shows profile_image_url null' ($null -ne $mine -and $null -eq $mine.profile_image_url)
  $r = Invoke-Api 'DELETE' '/auth/profile-image' $token $null
  Check '5. DELETE again (no image) -> 200' ($r.Status -eq 200) "(got $($r.Status))"

  # 6. Bad user id
  $img = Get-ImageRaw '/api/users/not-a-uuid/profile-image'
  Check '6. GET with a bad user id -> 404' ($img.Status -eq 404) "(got $($img.Status))"
}
finally {
  # Cleanup: delete the test comment, restore the previous image (or leave none)
  if ($commentId) {
    $r = Invoke-Api 'DELETE' "/comments/$commentId" $token $null
    Write-Host "Cleanup: test comment delete -> HTTP $($r.Status)"
  }
  if ($null -ne $originalBytes) {
    $r = Invoke-Api 'PUT' '/auth/profile-image' $token @{ image = [Convert]::ToBase64String($originalBytes) }
    if ($r.Status -eq 200) { Write-Host 'Cleanup: previous image restored.' }
    else { Write-Host "Cleanup: could not restore the previous image (HTTP $($r.Status)). Upload it again by hand." -ForegroundColor Yellow }
  } else {
    # The account had no image before: make sure none is left (also covers a run that stopped half way)
    $r = Invoke-Api 'DELETE' '/auth/profile-image' $token $null
    Write-Host "Cleanup: account had no image before, removed any test image -> HTTP $($r.Status)"
  }
}

Write-Host ''
Write-Host "Passed: $script:Passed  Failed: $script:Failed"
if ($script:Failed -gt 0) { exit 1 }
