# test-comment-likes-reports.ps1
# Manual check of comment likes (hearts) and reports with two accounts.
# Run against your LOCAL dev server (npm run dev). NOTE: the local server uses the real Supabase DB,
# so this script creates and deletes real rows. Run the SQL first (20261114_comment_likes.sql and
# 20261114_comment_reports.sql) or every check will fail with HTTP 500.
# Only the dedicated test ISBN 9790000000019 is used, so real book comments are never touched.
# Tokens and passwords are never printed.
#
# Usage (Windows PowerShell 5.1 or PowerShell 7):
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-comment-likes-reports.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-comment-likes-reports.ps1 -BaseUrl http://localhost:5000/api
#
# Cleanup: only root comments WITHOUT replies are created, so deleting them through the API really
# deletes the rows and the likes/reports go with them (ON DELETE CASCADE). Likes are also removed
# explicitly. If the script stops half way, remove leftovers in Supabase SQL Editor (CASCADE cleans
# likes and reports too):
#   DELETE FROM public.comments WHERE isbn = '9790000000019';
# Korean text is built from code points and the JSON body is sent as UTF-8 bytes, so this file stays
# English-only (Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI).
# The report detail is never returned by the API, so the stored Korean text cannot be read back here.
# Only the length rule is checked (200 Korean characters accepted = counted as characters, not bytes).
# To see the stored value, run in Supabase SQL Editor:
#   SELECT reason, char_length(detail) FROM public.comment_reports r
#     JOIN public.comments c ON c.id = r.comment_id WHERE c.isbn = '9790000000019';
# The "deleted comment" cases (404) are covered by the unit tests only: they need a reply, which would
# leave a deleted-marker row behind.

param(
  [string]$BaseUrl = 'http://localhost:5000/api'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$Isbn = '9790000000019'              # the only ISBN this script may use
$MissingId = '9223372036854775807'   # valid bigint that does not exist

$script:Passed = 0
$script:Failed = 0
$script:Created = New-Object System.Collections.ArrayList

# Korean test text built from code points (U+AC00 = first Hangul syllable)
function New-Hangul([int]$Count) { return (-join (1..$Count | ForEach-Object { [char]0xAC00 })) }

function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Sends a request and returns @{ Status = <int>; Body = <object or $null>; Text = <raw text> } for any HTTP status.
# The JSON body is sent as UTF-8 bytes so Korean text is not corrupted by the console code page.
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
  return @{ Status = $status; Body = $parsed; Text = [string]$text }
}

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { $script:Passed++; Write-Host "PASS  $Name" -ForegroundColor Green }
  else { $script:Failed++; Write-Host "FAIL  $Name $Detail" -ForegroundColor Red }
}

function Login([string]$Label) {
  $email = Read-Host "$Label email"
  $password = Read-Secret "$Label password"
  $r = Invoke-Api 'POST' '/auth/login' $null @{ email = $email; password = $password }
  $password = $null
  if ($r.Status -ne 200 -or -not $r.Body.token) {
    Write-Host "Login failed for $Label (HTTP $($r.Status)). Stopping." -ForegroundColor Red
    exit 1
  }
  return @{ Token = [string]$r.Body.token; UserId = [string]$r.Body.user.id }
}

# Creates a root comment (remembers it for cleanup)
function New-Comment([string]$Token, [string]$Content) {
  $r = Invoke-Api 'POST' '/comments' $Token @{ isbn = $Isbn; content = $Content }
  if ($r.Status -eq 201) { [void]$script:Created.Add(@{ Id = [string]$r.Body.data.id; Token = $Token }) }
  return $r
}

function Get-Roots([string]$Token) { return Invoke-Api 'GET' "/comments?isbn=$Isbn&limit=50" $Token $null }

function Find-Item($Body, [string]$Id) {
  return @($Body.data) | Where-Object { [string]$_.id -eq $Id } | Select-Object -First 1
}

function Same-Json($X, $Y) {
  return (($X | ConvertTo-Json -Compress -Depth 5) -eq ($Y | ConvertTo-Json -Compress -Depth 5))
}

Write-Host "Server: $BaseUrl   Test ISBN: $Isbn"
$A = Login 'Account A'
$B = Login 'Account B'
if ($A.UserId -eq $B.UserId) {
  Write-Host 'Account A and B are the same user. Use two different accounts.' -ForegroundColor Red
  exit 1
}
Write-Host ''

