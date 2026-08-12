# Cowork スキルを1か所から配り直す。
#
# 【なぜ要るか】
# このスキルは2か所に置かれている。
#   app/cowork/jisui/          … Cowork(チャット)が読む。git で管理する正本
#   ~/.claude/skills/jisui/    … Claude Code / デスクトップが読む
# 片方だけ直すと、古いほうが動き続ける。実際にそれで半日ぶんの記録が
# 別のデータベースに入り、どこにも届かない事故が起きた。
#
# 【このファイルは BOM 付き UTF-8 で保存すること】
# Windows PowerShell 5.1 は BOM が無いと cp932 として読むので、
# 日本語のコメントが化けて構文エラーになる。実際に一度なった。
#
# 【使い方】
#   powershell -ExecutionPolicy Bypass -File scripts/sync-skill.ps1
#
# 写すのと同時に、Cowork に読み込ませる zip もデスクトップに作る。
# ここも二度つまずいた場所なので、手で作らずこの script に任せること。
#   ・zip の中で SKILL.md が jisui\ の下に入っていると、Cowork が受け取らない
#     → 中身を直下に置く(CreateFromDirectory に渡すのは中身のフォルダ)
#   ・デスクトップは OneDrive に移されている。$env:USERPROFILE\Desktop は
#     画面に見えているデスクトップではない → GetFolderPath で本物を引く

$src = Join-Path $PSScriptRoot "..\cowork\jisui"
$dst = Join-Path $env:USERPROFILE ".claude\skills\jisui"

if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Force $dst | Out-Null }

# .env は写さない。あちらは夫のログイン、こちらは Cowork 専用ユーザーで
# 役割が違う。上書きすると手元の開発が別人として動きはじめる。
$files = @("SKILL.md", "KAKEIBO.md", "db.py", "cowork.json", "cowork.example.json", ".env.example")
foreach ($f in $files) {
  $s = Join-Path $src $f
  if (Test-Path $s) {
    Copy-Item $s (Join-Path $dst $f) -Force
    Write-Output ("{0,-24} {1,8:N0} bytes" -f $f, (Get-Item $s).Length)
  }
}
Write-Output ""
Write-Output ("seihon : " + $src)
Write-Output ("utsusi : " + $dst)

# ---------------------------------------------------------------- 差し替え用の zip
#
# 【cowork.json を必ず入れること】
# 一度これを「パスワードが入っているから」と外して zip を作り、
# それを入れた Cowork がログインできなくなった。
#   db.JisuiError: 接続情報が足りません: JISUI_SUPABASE_URL, ...
# クラウドの Cowork は .env を持てない。スキルに同梱された cowork.json が
# 唯一の鍵で、これが無いと何も読めないし書けない。
#
# .env は逆に入れない。あちらは Cowork 専用ユーザー、こちらは夫のログインで
# 役割が違う。混ぜると手元の開発が別人として動きはじめる。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage = Join-Path $env:TEMP ("jisui-skill-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $stage | Out-Null
$zipFiles = @("SKILL.md", "KAKEIBO.md", "db.py", "cowork.json", "cowork.example.json", ".env.example")
foreach ($f in $zipFiles) {
  $s = Join-Path $src $f
  if (Test-Path $s) { Copy-Item $s (Join-Path $stage $f) -Force }
}

# 【入ったかを確かめてから配ること】
# 抜けていても zip は普通に出来上がるので、目で見ないと気づけない。
if (-not (Test-Path (Join-Path $stage "cowork.json"))) {
  Remove-Item $stage -Recurse -Force
  throw "cowork.json が $src にありません。これが無いと Cowork はログインできません。cowork.example.json を写して作ってください。"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$zip = Join-Path $desktop "jisui-skill.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
Remove-Item $stage -Recurse -Force

Write-Output ("zip    : " + $zip)

# 中身を必ず見せる。抜けに気づけるのは、目で見たときだけ。
$check = [System.IO.Compression.ZipFile]::OpenRead($zip)
Write-Output "  中身:"
$check.Entries | ForEach-Object { Write-Output ("    " + $_.FullName) }
$check.Dispose()
Write-Output ""
Write-Output "※ この zip には cowork.json(ログイン情報)が入っています。"
Write-Output "   人に渡したり、共有フォルダに置いたりしないこと。"
Write-Output ""
# 【配る前に、その zip を実際に動かす】
# 「差し替えてください」と3回頼んで3回とも別の理由で動かなかった。
# どれも入れてもらってから判明した。頼む側が確かめずに頼んでいたのが原因。
Write-Output "--- 配る前の確認 ---"
& python (Join-Path $PSScriptRoot "check-skill-zip.py") $zip
if ($LASTEXITCODE -ne 0) {
  throw "この zip は使えません。上の × を直してから、もう一度 sync-skill.ps1 を実行してください。"
}
