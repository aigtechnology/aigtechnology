[CmdletBinding()]
param(
    [ValidateSet("Audit", "Test", "Prepare")]
    [string]$Mode = "Audit",
    [string]$InstallRoot = "$env:ProgramFiles\AIGTechnology\backend",
    [string]$DataRoot = "$env:ProgramData\AIGTechnology",
    [string]$ServiceName = "AigTechnologyBackend",
    [string]$ServiceAccount = "svc_aig_backend",
    [string]$RedisServiceName = "",
    [string]$WinSWPath = "",
    [switch]$CreateServiceAccount,
    [switch]$InstallPythonDependencies,
    [switch]$RegisterService
)

$ErrorActionPreference = "Stop"
$serverRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$supportedServerBuild = 20348

function Write-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $state = if ($Passed) { "PASS" } else { "BLOCKED" }
    Write-Output ("{0}: {1} - {2}" -f $state, $Name, $Detail)
}

function Assert-SupportedWindowsServer {
    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    if ([int]$os.ProductType -eq 1 -or $build -lt $supportedServerBuild) {
        throw "Production preparation requires supported Windows Server 2022 or newer. Detected $($os.Caption), build $build (client ProductType=$($os.ProductType)). No compatibility bypass is provided."
    }
}

function Invoke-IsolatedTests {
    $python = Join-Path $serverRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw "Test mode requires the workspace .venv\Scripts\python.exe. No dependencies were installed."
    }
    $backendSource = Join-Path $serverRoot "backend"
    if (-not (Test-Path -LiteralPath (Join-Path $backendSource "tests\test_checkout.py") -PathType Leaf)) {
        throw "Test mode requires the full source checkout and backend tests; tests are intentionally excluded from the transfer package."
    }

    $testEnvironment = Join-Path $env:TEMP ("aig-test-env-{0}.env" -f [guid]::NewGuid())
    $testVariableNames = @(
        "AIG_ENV_FILE", "APP_ENV", "DATABASE_URL", "SESSION_SECRET", "ADMIN_ORIGIN",
        "STOREFRONT_ORIGIN", "CORS_ALLOWED_ORIGINS", "RATE_LIMIT_STORAGE_URI",
        "FIREBASE_PROJECT_ID", "PAYMENT_PROVIDER", "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "FLIPKART_APP_ID",
        "FLIPKART_APP_SECRET", "FLIPKART_ACCESS_TOKEN", "FLIPKART_API_BASE_URL",
        "FLIPKART_LOCATION_ID"
    )
    $originalEnvironment = @{}
    foreach ($name in $testVariableNames) {
        $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    }
    $env:AIG_ENV_FILE = $testEnvironment
    $env:APP_ENV = "test"
    $env:DATABASE_URL = "sqlite://"
    $env:SESSION_SECRET = "isolated-test-only-session-secret-not-for-deployment"
    $env:ADMIN_ORIGIN = "http://localhost:5500"
    $env:STOREFRONT_ORIGIN = "http://localhost:8000"
    $env:CORS_ALLOWED_ORIGINS = ""
    $env:RATE_LIMIT_STORAGE_URI = ""
    $env:FIREBASE_PROJECT_ID = "aig-windows-test.invalid"
    $env:PAYMENT_PROVIDER = "mock"
    $env:RAZORPAY_KEY_ID = ""
    $env:RAZORPAY_KEY_SECRET = ""
    $env:RAZORPAY_WEBHOOK_SECRET = ""
    $env:FLIPKART_APP_ID = ""
    $env:FLIPKART_APP_SECRET = ""
    $env:FLIPKART_ACCESS_TOKEN = ""
    $env:FLIPKART_API_BASE_URL = "https://test.invalid"
    $env:FLIPKART_LOCATION_ID = "test-only"

    $locationPushed = $false
    try {
        Push-Location $backendSource
        $locationPushed = $true
        & $python -m pytest -q
        if ($LASTEXITCODE -ne 0) { throw "Isolated backend tests failed with exit code $LASTEXITCODE." }
        & $python -m compileall -q app migrations tests
        if ($LASTEXITCODE -ne 0) { throw "Python compilation failed with exit code $LASTEXITCODE." }
        Write-Check "Isolated backend tests and compilation" $true "SQLite, mock payments, fake Firebase project, and empty payment credentials were used."
    }
    finally {
        if ($locationPushed) { Pop-Location }
        foreach ($name in $testVariableNames) {
            [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], "Process")
        }
        if (Test-Path -LiteralPath $testEnvironment) { Remove-Item -LiteralPath $testEnvironment }
    }
}

