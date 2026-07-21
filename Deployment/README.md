# Deployment/

Plain Kubernetes manifests for `hello-world` — no Helm. This is the
primary deployment mechanism; `../helm/hello-world` is kept in the repo but
unused (see the top-level README).

## Files

| File | Kind |
| --- | --- |
| `00-namespace.yaml` | Namespace |
| `01-serviceaccount.yaml` | ServiceAccount |
| `02-deployment.yaml` | Deployment (has `${IMAGE}` / `${REPLICAS}` placeholders) |
| `03-service.yaml` | Service (ClusterIP) |
| `04-ingress.yaml` | Ingress (ALB, has `${ALB_SUBNETS}`, `${DOMAIN}`, `${CERT_ARN}` placeholders) |
| `env/dev.env`, `env/prod.env` | Per-environment values for the placeholders above |

**The numeric filename prefixes are deliberate, not cosmetic.**
`kubectl apply -f Deployment/` applies files in filename order; without the
prefixes, `02-deployment.yaml` (alphabetically before `00-namespace.yaml`
would be `deployment.yaml` < `namespace.yaml`) could get applied before the
Namespace exists, failing on first-ever creation. The prefixes force
Namespace → ServiceAccount → Deployment → Service → Ingress.

## Placeholders

Five placeholders, substituted via `envsubst` in `deploy/Jenkinsfile`
before `kubectl apply`:

- `${IMAGE}` — full image reference (`<ecr-repo-url>:<tag>`), built by the
  pipeline itself from the `ECR_REPOSITORY_URL` env var + the `IMAGE_TAG`
  parameter. Not in either `.env` file since it's the same repo across
  environments, only the tag changes per build.
- `${REPLICAS}`, `${ALB_SUBNETS}`, `${DOMAIN}`, `${CERT_ARN}` — from
  `env/<environment>.env`.

`${DOMAIN}`/`${CERT_ARN}` are still placeholders in both `.env` files
(`REPLACE-with-real-...`) — until you fill in a real subdomain + ACM
certificate ARN, the Ingress will render with a nonsense hostname and cert
ARN. That's syntactically valid (won't break `kubectl apply`), it just won't
resolve/serve HTTPS for real. To wire up a real domain you need, in order:
1. A Route53 hosted zone for the domain (or its parent).
2. An ACM certificate requested **in the same region as the ALB**
   (`eu-west-1`) — DNS-validated via a CNAME in that same hosted zone.
3. Once issued, the certificate's ARN → `CERT_ARN` in the matching `.env`.
4. The subdomain itself → `DOMAIN` in the matching `.env`. After the ALB
   exists, point an `A`/`ALIAS` record at it in Route53.

To try this locally without Jenkins:

```bash
set -a; source Deployment/env/dev.env; set +a
export IMAGE="123456789012.dkr.ecr.eu-west-1.amazonaws.com/hello-world-app:test"
mkdir -p /tmp/rendered
for f in Deployment/0*.yaml; do
  envsubst '${IMAGE} ${REPLICAS} ${ALB_SUBNETS} ${DOMAIN} ${CERT_ARN}' < "$f" > "/tmp/rendered/$(basename "$f")"
done
kubectl apply -f /tmp/rendered   # or --dry-run=client to just check it parses
```

Adding a third environment: add `env/<name>.env`, add `<name>` to the
`choices` list in `deploy/Jenkinsfile`.
