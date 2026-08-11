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
# パスワードの入った cowork.json は入れない。zip は手で運ぶもので、
# 置き忘れると鍵がそのまま残る。Cowork 側は .env を自分で持っている。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage = Join-Path $env:TEMP ("jisui-skill-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($f in @("SKILL.md", "KAKEIBO.md", "db.py", "cowork.example.json", ".env.example")) {
  $s = Join-Path $src $f
  if (Test-Path $s) { Copy-Item $s (Join-Path $stage $f) -Force }
}

$desktop = [Environment]::GetFolderPath('Desktop')
$zip = Join-Path $desktop "jisui-skill.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
Remove-Item $stage -Recurse -Force

Write-Output ("zip    : " + $zip)
Write-Output ""
Write-Output "確認するには、チャットでもコードでも j.whoami() を呼ぶ"
Write-Output "  → 版 と このファイルの場所 が出る"
