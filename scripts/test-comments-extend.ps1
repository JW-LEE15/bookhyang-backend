# test-comments-extend.ps1
# Manual check of the extended comments API (replies, spoiler, hidden, mixed delete) with two accounts.
# Run against your LOCAL dev server (npm run dev). NOTE: the local server uses the real Supabase DB,
# so this script creates and deletes real rows. All rows use a dedicated test ISBN (-Isbn) so real book
# comments are never touched. Tokens and passwords are never printed.
#
# Usage (Windows PowerShell 5.1 or PowerShell 7):
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-comments-extend.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-comments-extend.ps1 -BaseUrl http://localhost:5000/api
#
# Cleanup: the script deletes everything it created through the API. A root comment that had replies
# becomes a "deleted" marker row and cannot be removed through the API, so one marker row per run stays.
# It is hidden from lists. To remove leftovers, run in Supabase SQL Editor (comments only):
#   DELETE FROM public.comments WHERE isbn = '9790000000019';
# Keep this file English-only (Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI).

param(
  [string]$BaseUrl = 'http://localhost:5000/api',
  [string]$Isbn = '9790000000019',
  [string]$OtherIsbn = '9790000000026'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$MissingId = '9223372036854775807'   # valid bigint that does not exist

$script:Passed = 0
$script:Failed = 0
$script:Created = New-Object System.Collections.ArrayList

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

# Creates a comment (remembers it for cleanup). $Extra is an optional hashtable merged into the body.
function New-Comment([string]$Token, [string]$Content, $Extra) {
  $body = @{ isbn = $Isbn; content = $Content }
  if ($null -ne $Extra) { foreach ($k in $Extra.Keys) { $body[$k] = $Extra[$k] } }
  $r = Invoke-Api 'POST' '/comments' $Token $body
  if ($r.Status -eq 201) { [void]$script:Created.Add(@{ Id = [string]$r.Body.data.id; Token = $Token }) }
  return $r
}

function Get-Roots([string]$Token) {
  return Invoke-Api 'GET' "/comments?isbn=$Isbn&limit=50" $Token $null
}

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
  # 1. Old-style request {isbn, content} still works and gets default values
  $r = New-Comment $A.Token 'script root 1' $null
  Check '1. A creates a root comment with only isbn+content -> 201' ($r.Status -eq 201) "(got $($r.Status))"
  $root = $r.Body.data
  $rootId = [string]$root.id
  Check '1. defaults: parent_id null, is_spoiler false, is_hidden false, is_deleted false, is_mine true' (
    $null -eq $root.parent_id -and $root.is_spoiler -eq $false -and $root.is_hidden -eq $false -and
    $root.is_deleted -eq $false -and $root.is_mine -eq $true)
  Check '1. old fields still present (id, isbn, user_id, content, created_at, nickname)' (
    $root.id -and $root.isbn -eq $Isbn -and $root.user_id -eq $A.UserId -and $root.content -eq 'script root 1' -and
    $root.created_at -and $root.nickname)

  # 2. Replies: one level only
  $r = New-Comment $B.Token 'script reply 1' @{ parent_id = $rootId }
  Check '2. B replies to A root -> 201 with parent_id' ($r.Status -eq 201 -and [string]$r.Body.data.parent_id -eq $rootId) "(got $($r.Status))"
  $reply1Id = [string]$r.Body.data.id
  $r = New-Comment $A.Token 'reply to reply' @{ parent_id = $reply1Id }
  Check '2. reply to a reply -> 400 REPLY_TO_REPLY' ($r.Status -eq 400 -and $r.Body.code -eq 'REPLY_TO_REPLY') "(got $($r.Status) $($r.Body.code))"

  # 3. Reply to another book's comment / missing parent
  $r = Invoke-Api 'POST' '/comments' $B.Token @{ isbn = $OtherIsbn; content = 'wrong book'; parent_id = $rootId }
  Check '3. reply with a different isbn -> 400 ISBN_MISMATCH' ($r.Status -eq 400 -and $r.Body.code -eq 'ISBN_MISMATCH') "(got $($r.Status) $($r.Body.code))"
  $r = Invoke-Api 'POST' '/comments' $B.Token @{ isbn = $Isbn; content = 'no parent'; parent_id = $MissingId }
  Check '3. reply to a missing parent -> 404 PARENT_NOT_FOUND' ($r.Status -eq 404 -and $r.Body.code -eq 'PARENT_NOT_FOUND') "(got $($r.Status) $($r.Body.code))"

  # 4. reply_count and the replies endpoint
  $r = New-Comment $B.Token 'script reply 2' @{ parent_id = $rootId }
  $reply2Id = [string]$r.Body.data.id
  $list = Get-Roots $null
  $item = Find-Item $list.Body $rootId
  Check '4. list (no token) -> 200 with top_level_total and total' (
    $list.Status -eq 200 -and $null -ne $list.Body.top_level_total -and $list.Body.total -ge 3) "(got $($list.Status))"
  Check '4. list shows only root comments (no item has parent_id)' (@($list.Body.data | Where-Object { $null -ne $_.parent_id }).Count -eq 0)
  Check '4. root has reply_count 2' ($null -ne $item -and $item.reply_count -eq 2) "(got $($item.reply_count))"
  $p1 = Invoke-Api 'GET' "/comments/$rootId/replies?limit=1" $null $null
  Check '4. replies limit=1 -> first reply (oldest first) and a nextCursor' (
    $p1.Status -eq 200 -and @($p1.Body.data).Count -eq 1 -and [string]$p1.Body.data[0].id -eq $reply1Id -and
    $p1.Body.total -eq 2 -and $p1.Body.nextCursor) "(got $($p1.Status))"
  $p2 = Invoke-Api 'GET' "/comments/$rootId/replies?limit=1&after=$($p1.Body.nextCursor)" $null $null
  Check '4. replies after=cursor -> second reply, no more pages' (
    $p2.Status -eq 200 -and [string]$p2.Body.data[0].id -eq $reply2Id -and $null -eq $p2.Body.nextCursor) "(got $($p2.Status))"
  $r = Invoke-Api 'GET' "/comments/$reply1Id/replies" $null $null
  Check '4. replies of a reply -> 404' ($r.Status -eq 404) "(got $($r.Status))"
  $r = Invoke-Api 'GET' '/comments/abc/replies' $null $null
  Check '4. replies with invalid id -> 404' ($r.Status -eq 404) "(got $($r.Status))"

  # 5. Hide: others see a masked comment, the author sees the original with is_hidden
  $r = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $A.Token @{ is_hidden = $true }
  Check '5. A hides own root -> 200 is_hidden true, author still sees original' (
    $r.Status -eq 200 -and $r.Body.data.is_hidden -eq $true -and $r.Body.data.content -eq 'script root 1' -and
    $r.Body.data.content_masked -eq $false) "(got $($r.Status))"
  $r = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $A.Token @{ is_hidden = $true }
  Check '5. hiding again is idempotent -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  foreach ($who in @(@{ Name = 'B'; Token = $B.Token }, @{ Name = 'anonymous'; Token = $null })) {
    $it = Find-Item (Get-Roots $who.Token).Body $rootId
    Check "5. $($who.Name) sees it masked (content replaced, nickname and user_id kept)" (
      $null -ne $it -and $it.is_hidden -eq $true -and $it.content_masked -eq $true -and
      $it.content -ne 'script root 1' -and $it.nickname -and $it.user_id -eq $A.UserId)
  }
  $it = Find-Item (Get-Roots $A.Token).Body $rootId
  Check '5. A sees own hidden comment: original content, is_hidden true, is_mine true' (
    $null -ne $it -and $it.content -eq 'script root 1' -and $it.is_hidden -eq $true -and $it.content_masked -eq $false -and $it.is_mine -eq $true)
  $r = Invoke-Api 'POST' '/comments' $B.Token @{ isbn = $Isbn; content = 'reply to hidden'; parent_id = $rootId }
  Check '5. reply to a hidden comment -> 409 PARENT_HIDDEN' ($r.Status -eq 409 -and $r.Body.code -eq 'PARENT_HIDDEN') "(got $($r.Status) $($r.Body.code))"
  $r = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $A.Token @{ is_hidden = $false }
  Check '5. A unhides -> 200 is_hidden false' ($r.Status -eq 200 -and $r.Body.data.is_hidden -eq $false) "(got $($r.Status))"
  $it = Find-Item (Get-Roots $B.Token).Body $rootId
  Check '5. after unhide B sees the original content again' ($null -ne $it -and $it.content -eq 'script root 1' -and $it.content_masked -eq $false)

  # 6. Ownership: B cannot touch A's comment, and it looks the same as a missing comment
  $rHide = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $B.Token @{ is_hidden = $true }
  Check "6. B hides A's comment -> 404" ($rHide.Status -eq 404) "(got $($rHide.Status))"
  $rDelOther = Invoke-Api 'DELETE' "/comments/$rootId" $B.Token $null
  Check "6. B deletes A's comment -> 404" ($rDelOther.Status -eq 404) "(got $($rDelOther.Status))"
  $rDelMissing = Invoke-Api 'DELETE' "/comments/$MissingId" $B.Token $null
  Check '6. 404 body for A comment == 404 body for missing comment' ($rDelMissing.Status -eq 404 -and (Same-Json $rDelOther.Body $rDelMissing.Body))
  $it = Find-Item (Get-Roots $A.Token).Body $rootId
  Check "6. A's comment is unchanged (not hidden, not deleted)" ($null -ne $it -and $it.is_hidden -eq $false -and $it.is_deleted -eq $false)
  $r = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $A.Token @{ is_hidden = 'yes' }
  Check '6. is_hidden must be a boolean -> 400' ($r.Status -eq 400) "(got $($r.Status))"
  $r = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $null @{ is_hidden = $true }
  Check '6. hide without token -> 401' ($r.Status -eq 401) "(got $($r.Status))"

  # 10 (part). Spoiler flag (done before the delete steps; checked as item 10 below)
  $r = Invoke-Api 'POST' '/comments' $A.Token @{ isbn = $Isbn; content = 'script spoiler'; is_spoiler = 'true' }
  Check '10. is_spoiler as the string "true" -> 400' ($r.Status -eq 400) "(got $($r.Status))"
  $r = New-Comment $A.Token 'script spoiler' @{ is_spoiler = $true }
  Check '10. is_spoiler true -> 201 and flag is returned' ($r.Status -eq 201 -and $r.Body.data.is_spoiler -eq $true) "(got $($r.Status))"
  $spoilerId = [string]$r.Body.data.id
  $it = Find-Item (Get-Roots $null).Body $spoilerId
  Check '10. spoiler comment is listed with its content and is_spoiler true (front end hides it)' (
    $null -ne $it -and $it.is_spoiler -eq $true -and $it.content -eq 'script spoiler' -and $it.content_masked -eq $false)

  # 7. Delete a root that has replies -> it stays as a "deleted" marker, replies stay
  $r = Invoke-Api 'DELETE' "/comments/$rootId" $A.Token $null
  Check '7. A deletes a root that has replies -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  $it = Find-Item (Get-Roots $null).Body $rootId
  Check '7. root stays as a deleted marker: is_deleted, user_id and nickname null, content masked, reply_count 2' (
    $null -ne $it -and $it.is_deleted -eq $true -and $null -eq $it.user_id -and $null -eq $it.nickname -and
    $it.content_masked -eq $true -and $it.content -ne 'script root 1' -and $it.reply_count -eq 2)
  $rr = Invoke-Api 'GET' "/comments/$rootId/replies" $null $null
  Check '7. replies of the deleted marker are still readable (2 replies)' ($rr.Status -eq 200 -and @($rr.Body.data).Count -eq 2)
  $r = Invoke-Api 'DELETE' "/comments/$rootId" $A.Token $null
  Check '7. deleting the marker again -> 404' ($r.Status -eq 404) "(got $($r.Status))"
  $r = Invoke-Api 'PATCH' "/comments/$rootId/hidden" $A.Token @{ is_hidden = $true }
  Check '7. hiding the deleted marker -> 404' ($r.Status -eq 404) "(got $($r.Status))"
  $r = Invoke-Api 'POST' '/comments' $B.Token @{ isbn = $Isbn; content = 'reply to deleted'; parent_id = $rootId }
  Check '7. reply to the deleted marker -> 404 PARENT_NOT_FOUND' ($r.Status -eq 404 -and $r.Body.code -eq 'PARENT_NOT_FOUND') "(got $($r.Status) $($r.Body.code))"

  # 8. Real delete: replies, and roots without replies
  $r = Invoke-Api 'DELETE' "/comments/$reply1Id" $B.Token $null
  Check '8. B deletes own reply -> 200 (really deleted)' ($r.Status -eq 200) "(got $($r.Status))"
  $rr = Invoke-Api 'GET' "/comments/$rootId/replies" $null $null
  Check '8. the marker now has 1 reply' ($rr.Status -eq 200 -and $rr.Body.total -eq 1)
  $r = Invoke-Api 'DELETE' "/comments/$reply2Id" $B.Token $null
  Check '8. B deletes the last reply -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  Check '8. a deleted marker with no replies left is no longer listed' ($null -eq (Find-Item (Get-Roots $null).Body $rootId))
  $r = Invoke-Api 'DELETE' "/comments/$spoilerId" $A.Token $null
  Check '8. A deletes a root without replies -> 200 (really deleted)' ($r.Status -eq 200) "(got $($r.Status))"
  Check '8. it is gone from the list' ($null -eq (Find-Item (Get-Roots $null).Body $spoilerId))

  # 9. Public read stays public: no token and a bad token both work, write needs a token
  $r = Invoke-Api 'GET' "/comments?isbn=$Isbn" 'not-a-valid-token' $null
  Check '9. GET list with an invalid token -> 200 (treated as logged out)' ($r.Status -eq 200) "(got $($r.Status))"
  $r = Invoke-Api 'GET' "/comments?isbn=$Isbn" $null $null
  Check '9. GET list without token -> 200' ($r.Status -eq 200) "(got $($r.Status))"
  $r = Invoke-Api 'GET' '/comments?isbn=123' $null $null
  Check '9. GET list with a bad isbn -> 400' ($r.Status -eq 400) "(got $($r.Status))"
  $r = Invoke-Api 'POST' '/comments' $null @{ isbn = $Isbn; content = 'no token' }
  Check '9. POST without token -> 401' ($r.Status -eq 401) "(got $($r.Status))"
}
finally {
  # Cleanup: delete whatever is left (replies first). 404 is expected for rows already deleted.
  $leftover = @($script:Created.ToArray())
  [array]::Reverse($leftover)
  foreach ($c in $leftover) { [void](Invoke-Api 'DELETE' "/comments/$($c.Id)" $c.Token $null) }
  $A = $null; $B = $null
}

Write-Host ''
Write-Host "$($script:Passed) passed, $($script:Failed) failed"
Write-Host "Note: one deleted-marker row may remain for ISBN $Isbn. Remove it in Supabase SQL Editor:"
Write-Host "  DELETE FROM public.comments WHERE isbn = '$Isbn';"
if ($script:Failed -gt 0) { exit 1 } else { exit 0 }
