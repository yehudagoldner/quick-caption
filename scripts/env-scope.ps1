# Reports where OPENAI_API_KEY is defined on Windows. Never prints the value.
param([string]$Name = "OPENAI_API_KEY")

function Write-Facts($scope, $value) {
    if ([string]::IsNullOrEmpty($value)) { "{0,-14}: unset" -f $scope }
    else { "{0,-14}: set, length {1}" -f $scope, $value.Length }
}

$proc = [Environment]::GetEnvironmentVariable($Name, "Process")
$user = [Environment]::GetEnvironmentVariable($Name, "User")
$machine = [Environment]::GetEnvironmentVariable($Name, "Machine")

Write-Facts "Process" $proc
Write-Facts "User scope" $user
Write-Facts "Machine scope" $machine
"Process equals User scope   : {0}" -f ($proc -eq $user)
"Process equals Machine scope: {0}" -f ($proc -eq $machine)
