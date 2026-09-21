# Backs up then removes a User-scope environment variable. Never prints the value.
param(
    [string]$Name = "OPENAI_API_KEY",
    [string]$BackupPath = (Join-Path $env:USERPROFILE "env-user-scope-backup.txt")
)

$value = [Environment]::GetEnvironmentVariable($Name, "User")
if ([string]::IsNullOrEmpty($value)) {
    "User scope $Name is already unset. Nothing to do."
    return
}

"$Name=$value" | Out-File -FilePath $BackupPath -Encoding utf8 -Append
"Backed up $Name (length $($value.Length)) to $BackupPath"

[Environment]::SetEnvironmentVariable($Name, $null, "User")
$after = [Environment]::GetEnvironmentVariable($Name, "User")
"User scope $Name after removal: " + $(if ([string]::IsNullOrEmpty($after)) { "unset" } else { "STILL SET" })
