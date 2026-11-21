#requires -version 5.1
<#
  verify-clean-machine.ps1 — 离线干净机验收的只读环境快照

  用途：在一台"准备用来做断网冷启动验收"的 Windows 上运行，记录：
    - 系统版本、是否虚拟机、Hypervisor 是否存在
    - 是否装了 Node/npm/Python/Chrome（证明这不是开发机）
    - Windows Sandbox / Hyper-V 相关可执行文件是否存在
    - 指定 ZIP 与 exe 的 SHA-256
    - 当前是否存在 NormalMap Desktop 进程
    - 网卡状态（配合手工 ping 截图使用）

  本脚本只读环境，不启动被测程序、不改系统设置、不联网、不安装任何东西。

  重要：本脚本尚未在目标环境执行过（编写时的执行会话没有命令执行权限）。
  如果报错，请按 docs/OFFLINE_CLEAN_ACCEPTANCE.md 第 2、3、7 节的手工命令操作，
  并把报错原文写进记录，不要跳过。

  用法：
    powershell -ExecutionPolicy Bypass -File .\verify-clean-machine.ps1 `
      -ZipPath "C:\NMO-Test\NormalMap Desktop-1.0.0-win32-x64.zip" `
      -AppDir  "C:\NMO-Test\NormalMap Desktop-1.0.0-win32-x64"
#>

param(
    [string]$ZipPath = "",
    [string]$AppDir = "",
    [string]$OutFile = "offline-clean-record.json"
)

$ErrorActionPreference = 'Continue'
$record = [ordered]@{}
$record.probeAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
$record.script = "tests/offline-clean/verify-clean-machine.ps1"
$record.readOnly = $true

# --- 系统 ---
$host_ = [ordered]@{}
try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $host_.caption = $os.Caption
    $host_.version = $os.Version
    $host_.build = $os.BuildNumber
    $host_.architecture = $os.OSArchitecture
} catch {
    $host_.osError = $_.Exception.Message
}
try {
    $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    $host_.manufacturer = $cs.Manufacturer
    $host_.model = $cs.Model
    $host_.hypervisorPresent = $cs.HypervisorPresent
    $host_.totalMemoryGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
} catch {
    $host_.csError = $_.Exception.Message
}
$host_.isElevated = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(`
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$record.host = $host_

# --- 开发工具存在性 ---
$devTools = @()
foreach ($name in @('node', 'npm', 'python', 'python3', 'chrome', 'msedge', 'git')) {
    $cmd = Get-Command -Name $name -ErrorAction SilentlyContinue
    $entry = [ordered]@{ name = $name; found = [bool]$cmd }
    if ($cmd) { $entry.path = $cmd.Source }
    $devTools += $entry
}
$record.devTools = $devTools

# --- 虚拟化组件 ---
$virt = [ordered]@{}
$virt.windowsSandboxExe = Test-Path -LiteralPath "C:\Windows\System32\WindowsSandbox.exe"
$virt.hypervVmms = Test-Path -LiteralPath "C:\Windows\System32\vmms.exe"
$virt.hypervVmcompute = Test-Path -LiteralPath "C:\Windows\System32\vmcompute.exe"
$virt.virtualBoxDefault = Test-Path -LiteralPath "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
$virt.vmwareDefault = Test-Path -LiteralPath "C:\Program Files\VMware\VMware Workstation\vmrun.exe"
$virt.wslExe = Test-Path -LiteralPath "C:\Windows\System32\wsl.exe"

$features = @()
foreach ($f in @('Containers-DisposableClientVM', 'Microsoft-Hyper-V-All', 'VirtualMachinePlatform')) {
    try {
        $state = (Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction Stop).State
        $features += [ordered]@{ feature = $f; state = [string]$state }
    } catch {
        $features += [ordered]@{ feature = $f; state = 'unknown'; error = $_.Exception.Message }
    }
}
$virt.features = $features
$record.virtualization = $virt

# --- 哈希 ---
$hashes = [ordered]@{}
$hashes.zipPath = $ZipPath
$hashes.appDir = $AppDir
if ($ZipPath -and (Test-Path -LiteralPath $ZipPath)) {
    try {
        $h = Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256 -ErrorAction Stop
        $hashes.zipSha256 = $h.Hash
        $hashes.zipSizeBytes = (Get-Item -LiteralPath $ZipPath).Length
    } catch {
        $hashes.zipError = $_.Exception.Message
    }
} else {
    $hashes.zipError = 'not provided or not found'
}
if ($AppDir) {
    $exe = Join-Path $AppDir "NormalMap Desktop.exe"
    if (Test-Path -LiteralPath $exe) {
        try {
            $h2 = Get-FileHash -LiteralPath $exe -Algorithm SHA256 -ErrorAction Stop
            $hashes.exeSha256 = $h2.Hash
            $hashes.exeSizeBytes = (Get-Item -LiteralPath $exe).Length
        } catch {
            $hashes.exeError = $_.Exception.Message
        }
    } else {
        $hashes.exeError = "not found: $exe"
    }
}
$record.hashes = $hashes

# --- 进程与网卡 ---
$procs = @()
try {
    Get-Process -Name "NormalMap Desktop" -ErrorAction SilentlyContinue | ForEach-Object {
        $procs += [ordered]@{ id = $_.Id; startTime = $_.StartTime.ToString("yyyy-MM-ddTHH:mm:ss") }
    }
} catch {
    $procs += [ordered]@{ error = $_.Exception.Message }
}
$record.normalMapProcesses = $procs

$adapters = @()
try {
    Get-NetAdapter -ErrorAction Stop | ForEach-Object {
        $adapters += [ordered]@{ name = $_.Name; status = [string]$_.Status; linkSpeed = $_.LinkSpeed }
    }
} catch {
    $adapters += [ordered]@{ error = $_.Exception.Message }
}
$record.networkAdapters = $adapters
$record.note = "网卡状态只作参考；断网是否成立以 ping 8.8.8.8 的实际输出与截图为准"

# --- 输出 ---
try {
    $json = $record | ConvertTo-Json -Depth 6
    $full = [System.IO.Path]::GetFullPath($OutFile)
    [System.IO.File]::WriteAllText($full, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "written: $full"
} catch {
    Write-Output "ERROR writing $OutFile : $($_.Exception.Message)"
    exit 1
}

Write-Output "sandbox=$($virt.windowsSandboxExe) hyperv=$($virt.hypervVmms) vbox=$($virt.virtualBoxDefault) vmware=$($virt.vmwareDefault)"
exit 0