if ($Mode -eq "Test") {
    Invoke-IsolatedTests
    return
}

$osInfo = Get-CimInstance Win32_OperatingSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name
$buildNumber = [int]$osInfo.BuildNumber
$isServer = [int]$osInfo.ProductType -ne 1
$isSupportedHost = $isServer -and $buildNumber -ge $supportedServerBuild

Write-Output "Host: $($osInfo.Caption), build $buildNumber, CPU: $cpuInfo"
Write-Check "Production host OS" $isSupportedHost $(if ($isSupportedHost) { "Server SKU/build meets the script's Windows Server 2022+ floor; verify Microsoft's lifecycle and hardware lists before production." } else { "Client Windows or older Server is not accepted for production service setup." })

foreach ($tool in @("python", "psql", "pg_dump", "redis-cli", "cloudflared")) {
    $command = Get-Command $tool -ErrorAction SilentlyContinue
    Write-Check $tool ($null -ne $command) $(if ($command) { $command.Source } else { "Not found on PATH; no downloads or installations were performed." })
}

$serviceNames = @("postgresql*", "redis*", "AigTechnologyBackend")
foreach ($pattern in $serviceNames) {
    $found = Get-Service -Name $pattern -ErrorAction SilentlyContinue
    foreach ($service in $found) {
        Write-Output ("SERVICE: {0} status={1} start={2}" -f $service.Name, $service.Status, $service.StartType)
    }
}

foreach ($port in @(5432, 6379, 8000)) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $listeners) {
        Write-Output "LISTENER: port $port not listening"
        continue
    }
    foreach ($listener in $listeners) {
        $loopback = $listener.LocalAddress -in @("127.0.0.1", "::1")
        Write-Check "Listener $port" $loopback "Address $($listener.LocalAddress)"
    }
}

if ($Mode -eq "Audit") { return }

Assert-SupportedWindowsServer
if ($ServiceName -notmatch "^[A-Za-z0-9_.-]{1,80}$") {
    throw "ServiceName may contain only 1-80 ASCII letters, digits, dot, underscore, or hyphen."
}
if ($ServiceAccount -notmatch "^[A-Za-z0-9._-]{1,20}$") {
    throw "ServiceAccount must be a 1-20 character local account name using ASCII letters, digits, dot, underscore, or hyphen."
}
if ($RegisterService -and (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Output "Windows service '$ServiceName' already exists. It and its configuration were left unchanged."
    return
}
if ($RegisterService) {
    if (-not $WinSWPath -or -not (Test-Path -LiteralPath $WinSWPath -PathType Leaf)) {
        throw "Provide a separately obtained and verified WinSW executable with -WinSWPath. The script does not download binaries."
    }
    if ([IO.Path]::GetFileName($WinSWPath) -ne "$ServiceName.exe") {
        throw "WinSW must be named '$ServiceName.exe' so its adjacent service configuration can be resolved."
    }
    $wrapperSignature = Get-AuthenticodeSignature -FilePath $WinSWPath
    if ($wrapperSignature.Status -ne "Valid") { throw "WinSW Authenticode signature is not valid. Service registration refused." }
    $prospectiveConfig = Join-Path (Split-Path -Parent $WinSWPath) "$ServiceName.xml"
    if (Test-Path -LiteralPath $prospectiveConfig) {
        throw "Refusing to overwrite existing service config: $prospectiveConfig"
    }
}
$preInstallCheck = Join-Path $PSScriptRoot "PRE_INSTALL_CHECK.ps1"
if (-not (Test-Path -LiteralPath $preInstallCheck -PathType Leaf)) {
    throw "Required pre-install check is missing: $preInstallCheck"
}
& $preInstallCheck -Stage Ready -InstallRoot $InstallRoot -DataRoot $DataRoot -RedisServiceName $RedisServiceName
if ($LASTEXITCODE -ne 0) { throw "Pre-install checks did not pass; no setup changes were made." }

if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    throw "Application installation folder does not exist: $InstallRoot. Deploy reviewed application files there separately; setup will not copy or overwrite them."
}

