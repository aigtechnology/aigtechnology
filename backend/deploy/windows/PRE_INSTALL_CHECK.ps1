[CmdletBinding()]
param(
    [ValidateSet("PreInstall", "Ready")]
    [string]$Stage = "PreInstall",
    [string]$InstallRoot = "$env:ProgramFiles\AIGTechnology\backend",
    [string]$DataRoot = "$env:ProgramData\AIGTechnology",
    [int]$MinimumMemoryGiB = 8,
    [int]$MinimumAvailableMemoryGiB = 4,
    [int]$MinimumInstallFreeGiB = 10,
    [int]$MinimumDataFreeGiB = 20,
    [int]$ApiPort = 8000,
    [int]$AdminPort = 8080,
    [int]$PostgresPort = 5432,
    [int]$RedisPort = 6379,
    [string]$RedisServiceName = ""
)

$ErrorActionPreference = "Stop"
$blockers = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Write-Check {
    param(
        [string]$Name,
        [ValidateSet("PASS", "WARN", "BLOCKED")][string]$Status,
        [string]$Detail,
        [switch]$Blocking
    )
    Write-Output ("{0}: {1} - {2}" -f $Status, $Name, $Detail)
    if ($Blocking -and $Status -ne "PASS") { $blockers.Add($Name) }
    elseif ($Status -eq "WARN") { $warnings.Add($Name) }
}

