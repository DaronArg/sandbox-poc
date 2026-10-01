
## T0 — Entorno y scaffold
- WSL `Ubuntu` (26.04) movida a `E:\wsl\Ubuntu` (`wsl --manage --move`); `ext4.vhdx` verificado ahí.
- Docker 29.8.2 (get.docker.com, systemd) y OpenJDK 21 (apt) en WSL; usuario `daron` agregado al grupo `docker`. `~/.wslconfig` con `vmIdleTimeout=-1`.
- `.env` completado (GITHUB_TOKEN de la cuenta DaronArg, GITHUB_REPO, modelos). `ANTHROPIC_API_KEY` ya existía y no se tocó.
- Scaffold: carpetas con `.gitkeep`, `.gitattributes` (LF en sh/yaml/mvnw), `.claude/qa-config.md`.
- Verificación: `docker run hello-world` OK sin sudo, `java -version` 21.0.12, vhdx en E.
- ATENCIÓN T3: la cuenta activa `DaronArg` en gh tiene scopes `gist, read:org, repo` SIN `workflow`; pushear `.github/workflows/ci.yml` puede ser rechazado. Alternativa: `gh auth refresh -s workflow` (interactivo) o crear el workflow por la API/UI.
- Para mantener WSL vivo además de `vmIdleTimeout`: los procesos de background deben lanzarse dentro de WSL (p.ej. `wsl -d Ubuntu -- sleep infinity`).
