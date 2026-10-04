[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$RemoteCommand)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskConfig = Join-Path $taskRoot 'artifacts\ssh\config'
if (!(Test-Path -LiteralPath $taskConfig)) {
    throw '本机连接配置不存在。请先配置项目专用 SSH 密钥及受信任的主机公钥；不要提交私钥。'
}
& ssh.exe -F $taskConfig aimisic-music @RemoteCommand
exit $LASTEXITCODE
