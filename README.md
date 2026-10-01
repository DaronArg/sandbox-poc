# Assessment platform — POC

Monorepo: runtime Docker (code-server + Continue + telemetría), backend Spring Boot (sesiones, proxy git, gateway IA, vista del profesor) y el repo de examen.
Diseño completo: `openspec/changes/assessment-poc/design.md`.

Todo Docker y el backend corren **dentro de WSL Ubuntu** (distro en `E:\wsl\Ubuntu`). Los comandos de abajo se ejecutan desde PowerShell/Git Bash en Windows.

## Requisitos

- `.env` en la raíz (no versionado) con `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `AI_CHAT_MODEL`, `AI_AUTOCOMPLETE_MODEL`.
- WSL vivo (`vmIdleTimeout=-1` ya está en `.wslconfig`). Si Docker no responde: `wsl -d Ubuntu -u root -- systemctl start docker`.

## 1. Construir la imagen (una vez)

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/build-runtime.sh'
```

## 2. Levantar el backend (:9090)

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/run-backend.sh'
```

Queda en foreground; para dejarlo en background agregá `setsid nohup ... > /tmp/backend.log 2>&1 &` dentro del `bash -lc`.
Health check: http://localhost:9090/api/exams. H2 en archivo (`backend/data/`, gitignored): sesiones y eventos sobreviven al reinicio; para empezar de cero, borr� esa carpeta con el backend apagado.

## 3. Probar

1. Abrí http://localhost:9090, elegí alumno + examen, **Iniciar**.
2. Copiá el `docker run` que aparece y ejecutalo **en WSL** (`wsl -d Ubuntu`).
3. Abrí http://localhost:8080: IDE con el repo del examen clonado en el branch `session-<id>-<hex>`.
   - Terminal: `./mvnw test` (los tests fallan a propósito).
   - Panel **Continue** (barra lateral izquierda): el chat responde vía el gateway del backend.
   - `git add/commit/push` desde la terminal: va al backend, que reenvía a GitHub.
4. http://localhost:9090/professor.html: elegí la sesión y mirá la timeline (archivos, comandos, IA, push).

## Gotchas

- **Branches viejos en GitHub:** los ids de sesión reinician en 1 con cada reinicio del backend, y el branch es `session-<id>`. Si `git push` dice *rejected / fetch first*, borrá el branch viejo: `gh api -X DELETE repos/DaronArg/assessment-exam-template/git/refs/heads/session-1`.
- **CI no corre todavía:** el repo de examen se publicó sin `.github/workflows/ci.yml` porque el token de `gh` de DaronArg no tiene scope `workflow`. Para completarlo: `gh auth refresh -h github.com -s workflow`, copiar `exam-template/.github/workflows/ci.yml` al repo y pushear a `main`.
- Volumen del workspace persistente: `docker volume rm assessment_<id>_workspace` para empezar de cero.
- Smoke tests por slice en `scripts/smoke-*.sh` (se ejecutan dentro de WSL).