try {
  $r = New-Comment $A.Token 'likes script A1'
  $a1 = [string]$r.Body.data.id
  Check '0. A creates a comment -> 201 with like_count 0 and liked_by_me false' (
    $r.Status -eq 201 -and $r.Body.data.like_count -eq 0 -and $r.Body.data.liked_by_me -eq $false) "(got $($r.Status))"
  $r = New-Comment $B.Token 'likes script B1'
  $b1 = [string]$r.Body.data.id

  # 1. Hearts: B likes A's comment
  $r = Invoke-Api 'PUT' "/comments/$a1/like" $B.Token $null
  Check '1. B likes A comment -> 200, like_count 1, liked_by_me true' (
    $r.Status -eq 200 -and $r.Body.success -eq $true -and $r.Body.data.like_count -eq 1 -and $r.Body.data.liked_by_me -eq $true -and
    [string]$r.Body.data.comment_id -eq $a1) "(got $($r.Status))"
  $r2 = Invoke-Api 'PUT' "/comments/$a1/like" $B.Token $null
  Check '1. liking again is idempotent -> 200, like_count still 1' ($r2.Status -eq 200 -and $r2.Body.data.like_count -eq 1) "(got $($r2.Status) $($r2.Body.data.like_count))"
  foreach ($who in @(@{ Name = 'B'; Token = $B.Token; Liked = $true }, @{ Name = 'A'; Token = $A.Token; Liked = $false }, @{ Name = 'anonymous'; Token = $null; Liked = $false })) {
    $it = Find-Item (Get-Roots $who.Token).Body $a1
    Check "1. list as $($who.Name): like_count 1, liked_by_me $($who.Liked)" (
      $null -ne $it -and $it.like_count -eq 1 -and $it.liked_by_me -eq $who.Liked)
  }

  # 2. Own comment and bad requests
  $r = Invoke-Api 'PUT' "/comments/$a1/like" $A.Token $null
  Check '2. A likes own comment -> 400 LIKE_OWN_COMMENT' ($r.Status -eq 400 -and $r.Body.code -eq 'LIKE_OWN_COMMENT') "(got $($r.Status) $($r.Body.code))"
  $r = Invoke-Api 'PUT' "/comments/$a1/like" $null $null
  Check '2. like without token -> 401' ($r.Status -eq 401) "(got $($r.Status))"
  $r = Invoke-Api 'DELETE' "/comments/$a1/like" $null $null
  Check '2. unlike without token -> 401' ($r.Status -eq 401) "(got $($r.Status))"
  $rMissing = Invoke-Api 'PUT' "/comments/$MissingId/like" $B.Token $null
  Check '2. like a missing comment -> 404' ($rMissing.Status -eq 404) "(got $($rMissing.Status))"
  $r = Invoke-Api 'PUT' '/comments/abc/like' $B.Token $null
  Check '2. like with an invalid id -> 404' ($r.Status -eq 404) "(got $($r.Status))"
  $r = Invoke-Api 'DELETE' "/comments/$MissingId/like" $B.Token $null
  Check '2. unlike a missing comment -> 404' ($r.Status -eq 404) "(got $($r.Status))"

  # 3. Hidden comment of another user: PUT 404 (same body as missing), real count kept, DELETE allowed
  [void](Invoke-Api 'PATCH' "/comments/$a1/hidden" $A.Token @{ is_hidden = $true })
  $r = Invoke-Api 'PUT' "/comments/$a1/like" $B.Token $null
  Check '3. B likes A hidden comment -> 404, same body as a missing comment' ($r.Status -eq 404 -and (Same-Json $r.Body $rMissing.Body)) "(got $($r.Status))"
  $it = Find-Item (Get-Roots $B.Token).Body $a1
  Check '3. hidden comment keeps its real like_count (1) and liked_by_me (true) for B' (
    $null -ne $it -and $it.content_masked -eq $true -and $it.like_count -eq 1 -and $it.liked_by_me -eq $true)
  $r = Invoke-Api 'DELETE' "/comments/$a1/like" $B.Token $null
  Check '3. B removes the heart from the hidden comment -> 200, like_count 0, liked_by_me false' (
    $r.Status -eq 200 -and $r.Body.data.like_count -eq 0 -and $r.Body.data.liked_by_me -eq $false) "(got $($r.Status))"
  $r = Invoke-Api 'DELETE' "/comments/$a1/like" $A.Token $null
  Check '3. A unlike on own hidden comment -> 200 (allowed, nothing to remove)' ($r.Status -eq 200 -and $r.Body.data.like_count -eq 0) "(got $($r.Status))"
  [void](Invoke-Api 'PATCH' "/comments/$a1/hidden" $A.Token @{ is_hidden = $false })

  # 4. Unlike is idempotent
  [void](Invoke-Api 'PUT' "/comments/$a1/like" $B.Token $null)
  $r = Invoke-Api 'DELETE' "/comments/$a1/like" $B.Token $null
  Check '4. B unlikes -> 200, like_count 0, liked_by_me false' ($r.Status -eq 200 -and $r.Body.data.like_count -eq 0 -and $r.Body.data.liked_by_me -eq $false) "(got $($r.Status))"
  $r = Invoke-Api 'DELETE' "/comments/$a1/like" $B.Token $null
  Check '4. unliking again is idempotent -> 200' ($r.Status -eq 200 -and $r.Body.data.like_count -eq 0) "(got $($r.Status))"

  # 5. Reports
  $r = Invoke-Api 'POST' "/comments/$a1/report" $B.Token @{ reason = 'spam' }
  Check '5. B reports A comment -> 201 with only success and message' (
    $r.Status -eq 201 -and $r.Body.success -eq $true -and $r.Body.message -and
    (@($r.Body.PSObject.Properties.Name) -join ',') -eq 'success,message') "(got $($r.Status))"
  Check '5. report response does not contain the reporter id' (-not $r.Text.Contains($B.UserId))
  $r = Invoke-Api 'POST' "/comments/$a1/report" $B.Token @{ reason = 'abuse' }
  Check '5. reporting the same comment again -> 409 ALREADY_REPORTED' ($r.Status -eq 409 -and $r.Body.code -eq 'ALREADY_REPORTED') "(got $($r.Status) $($r.Body.code))"
  $r = Invoke-Api 'POST' "/comments/$a1/report" $A.Token @{ reason = 'spam' }
  Check '5. A reports own comment -> 400 REPORT_OWN_COMMENT' ($r.Status -eq 400 -and $r.Body.code -eq 'REPORT_OWN_COMMENT') "(got $($r.Status) $($r.Body.code))"
  $r = Invoke-Api 'POST' "/comments/$a1/report" $B.Token @{ reason = 'nope' }
  Check '5. invalid reason -> 400' ($r.Status -eq 400) "(got $($r.Status))"
  $r = Invoke-Api 'POST' "/comments/$a1/report" $null @{ reason = 'spam' }
  Check '5. report without token -> 401' ($r.Status -eq 401) "(got $($r.Status))"
  $r = Invoke-Api 'POST' "/comments/$MissingId/report" $B.Token @{ reason = 'spam' }
  Check '5. report a missing comment -> 404' ($r.Status -eq 404) "(got $($r.Status))"
  $it = Find-Item (Get-Roots $A.Token).Body $a1
  Check '5. reporting does not hide or delete the comment' ($null -ne $it -and $it.is_hidden -eq $false -and $it.is_deleted -eq $false)

  # 6. detail length counts characters (Korean text built from code points)
  $r = New-Comment $A.Token 'likes script A2'
  $a2 = [string]$r.Body.data.id
  $r = Invoke-Api 'POST' "/comments/$a2/report" $B.Token @{ reason = 'other'; detail = (New-Hangul 200) }
  Check '6. 200 Korean characters as detail -> 201 (characters, not bytes)' ($r.Status -eq 201) "(got $($r.Status))"

  $r = New-Comment $A.Token 'likes script A3'
  $a3 = [string]$r.Body.data.id
  $r = Invoke-Api 'POST' "/comments/$a3/report" $B.Token @{ reason = 'other'; detail = (New-Hangul 201) }
  Check '6. 201 Korean characters as detail -> 400' ($r.Status -eq 400) "(got $($r.Status))"

  # 7. A hidden comment of another user can still be reported (reason other without detail)
  [void](Invoke-Api 'PATCH' "/comments/$a3/hidden" $A.Token @{ is_hidden = $true })
  $r = Invoke-Api 'POST' "/comments/$a3/report" $B.Token @{ reason = 'other' }
  Check '7. B reports A hidden comment (reason other, no detail) -> 201' ($r.Status -eq 201) "(got $($r.Status))"
}
finally {
  # Cleanup: remove hearts, then delete every comment created here (no replies -> rows are really deleted,
  # and reports/likes go with them by ON DELETE CASCADE). 404 is fine for rows already gone.
  foreach ($c in @($script:Created.ToArray())) {
    [void](Invoke-Api 'DELETE' "/comments/$($c.Id)/like" $B.Token $null)
    [void](Invoke-Api 'DELETE' "/comments/$($c.Id)/like" $A.Token $null)
  }
  foreach ($c in @($script:Created.ToArray())) { [void](Invoke-Api 'DELETE' "/comments/$($c.Id)" $c.Token $null) }
  $A = $null; $B = $null
}

Write-Host ''
Write-Host "$($script:Passed) passed, $($script:Failed) failed"
Write-Host "Leftover check (Supabase SQL Editor, expect 0): SELECT count(*) FROM public.comments WHERE isbn = '$Isbn';"
if ($script:Failed -gt 0) { exit 1 } else { exit 0 }
