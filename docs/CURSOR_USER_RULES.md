# Reglas globales de Cursor para esta PC del trabajo

Este archivo contiene las reglas que tenés que pegar **una sola vez** en la
configuración de Cursor a nivel usuario. Una vez pegadas, aplican a **todos**
los proyectos que abras con este usuario de Windows, no solo a `barber-turnos`.

## Cómo instalarlas

1. En Cursor, abrí la configuración con `Ctrl+,`.
2. En el buscador escribí `Rules for AI`.
3. Pegá el bloque que está debajo (entre los marcadores) en el campo
   **User Rules** (no en Project Rules).
4. Guardá. No hace falta reiniciar.

La regla a nivel proyecto vive en [`.cursor/rules/pc-safety.mdc`](../.cursor/rules/pc-safety.mdc)
y se carga automáticamente al abrir este repo. Las dos se refuerzan entre sí.

---

## BLOQUE A PEGAR EN USER RULES

```
# Seguridad de la PC (Windows corporativa)

Esta PC es gestionada por la empresa. NUNCA modifiques el sistema operativo ni
escales privilegios para "desbloquear" una tarea. Si un comando falla por
permisos, UAC, ExecutionPolicy o similar, DETENETE e informá al usuario;
nunca intentes "arreglar" permisos, políticas, ownership, ni elevar privilegios.

## Regla de oro

- Si aparece "Access denied", "permiso denegado", UnauthorizedAccess, UAC, o
  "requires administrator": parar, explicar el error y sugerir una alternativa
  aislada (Docker, venv de Python, scope usuario).
- Trabajar siempre dentro del workspace del proyecto actual. Si hay que salir,
  preguntar primero.
- No ejecutar instaladores .msi ni .exe descargados de internet.
- No usar Start-Process -Verb RunAs, runas, ni bypasses de UAC.

## Comandos PROHIBIDOS

- Permisos NTFS y ownership: icacls, cacls, takeown, Set-Acl.
- Registro de Windows: reg add|delete|import, Set-ItemProperty /
  New-ItemProperty / Remove-ItemProperty sobre HKLM:\, HKCU:\, HKCR:\, HKU:\.
- Servicios: sc create|delete|config, Set-Service, Stop-Service /
  Start-Service de servicios del sistema, New-Service.
- Windows Defender y seguridad: Set-MpPreference, Add-MpPreference,
  deshabilitar protección en tiempo real, agregar exclusiones.
- Firewall y red: netsh advfirewall ..., New-NetFirewallRule,
  Set-NetFirewallRule, cambiar DNS / proxy, editar el archivo hosts.
- Arranque y disco: bcdedit, diskpart, Format-Volume, Clear-Disk,
  Remove-Partition, format de particiones.
- Cuentas y grupos locales: net user, net localgroup, New-LocalUser,
  Add-LocalGroupMember, Remove-LocalUser.
- Tareas programadas y GPO: schtasks /create|/delete|/change,
  Register-ScheduledTask, gpedit, gpupdate /force, secedit.
- Drivers y features del SO: pnputil, Install-WindowsFeature,
  Enable-WindowsOptionalFeature, DISM /Online /Enable-Feature.
- Políticas a nivel máquina: Set-ExecutionPolicy Unrestricted|Bypass
  con -Scope LocalMachine.
- Elevación: Start-Process -Verb RunAs, runas, cualquier bypass de UAC.
- Variables de entorno de máquina: setx /M,
  [Environment]::SetEnvironmentVariable(..., 'Machine').
- Escritura en rutas del sistema: C:\Windows\, C:\Program Files\,
  C:\Program Files (x86)\, C:\ProgramData\, %SystemRoot%\, drivers.

## Instalaciones

Prohibido system-wide:
- msiexec /i, .msi o .exe de instalación.
- choco install, winget install --scope machine.
- npm i -g, pip install contra el Python del sistema,
  Install-Module -Scope AllUsers.

Permitido (aislado al proyecto o scope usuario):
- npm install en el proyecto.
- python -m venv .venv + pip install dentro del venv.
- docker compose up para servicios del proyecto.
- git dentro del repo.
- winget install --scope user o pip install --user SOLO si el usuario lo pide
  explícitamente.

## Ante errores típicos

- "No puedo instalar X por permisos" -> avisar al usuario y sugerir Docker,
  venv o scope usuario. No pelear contra Windows.
- "ExecutionPolicy" bloqueando un script -> pedirle al usuario que lo habilite
  a mano en su sesión (Scope Process o CurrentUser), nunca LocalMachine.
- Variable de entorno faltante -> exportarla solo en el shell actual o
  guardarla en el .env del proyecto; jamás con setx /M.
- Si dudás, preguntá antes de ejecutar.
```

---

## Por qué este archivo existe

Un colega usó un agente de IA que, al no poder instalar una librería por
restricciones corporativas, terminó modificando permisos de Windows y rompió
su PC. Este repo y las reglas de arriba son para que eso no pase acá.

La protección son solo reglas textuales (el agente se compromete a respetarlas);
no hay un bloqueo técnico. Si querés reforzar con un hook que bloquee
programáticamente comandos peligrosos antes de que se ejecuten, se puede sumar
en el futuro.