function Get-ListenerReport {
    param([int]$Port)
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-LoopbackListeners {
    param([int]$Port, [string]$Name, [bool]$Required)
    $listeners = Get-ListenerReport -Port $Port
    if (-not $listeners) {
        if ($Required) {
            Write-Check $Name "BLOCKED" "No service is listening on port $Port." -Blocking
        } else {
            Write-Check $Name "PASS" "Port $Port is available."
        }
        return
    }

    $addresses = @($listeners | Select-Object -ExpandProperty LocalAddress -Unique)
    $nonLoopback = @($addresses | Where-Object { $_ -notin @("127.0.0.1", "::1") })
    if ($nonLoopback.Count -gt 0) {
        Write-Check $Name "BLOCKED" "Port $Port is exposed on $($nonLoopback -join ', '); restrict it to loopback before continuing." -Blocking
        return
    }
    if ($Required) {
        Write-Check $Name "PASS" "Port $Port is listening only on loopback ($($addresses -join ', '))."
    } else {
        Write-Check $Name "BLOCKED" "Port $Port is already in use on loopback; stop or reconfigure the conflicting service." -Blocking
    }
}

function Test-DiskSpace {
    param([string]$Path, [string]$Name, [int]$MinimumGiB)
    $qualifier = Split-Path -Qualifier $Path
    if (-not $qualifier) {
        Write-Check $Name "BLOCKED" "Cannot determine the volume for '$Path'." -Blocking
        return
    }
    $driveName = $qualifier.TrimEnd(":")
    $drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
    if (-not $drive -or $null -eq $drive.Free) {
        Write-Check $Name "BLOCKED" "Cannot read free space for volume '$qualifier'." -Blocking
        return
    }
    $freeGiB = [math]::Round($drive.Free / 1GB, 1)
    $status = if ($freeGiB -ge $MinimumGiB) { "PASS" } else { "BLOCKED" }
    Write-Check $Name $status "$freeGiB GiB free on $qualifier; minimum configured threshold is $MinimumGiB GiB." -Blocking
}

try {
    $os = Get-CimInstance Win32_OperatingSystem
    $product = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name
    $build = [int]$os.BuildNumber
    $ubr = if ($null -ne $product.UBR) { [int]$product.UBR } else { 0 }
    $version = [string]$product.DisplayVersion
    $isServerSku = [int]$os.ProductType -ne 1
    $supportedServerLabel = $os.Caption -match "Windows Server 2022|Windows Server 2025"
    $osSupported = $isServerSku -and $supportedServerLabel -and $build -ge 20348
    Write-Check "Windows edition/build" $(if ($osSupported) { "PASS" } else { "BLOCKED" }) "$($os.Caption), version $version, build $build.$ubr; only Windows Server 2022/2025 with build >=20348 passes this preliminary check. CPU detected: $cpu (OEM/firmware support is not verified)." -Blocking

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Write-Check "Administrator permissions" $(if ($isAdmin) { "PASS" } else { "BLOCKED" }) "Elevated administrator token is $(if ($isAdmin) { 'present' } else { 'not present' }); required for Windows service installation." -Blocking

    $totalMemoryGiB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
    $availableMemoryGiB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    Write-Check "Installed RAM" $(if ($totalMemoryGiB -ge $MinimumMemoryGiB) { "PASS" } else { "BLOCKED" }) "$totalMemoryGiB GiB detected; minimum configured threshold is $MinimumMemoryGiB GiB." -Blocking
    Write-Check "Available RAM" $(if ($availableMemoryGiB -ge $MinimumAvailableMemoryGiB) { "PASS" } else { "BLOCKED" }) "$availableMemoryGiB GiB currently free; minimum configured threshold is $MinimumAvailableMemoryGiB GiB." -Blocking
    $installQualifier = (Split-Path -Qualifier $InstallRoot).TrimEnd(":")
    $dataQualifier = (Split-Path -Qualifier $DataRoot).TrimEnd(":")
    if ($installQualifier -and $installQualifier -eq $dataQualifier) {
        Test-DiskSpace -Path $InstallRoot -Name "Combined install and data volume free space" -MinimumGiB ($MinimumInstallFreeGiB + $MinimumDataFreeGiB)
    } else {
        Test-DiskSpace -Path $InstallRoot -Name "Install volume free space" -MinimumGiB $MinimumInstallFreeGiB
        Test-DiskSpace -Path $DataRoot -Name "Data/backup volume free space" -MinimumGiB $MinimumDataFreeGiB
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        if ($Stage -eq "Ready") {
            Write-Check "Python version" "BLOCKED" "Python was not found on PATH; install 64-bit Python 3.11-3.13 from a trusted source." -Blocking
        } else {
            Write-Check "Python version" "WARN" "Python was not found on PATH; install 64-bit Python 3.11-3.13 before running -Stage Ready."
        }
    } else {
        $pythonOutput = (& $pythonCommand.Source -c "import sys,struct; print('.'.join(map(str, sys.version_info[:3])) + '|' + str(struct.calcsize('P')*8))" 2>&1 | Out-String).Trim()
        $versionMatch = [regex]::Match($pythonOutput, "^(?<version>\d+\.\d+\.\d+)\|(?<bits>\d+)$")
        if ($versionMatch.Success) {
            $pythonVersion = [version]$versionMatch.Groups["version"].Value
            $pythonBits = [int]$versionMatch.Groups["bits"].Value
            $pythonSupported = $pythonVersion.Major -eq 3 -and $pythonVersion.Minor -ge 11 -and $pythonVersion.Minor -le 13 -and $pythonBits -eq 64
            if ($pythonSupported) {
                Write-Check "Python version" "PASS" "Python $pythonVersion ($pythonBits-bit) at $($pythonCommand.Source)."
            } elseif ($Stage -eq "Ready") {
                Write-Check "Python version" "BLOCKED" "Python $pythonVersion ($pythonBits-bit) is unsupported; use 64-bit Python 3.11-3.13." -Blocking
            } else {
                Write-Check "Python version" "WARN" "Python $pythonVersion ($pythonBits-bit) is not in the supported 64-bit Python 3.11-3.13 range."
            }
        } else {
            if ($Stage -eq "Ready") {
                Write-Check "Python version" "BLOCKED" "Could not read a supported Python version: $pythonOutput" -Blocking
            } else {
                Write-Check "Python version" "WARN" "Could not read a supported Python version: $pythonOutput"
            }
        }
    }

    $pgServices = @(Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue)
    $pgRunning = @($pgServices | Where-Object { $_.Status -eq "Running" })
    $pgListeners = Get-ListenerReport -Port $PostgresPort
    $pgReady = $false
    $pgIsReady = Get-Command pg_isready -ErrorAction SilentlyContinue
    if ($pgIsReady -and $pgListeners) {
        & $pgIsReady.Source -h 127.0.0.1 -p $PostgresPort | Out-Null
        $pgReady = $LASTEXITCODE -eq 0
    }
    $pgLoopback = $pgListeners.Count -gt 0 -and @($pgListeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0
    if ($pgRunning.Count -gt 0 -and $pgReady -and $pgLoopback) {
        Write-Check "PostgreSQL availability" "PASS" "Running service(s): $($pgRunning.Name -join ', '); pg_isready succeeds on 127.0.0.1:$PostgresPort."
    } elseif ($pgListeners.Count -gt 0 -and -not $pgLoopback) {
        Write-Check "PostgreSQL availability" "BLOCKED" "A listener on port $PostgresPort is not loopback-only." -Blocking
    } elseif ($Stage -eq "Ready") {
        Write-Check "PostgreSQL availability" "BLOCKED" "A running PostgreSQL service, pg_isready, and a loopback-only listener on port $PostgresPort are required." -Blocking
    } else {
        Write-Check "PostgreSQL availability" "WARN" "Not ready yet. Install/configure a supported PostgreSQL service and client, then rerun with -Stage Ready."
    }
    $postgresToolNames = @("psql", "pg_dump", "pg_restore")
    $missingPostgresTools = @($postgresToolNames | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) })
    if ($missingPostgresTools.Count -eq 0) {
        Write-Check "PostgreSQL admin/backup tools" "PASS" "psql, pg_dump, and pg_restore are available on PATH."
    } elseif ($Stage -eq "Ready") {
        Write-Check "PostgreSQL admin/backup tools" "BLOCKED" "Missing required client tools: $($missingPostgresTools -join ', ')." -Blocking
    } else {
        Write-Check "PostgreSQL admin/backup tools" "WARN" "Install client tools before final readiness: $($missingPostgresTools -join ', ')."
    }

    $redisServices = if ($RedisServiceName) {
        @(Get-Service -Name $RedisServiceName -ErrorAction SilentlyContinue)
    } else {
        @(Get-Service -Name "Redis*", "Memurai*", "KeyDB*" -ErrorAction SilentlyContinue)
    }
    $redisRunning = @($redisServices | Where-Object { $_.Status -eq "Running" })
    $redisListeners = Get-ListenerReport -Port $RedisPort
    $redisCli = Get-Command redis-cli -ErrorAction SilentlyContinue
    $redisReady = $false
    if ($redisCli -and $redisListeners) {
        $redisOutput = (& $redisCli.Source -h 127.0.0.1 -p $RedisPort ping 2>&1 | Out-String).Trim()
        $redisReady = $LASTEXITCODE -eq 0 -and $redisOutput -eq "PONG"
    }
    $redisLoopback = $redisListeners.Count -gt 0 -and @($redisListeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0
    if ($redisRunning.Count -gt 0 -and $redisReady -and $redisLoopback) {
        Write-Check "Redis-compatible service availability" "PASS" "Running service(s): $($redisRunning.Name -join ', '); unauthenticated localhost PING succeeds."
    } elseif ($redisListeners.Count -gt 0 -and -not $redisLoopback) {
        Write-Check "Redis-compatible service availability" "BLOCKED" "A listener on port $RedisPort is not loopback-only." -Blocking
    } elseif ($Stage -eq "Ready") {
        Write-Check "Redis-compatible service availability" "BLOCKED" "A supported running service, redis-cli PING, and a loopback-only listener on port $RedisPort are required. If ACLs require authentication, validate securely without putting credentials on a command line." -Blocking
    } else {
        Write-Check "Redis-compatible service availability" "WARN" "Not ready yet. Install/configure a supported Windows-compatible Redis service and client, then rerun with -Stage Ready."
    }

    Test-LoopbackListeners -Port $PostgresPort -Name "PostgreSQL listener binding" -Required ($pgListeners.Count -gt 0)
    Test-LoopbackListeners -Port $RedisPort -Name "Redis listener binding" -Required ($redisListeners.Count -gt 0)
    Test-LoopbackListeners -Port $ApiPort -Name "API port availability" -Required $false
    Test-LoopbackListeners -Port $AdminPort -Name "Admin web port availability" -Required $false
}
catch {
    Write-Output "BLOCKED: Pre-install check failed: $($_.Exception.Message)"
    exit 2
}

if ($blockers.Count -gt 0) {
    Write-Output "RESULT: BLOCKED ($($blockers.Count) blocking check(s)): $($blockers -join ', ')"
    exit 1
}
if ($warnings.Count -gt 0) {
    Write-Output "RESULT: PRE-INSTALL ONLY ($($warnings.Count) dependency warning(s)): $($warnings -join ', ')"
    exit 0
}
Write-Output "RESULT: READY checks passed for the selected stage '$Stage'. This does not authorize or perform deployment."
