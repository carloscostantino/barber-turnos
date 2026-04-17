#!/usr/bin/env node
/*
 * Hook de seguridad para PC del trabajo (Windows corporativa).
 *
 * Se dispara ANTES de que Cursor ejecute cualquier comando shell.
 * Lee JSON de stdin, inspecciona el campo `.command` y si coincide con
 * patrones peligrosos devuelve `permission: "ask"` para que el usuario
 * confirme manualmente antes de correrlo.
 *
 * Si no coincide nada, devuelve `permission: "allow"` y Cursor sigue normal.
 *
 * Las reglas de texto acompañantes viven en:
 *   - .cursor/rules/pc-safety.mdc (proyecto)
 *   - docs/CURSOR_USER_RULES.md (bloque a pegar en Cursor -> User Rules)
 */

'use strict';

const DANGEROUS_PATTERNS = [
  { pattern: /\b(icacls|cacls|takeown)\b/i, reason: 'modifica permisos NTFS / ownership' },
  { pattern: /\bSet-Acl\b/i, reason: 'modifica ACLs' },
  { pattern: /\breg(\.exe)?\s+(add|delete|import)\b/i, reason: 'modifica registro de Windows (reg)' },
  { pattern: /\b(Set|New|Remove)-ItemProperty\b[^\n]*HK(LM|CU|CR|U):/i, reason: 'modifica registro de Windows (HK*)' },
  { pattern: /\bsc(\.exe)?\s+(create|delete|config|stop|start)\b/i, reason: 'manipula servicios del sistema (sc)' },
  { pattern: /\b(Set|New|Remove)-Service\b/i, reason: 'manipula servicios (PowerShell)' },
  { pattern: /\b(Set|Add)-MpPreference\b/i, reason: 'modifica Windows Defender' },
  { pattern: /\bnetsh\s+advfirewall\b/i, reason: 'modifica firewall (netsh advfirewall)' },
  { pattern: /\b(New|Set|Remove)-NetFirewallRule\b/i, reason: 'modifica reglas de firewall' },
  { pattern: /\bbcdedit\b/i, reason: 'modifica configuración de arranque (bcdedit)' },
  { pattern: /\bdiskpart\b/i, reason: 'manipula particiones (diskpart)' },
  { pattern: /\b(Format-Volume|Clear-Disk|Remove-Partition)\b/i, reason: 'operación destructiva de disco' },
  { pattern: /\bnet\s+(user|localgroup)\b/i, reason: 'modifica cuentas / grupos locales' },
  { pattern: /\b(New|Remove)-LocalUser\b/i, reason: 'modifica cuentas locales' },
  { pattern: /\bAdd-LocalGroupMember\b/i, reason: 'modifica grupos locales' },
  { pattern: /\bschtasks(\.exe)?\s+\/(create|delete|change)\b/i, reason: 'modifica tareas programadas' },
  { pattern: /\bRegister-ScheduledTask\b/i, reason: 'registra tarea programada' },
  { pattern: /\bgpupdate\b[^\n]*\/force\b/i, reason: 'fuerza Group Policy update' },
  { pattern: /\bsecedit\b/i, reason: 'modifica políticas de seguridad (secedit)' },
  { pattern: /\bpnputil\b/i, reason: 'instala/remueve drivers (pnputil)' },
  { pattern: /\bInstall-WindowsFeature\b/i, reason: 'instala features de Windows' },
  { pattern: /\bEnable-WindowsOptionalFeature\b/i, reason: 'activa features opcionales de Windows' },
  { pattern: /\bDISM(\.exe)?\b[^\n]*\/(Enable|Add)-/i, reason: 'modifica features con DISM' },
  { pattern: /\bSet-ExecutionPolicy\b[^\n]*(Unrestricted|Bypass)[^\n]*LocalMachine/i, reason: 'cambia ExecutionPolicy a nivel máquina' },
  { pattern: /\bStart-Process\b[^\n]*-Verb\s+RunAs\b/i, reason: 'intenta elevar privilegios (RunAs)' },
  { pattern: /(^|[\s;|&(])runas(\.exe)?\s/i, reason: 'ejecución como otro usuario (runas)' },
  { pattern: /\bsetx\s+\/M\b/i, reason: 'escribe variable de entorno de máquina (setx /M)' },
  { pattern: /SetEnvironmentVariable\([^)]*['"]Machine['"]/i, reason: 'escribe variable de entorno de máquina' },
  { pattern: /\bmsiexec(\.exe)?\b/i, reason: 'ejecuta instalador MSI' },
  { pattern: /\bchoco\s+install\b/i, reason: 'instalación system-wide con Chocolatey' },
  { pattern: /\bwinget\s+install\b[^\n]*--scope\s+machine\b/i, reason: 'winget install con scope machine' },
  { pattern: /\bnpm\s+(i|install|add)\s+(-g|--global)\b/i, reason: 'npm install global' },
  { pattern: /\bInstall-Module\b[^\n]*-Scope\s+AllUsers/i, reason: 'Install-Module para todos los usuarios' },
  { pattern: /\bdrivers\\etc\\hosts\b/i, reason: 'modifica archivo hosts' },
];

function decide(command) {
  const cmd = String(command || '');
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        permission: 'ask',
        user_message:
          `Hook pc-safety: el comando coincide con un patrón peligroso (${reason}). ` +
          `Revisalo antes de permitir.`,
        agent_message:
          `El hook de seguridad marcó este comando como peligroso (${reason}). ` +
          `Si es necesario, proponé una alternativa aislada (Docker, venv, scope usuario) ` +
          `o esperá a que el usuario lo apruebe manualmente.`,
      };
    }
  }
  return { permission: 'allow' };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const command = input.command || input.input?.command || '';
  const decision = decide(command);
  process.stdout.write(JSON.stringify(decision));
});