if ($InstallPythonDependencies) {
    $requirements = Join-Path $InstallRoot "requirements.txt"
    $venv = Join-Path $InstallRoot ".venv"
    if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) {
        throw "Runtime requirements file is missing: $requirements"
    }
    if (Test-Path -LiteralPath $venv) {
        throw "Refusing to modify existing virtual environment '$venv'. Review it separately or choose a new install root."
    }
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw "Install a supported Python runtime from its trusted source before requesting Python dependency installation." }
    & $pythonCommand.Source -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create the new virtual environment." }
    $venvPython = Join-Path $venv "Scripts\python.exe"
    & $venvPython -m pip install -r $requirements
    if ($LASTEXITCODE -ne 0) { throw "Runtime dependency installation failed. The new virtual environment was retained for review; existing data was not replaced." }
    Write-Output "PASS: runtime requirements installed into a newly created virtual environment."
}

$managedPaths = @{
    Config = Join-Path $DataRoot "Config"
    Logs = Join-Path $DataRoot "Logs"
    Backups = Join-Path $DataRoot "Backups"
}
$createdManagedPaths = @{}
if ($CreateServiceAccount -or $RegisterService) {
    $existingAccount = Get-LocalUser -Name $ServiceAccount -ErrorAction SilentlyContinue
    if (-not $existingAccount -and $CreateServiceAccount) {
        $password = Read-Host "Enter a unique password for local service account $ServiceAccount" -AsSecureString
        New-LocalUser -Name $ServiceAccount -Password $password -Description "Least-privilege AIG Technology backend service" -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
        $existingAccount = Get-LocalUser -Name $ServiceAccount
    }
    if (-not $existingAccount) { throw "Service account '$ServiceAccount' does not exist. Use -CreateServiceAccount first." }
    $accountSid = $existingAccount.SID.Value
    $adminGroup = Get-LocalGroupMember -Group "Administrators" -ErrorAction SilentlyContinue
    if ($adminGroup | Where-Object { $_.SID.Value -eq $accountSid }) {
        throw "Service account '$ServiceAccount' is an administrator. Remove unnecessary administrator membership before continuing."
    }

    foreach ($entry in $managedPaths.GetEnumerator()) {
        $createdManagedPaths[$entry.Key] = -not (Test-Path -LiteralPath $entry.Value -PathType Container)
        if ($createdManagedPaths[$entry.Key]) {
            New-Item -ItemType Directory -Path $entry.Value | Out-Null
        }
    }

    $identity = "$env:COMPUTERNAME\$ServiceAccount"
    & icacls.exe $InstallRoot /grant "${identity}:(OI)(CI)RX" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not grant inherited read/execute access on the application directory." }

    foreach ($key in @("Config", "Logs")) {
        $directory = $managedPaths[$key]
        $rights = if ($key -eq "Config") { "R" } else { "M" }
        if ($createdManagedPaths[$key]) {
            $aclRights = if ($key -eq "Config") { "RX" } else { "M" }
            & icacls.exe $directory /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${identity}:(OI)(CI)$aclRights" | Out-Null
        } else {
            & icacls.exe $directory /grant "${identity}:(OI)(CI)$rights" | Out-Null
            Write-Warning "Existing $key directory permissions were preserved. Review its ACL manually; existing users may retain access."
        }
        if ($LASTEXITCODE -ne 0) { throw "Could not apply service account permissions to $key." }
    }
    if ($createdManagedPaths.Backups) {
        & icacls.exe $managedPaths.Backups /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not restrict permissions on the new backup directory." }
    } else {
        Write-Warning "Existing Backups directory permissions were preserved. Review its ACL manually."
    }
    Write-Output "Service account is a standard local user with app Read/Execute, config Read, and log Modify access. Existing directory ACLs were not replaced."
}
else {
    foreach ($path in $managedPaths.Values) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            New-Item -ItemType Directory -Path $path | Out-Null
            $createdManagedPaths[(Split-Path -Leaf $path)] = $true
        }
    }
}

