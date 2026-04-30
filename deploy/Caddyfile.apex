# Mismo routing que Caddyfile, pero para dominio raíz + www.
# Requiere PUBLIC_HOST = apex (ej. agendaonline.com.ar). Registros DNS para @ y www → esta VM.
# Uso: en .env definí CADDY_DOCKERFILE=Caddyfile.apex

{$PUBLIC_HOST}, www.{$PUBLIC_HOST} {
	@www host www.{$PUBLIC_HOST}
	redir @www https://{$PUBLIC_HOST}{uri} permanent

	encode gzip

	handle /health {
		reverse_proxy http://api:3001
	}

	handle /api* {
		reverse_proxy http://api:3001
	}

	handle {
		reverse_proxy http://web:80
	}
}
