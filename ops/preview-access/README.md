# Project test access protection

Deploy AppHub with the independent internal overlay `apphub-preview-auth`. Attach only AppHub and platform-owned preview access proxies, never uploaded application services. Set:

- APPHUB_PREVIEW_AUTH_NETWORK=apphub-preview-auth
- APPHUB_PREVIEW_AUTH_HOST=apphub-preview-auth (AppHub network alias)
- APPHUB_PREVIEW_PROXY_IMAGE=<private-registry-node-runtime>@sha256:<verified digest>

The runtime must contain `node` in PATH. The application image is pinned separately. The proxy has no Docker socket, platform secret or database connection. Swarm registry authentication must be forwarded during service creation or stack deploy (`--with-registry-auth`).

New managed test deployments remove `app.ports` and publish `preview_access` only. For existing tests, back up their compose and service specs, confirm no active builds, then remove raw application ports before creating the proxy. Persist the protected compose and both service network entries. Do not reopen anonymous ports on failure.

Validate anonymous domain and IP requests return 403; a platform-issued ticket grants access only for an active, authorized session. Check logout, membership removal, disabled identity, forged health probes, and scoped health readiness. Stop/resume must update both application and proxy replicas while retaining data volumes.

HTTP test previews are supported as configured. HTTP is not encrypted. HTTPS preview certificates should be configured when confidentiality on the transport is required.