if ($RegisterService) {
    $appEntry = Join-Path $InstallRoot "app\main.py"
    $python = Join-Path $InstallRoot ".venv\Scripts\python.exe"
    $environmentFile = Join-Path $DataRoot "Config\backend.env"
    if (-not (Test-Path -LiteralPath $appEntry) -or -not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $environmentFile)) {
        throw "Reviewed app, virtual environment, or external environment file is missing. Service registration refused."
    }
    $serviceConfig = Join-Path (Split-Path -Parent $WinSWPath) "$ServiceName.xml"
    if (Test-Path -LiteralPath $serviceConfig) { throw "Refusing to overwrite existing service config: $serviceConfig" }
    $escapedPython = [System.Security.SecurityElement]::Escape($python)
    $escapedInstall = [System.Security.SecurityElement]::Escape($InstallRoot)
    $escapedLogs = [System.Security.SecurityElement]::Escape((Join-Path $DataRoot "Logs"))
    $config = @"
<service>
  <id>$ServiceName</id>
  <name>AIG Technology Backend</name>
  <description>FastAPI backend bound to localhost behind the Cloudflare Tunnel.</description>
  <executable>$escapedPython</executable>
  <arguments>-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2</arguments>
  <workingdirectory>$escapedInstall</workingdirectory>
  <env name="AIG_ENV_FILE" value="$([System.Security.SecurityElement]::Escape($environmentFile))" />
  <logpath>$escapedLogs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10485760</sizeThreshold><keepFiles>10</keepFiles></log>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
</service>
"@
    $credential = Get-Credential -UserName "$env:COMPUTERNAME\$ServiceAccount" -Message "Credentials are passed securely to the Windows Service Control Manager; do not paste them into commands or logs."
    if (-not $credential) { throw "Service registration cancelled; no service configuration was written." }
    if (Test-Path -LiteralPath $serviceConfig) { throw "Refusing to overwrite existing service config: $serviceConfig" }
    $temporaryConfig = "$serviceConfig.$([guid]::NewGuid().ToString('N')).tmp"
    $configCreatedByThisRun = $false
    $temporaryConfigCreatedByThisRun = $false
    $temporaryStream = $null
    try {
        $temporaryStream = [System.IO.File]::Open(
            $temporaryConfig,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $temporaryConfigCreatedByThisRun = $true
        $configBytes = [System.Text.Encoding]::UTF8.GetBytes($config)
        $temporaryStream.Write($configBytes, 0, $configBytes.Length)
        $temporaryStream.Dispose()
        $temporaryStream = $null
        [System.IO.File]::Move($temporaryConfig, $serviceConfig)
        $temporaryConfigCreatedByThisRun = $false
        $configCreatedByThisRun = $true
        New-Service -Name $ServiceName -DisplayName "AIG Technology Backend" -BinaryPathName "`"$WinSWPath`"" -Credential $credential -StartupType Automatic | Out-Null
        & sc.exe config $ServiceName start= delayed-auto
        if ($LASTEXITCODE -ne 0) { throw "Delayed automatic service start configuration failed with exit code $LASTEXITCODE." }
        & sc.exe failure $ServiceName reset= 86400 actions= restart/10000/restart/30000
        if ($LASTEXITCODE -ne 0) { throw "Windows service recovery configuration failed with exit code $LASTEXITCODE." }
    }
    catch {
        if ($configCreatedByThisRun -and -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $serviceConfig)) {
            Remove-Item -LiteralPath $serviceConfig
        }
        throw
    }
    finally {
        if ($temporaryStream) { $temporaryStream.Dispose() }
        if ($temporaryConfigCreatedByThisRun -and (Test-Path -LiteralPath $temporaryConfig)) {
            Remove-Item -LiteralPath $temporaryConfig
        }
    }
    Write-Output "Service registered but not started. Review service account ACLs, environment file, HTTPS tunnel, and database readiness before starting."
}

Write-Output "Preparation complete. PostgreSQL/Redis configuration and service startup were not changed."
