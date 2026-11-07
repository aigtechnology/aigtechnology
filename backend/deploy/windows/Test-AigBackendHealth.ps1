[CmdletBinding()]
param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [string]$BackendServiceName = "AigTechnologyBackend",
    [string]$PostgresServiceName = "",
    [string]$RedisServiceName = ""
)

$ErrorActionPreference = "Stop"
$failed = $false
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name
Write-Output "Host: $($os.Caption) build $($os.BuildNumber); CPU: $cpu"

foreach ($serviceName in @($BackendServiceName, $PostgresServiceName, $RedisServiceName) | Where-Object { $_ }) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service) { Write-Output "BLOCKED: service $serviceName is not installed"; $failed = $true; continue }
    Write-Output ("{0}: {1} ({2})" -f $serviceName, $service.Status, $service.StartType)
    if ($service.Status -ne "Running") { $failed = $true }
}

foreach ($port in @(5432, 6379, 8000)) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        if ($listener.LocalAddress -notin @("127.0.0.1", "::1")) {
            Write-Output "FAIL: port $port listens on non-loopback address $($listener.LocalAddress)"
            $failed = $true
        } else {
            Write-Output "PASS: port $port listens only on loopback address $($listener.LocalAddress)"
        }
    }
    if (-not $listeners) {
        Write-Output "BLOCKED: no listener on port $port"
        $failed = $true
    }
}

foreach ($path in @("/health/live", "/health/ready")) {
    try {
        $response = Invoke-RestMethod -Uri "$($ApiBaseUrl.TrimEnd('/'))$path" -Method Get -TimeoutSec 5
        Write-Output ("{0}: {1}" -f $path, ($response | ConvertTo-Json -Compress -Depth 4))
        if ($response.status -ne "ok") { $failed = $true }
    }
    catch {
        Write-Output ("FAIL: {0} - {1}" -f $path, $_.Exception.Message)
        $failed = $true
    }
}
if ($failed) { exit 1 }
