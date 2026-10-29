# Terapkan semua migration di supabase/migrations/ ke remote Supabase.
# Membaca koneksi DB dari root .env (SUPABASE_DB_URL atau DATABASE_URL).
# Secret tidak pernah dicetak.
#
# Pemakaian:
#   1. Tambahkan ke root .env:
#        SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
#   2. powershell -File scripts/migrate.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'

if (-not (Test-Path $envPath)) {
    throw "File .env tidak ditemukan di $envPath"
}

$dbUrl = $null
foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    if ($t -match '^(SUPABASE_DB_URL|DATABASE_URL)\s*=\s*(.+)$') {
        $dbUrl = $Matches[2].Trim().Trim('"').Trim("'")
    }
}

if (-not $dbUrl) {
    throw @"
SUPABASE_DB_URL belum diisi di root .env.
Ambil connection string dari Supabase: Project Settings -> Database -> Connection string (URI),
ganti [YOUR-PASSWORD] dengan database password, lalu simpan baris:
  SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
"@
}

Write-Host "Menerapkan migration dari supabase/migrations/ ..."
Push-Location $root
try {
    & npx --yes supabase db push --db-url $dbUrl --include-all --yes
    if ($LASTEXITCODE -ne 0) { throw "supabase db push gagal (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
}
Write-Host "Migration selesai."
