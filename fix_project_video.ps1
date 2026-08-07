# Script para re-encodar o vídeo de captura de tela de um projeto RecordSaaS,
# inserindo Keyframes (GOP) a cada 3s e ajustando CRF para equilíbrio entre tamanho e performance.

param (
    [string]$ProjectPath = "C:\Users\andre\OneDrive\Documentos\RecordSaaS\ReportandoBugV"
)

$ffmpegPath = "E:\GitHub\recordsaas-solutions\recordsaas\binaries\windows\ffmpeg.exe"
if (-not (Test-Path $ffmpegPath)) {
    $ffmpegPath = "ffmpeg"
}

Write-Host "==> Procurando vídeos no projeto: $ProjectPath" -ForegroundColor Cyan

if (-not (Test-Path $ProjectPath)) {
    Write-Error "Pasta do projeto não encontrada: $ProjectPath"
    exit 1
}

$screenFiles = Get-ChildItem -Path $ProjectPath -Filter "*screen*.mp4" | Where-Object { $_.Name -notmatch "\.bak$" }

if ($screenFiles.Count -eq 0) {
    Write-Error "Nenhum vídeo de tela (*screen*.mp4) encontrado na pasta do projeto."
    exit 1
}

foreach ($screenFile in $screenFiles) {
    $originalPath = $screenFile.FullName
    $backupPath = "$originalPath.bak"
    $tempFixedPath = Join-Path $ProjectPath "$($screenFile.BaseName)_fixed.mp4"

    Write-Host "`n[+] Processando: $($screenFile.Name)" -ForegroundColor Yellow

    # Restaurar do backup original se existir
    $sourceForEncode = $originalPath
    if (Test-Path $backupPath) {
        Write-Host "  -> Utilizando cópia original limpa (.bak) como fonte..."
        $sourceForEncode = $backupPath
    } else {
        Write-Host "  -> Criando backup original: $backupPath"
        Copy-Item -Path $originalPath -Destination $backupPath
    }

    # Re-encodar via FFmpeg com -g 180 (3s em 60fps) e CRF 22 para arquivo bem menor
    Write-Host "  -> Re-encodando com Keyframes a cada 3s (-g 180) e CRF 22 (tamanho otimizado)..." -ForegroundColor Cyan

    $ffmpegArgs = @(
        "-y",
        "-i", "`"$sourceForEncode`"",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-g", "180",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "`"$tempFixedPath`""
    )

    $cmd = "& `"$ffmpegPath`" $($ffmpegArgs -join ' ')"
    Invoke-Expression $cmd

    if ((Test-Path $tempFixedPath) -and ((Get-Item $tempFixedPath).Length -gt 0)) {
        $newSizeMB = [math]::Round((Get-Item $tempFixedPath).Length / 1MB, 2)
        Write-Host "  [OK] Re-encode concluído! Novo tamanho: $newSizeMB MB" -ForegroundColor Green
        # Substituir o original
        Move-Item -Path $tempFixedPath -Destination $originalPath -Force
        Write-Host "  [OK] Arquivo original substituído pela versão de 3s / CRF 22." -ForegroundColor Green
    } else {
        Write-Error "Falha no re-encode do arquivo $($screenFile.Name)"
    }
}

Write-Host "`n==> Concluído com sucesso!" -ForegroundColor Green
