# Push Plastic Hunter to GitHub (run after: gh auth login)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

$repoName = "plastic-hunter-v5"
Write-Host "Checking GitHub login..."
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Run: gh auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "Creating public repo: $repoName"
gh repo create $repoName --public --source=. --remote=origin --push --description "Tho San Nhua - plastic hunting web game"

if ($LASTEXITCODE -eq 0) {
    $url = gh repo view --json url -q .url
    Write-Host ""
    Write-Host "Done! Repo URL: $url" -ForegroundColor Green
    Write-Host "Deploy on Vercel: import this repo, framework = Other, build = npm run build, output = dist"
}