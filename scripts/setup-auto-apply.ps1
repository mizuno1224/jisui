# チャットが置いた記録を、15分おきに自動でアプリへ入れる。
#
# 【何のためか】
# チャット(Cowork)はクラウドで動くのでデータベースに直接は届かない。
# 接続済みフォルダの inbox に JSON を置くところまではできるので、
# それを拾って入れる係を、パソコン側に常駐させる。
#
# これがあると、パソコンが起きている間は【貼り付けの操作が要らなくなる】。
# スマホしか無いときは、アプリの「チャットから取り込む」を使う。
#
# 【このファイルは BOM 付き UTF-8 で保存すること】
# Windows PowerShell 5.1 は BOM が無いと cp932 として読み、日本語が化けて構文エラーになる。
#
# 【使い方】
#   登録する:  powershell -ExecutionPolicy Bypass -File scripts/setup-auto-apply.ps1
#   やめる:    powershell -ExecutionPolicy Bypass -File scripts/setup-auto-apply.ps1 -Remove
#   様子を見る: Get-Content "$env:USERPROFILE\\jisui-auto-apply.log" -Tail 30

param([switch]$Remove)

$TaskName = "kurashi-apply-inbox"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$log  = Join-Path $env:USERPROFILE "jisui-auto-apply.log"

if ($Remove) {
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Output "やめました: $TaskName"
  } catch {
    Write-Output "登録されていませんでした($TaskName)"
  }
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node が見つかりません。Node.js を入れてから実行してください。" }

# 実行するもの。出力は追記でログに残す。
# 【--apply を付ける】。付けないと下見だけで何も入らない。
$inner = '& "' + $node + '" "' + (Join-Path $repo "scripts\apply-inbox.mjs") + '" --apply *>&1 | ' +
         'ForEach-Object { "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $_ } | ' +
         'Add-Content -Encoding utf8 "' + $log + '"'

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $inner.Replace('"','\"') + '"') `
  -WorkingDirectory $repo

# 15分おき。パソコンが寝ている間は動かない(それでよい)。
#
# 【ログオン時トリガに繰り返しを後付けしない】
# $trigger.Repetition に代入する書き方は、Windows の書式検査で弾かれる
# (HRESULT 0x80041318)。-Once のトリガに最初から繰り返しを持たせるのが正しい。
# ログオン時の1回は、別のトリガとして並べる。
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 15)
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$atLogon.Delay = "PT2M"
$trigger = @($every, $atLogon)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description "Cowork が inbox に置いた記録を Supabase へ入れる" | Out-Null

Write-Output "登録しました: $TaskName"
Write-Output "  対象      : $repo"
Write-Output "  ログ      : $log"
Write-Output "  間隔      : 15分ごと(ログオンの2分後から)"
Write-Output ""
Write-Output "いま1回動かして確かめます..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8
if (Test-Path $log) { Get-Content $log -Tail 12 } else { Write-Output "(まだログがありません。inbox が空なら何も出ません)" }
