# チャットが置いた記録を、自動でアプリに反映させる常駐を入れる。
#
# 【何をするか】
# scripts/watch-inbox.mjs を「スタートアップ」に登録する。
# パソコンにログオンすると裏で動きはじめ、inbox にファイルが置かれた
# 【数秒後】に取り込む。15分待つ必要はない。
#
# 【タスクスケジューラを使わない理由】
# 管理者権限や書式の制約でつまずきやすい。実際に登録が弾かれた。
# スタートアップフォルダに置くだけなら特別な権限が要らず、
# 何が動いているかもエクスプローラーで見える。やめるのも消すだけ。
#
# 【このファイルは BOM 付き UTF-8 で保存すること】
# Windows PowerShell 5.1 は BOM が無いと cp932 として読み、日本語が化けて構文エラーになる。
#
# 【使い方】
#   入れる:     powershell -ExecutionPolicy Bypass -File scripts/setup-auto-apply.ps1
#   やめる:     powershell -ExecutionPolicy Bypass -File scripts/setup-auto-apply.ps1 -Remove
#   様子を見る: Get-Content "$env:USERPROFILE\jisui-auto-apply.log" -Tail 30

param([switch]$Remove)

$repo    = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$startup = [Environment]::GetFolderPath('Startup')
$vbs     = Join-Path $startup "kurashi-watch-inbox.vbs"
$log     = Join-Path $env:USERPROFILE "jisui-auto-apply.log"

if ($Remove) {
  if (Test-Path $vbs) { Remove-Item -LiteralPath $vbs -Force; Write-Output "やめました: $vbs" }
  else { Write-Output "入っていませんでした" }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*watch-inbox*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output "止めました: pid $($_.ProcessId)" }
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node が見つかりません。Node.js を入れてから実行してください。" }

# 窓を出さずに動かすための小さな入れ物。0 = 隠す、$false = 終わるのを待たない。
#
# 【配列の中の連結は、要素ごとに括弧でくくること】
# PowerShell はカンマを + より強く結びつける。括弧が無いと
#   @( "a", "b", "c" + $q + "d" )
# は 『("a","b","c") + $q + ("d")』、つまり配列どうしの連結と読まれ、
# 引用符が1要素ずつバラバラの配列になる。
# Set-Content はそれを1要素1行で書くので、行が割れた VBScript ができる。
# 構文が壊れているので wscript は何も言わずに終わり、「入れました」とだけ出て
# 常駐は一度も動かなかった。実際にそうなっていた。
$q = '"'
$cmd = $q + $node + $q + " " + $q + (Join-Path $repo "scripts\watch-inbox.mjs") + $q
$lines = @(
  ("' くらし: チャットが置いた記録を自動でアプリに反映する常駐。"),
  ("' scripts/setup-auto-apply.ps1 が作ったもの。このファイルを消せば止まる。"),
  ("Set sh = CreateObject(" + $q + "WScript.Shell" + $q + ")"),
  ("sh.CurrentDirectory = " + $q + $repo + $q),
  ("sh.Run " + $q + ($cmd -replace '"', '""') + $q + ", 0, False")
)
# 【UTF-16 で書く】。Windows Script Host は BOM 付き UTF-8 の .vbs を
# 読めないことがある。日本語のコメントを残したまま確実に動かすため。
Set-Content -LiteralPath $vbs -Value $lines -Encoding Unicode

# 【書けたかを、書いた本人が確かめる】
# 前は「入れました」と出すだけで、中身が壊れていても気づけなかった。
$check = Get-Content -LiteralPath $vbs -Encoding Unicode
if ($check.Count -ne 5 -or $check[2] -notlike "Set sh = CreateObject(*WScript.Shell*)") {
  throw "作った .vbs が壊れています($($check.Count) 行)。中身: $($check -join ' / ')"
}

Write-Output "入れました: $vbs"
Write-Output "  見張る場所: $env:USERPROFILE\jisui\inbox"
Write-Output "  ログ      : $log"
Write-Output ""
Write-Output "いま動かします..."
Start-Process -FilePath "wscript.exe" -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
Start-Sleep -Seconds 6

# 【動いたことを目で確かめてから「入りました」と言う】
# ログオンのたびに黙って失敗する常駐がいちばん困る。
$proc = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*watch-inbox*" })
if ($proc.Count -gt 0) {
  Write-Output ("動いています: pid " + ($proc.ProcessId -join ", "))
} else {
  Write-Output "動きませんでした。ログを見てください: $log"
  Write-Output "  (すでに別の見張りが動いていた場合も、ここに出ないことがあります)"
}
Write-Output ""
if (Test-Path $log) { Get-Content $log -Tail 8 } else { Write-Output "(まだログがありません)" }
Write-Output ""
Write-Output "次からはログオンで自動的に動きます。"
