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
| `04-ingress.yaml` | Ingress (ALB, has `${ALB_SUBNETS}` placeholder) |
| `env/dev.env`, `env/prod.env` | Per-environment values for the placeholders above |

**The numeric filename prefixes are deliberate, not cosmetic.**
`kubectl apply -f Deployment/` applies files in filename order; without the
prefixes, `02-deployment.yaml` (alphabetically before `00-namespace.yaml`
would be `deployment.yaml` < `namespace.yaml`) could get applied before the
Namespace exists, failing on first-ever creation. The prefixes force
Namespace → ServiceAccount → Deployment → Service → Ingress.

## Placeholders

Three placeholders, substituted via `envsubst` in `deploy/Jenkinsfile`
before `kubectl apply`:

- `${IMAGE}` — full image reference (`<ecr-repo-url>:<tag>`), built by the
  pipeline itself from the `ECR_REPOSITORY_URL` env var + the `IMAGE_TAG`
  parameter. Not in either `.env` file since it's the same repo across
  environments, only the tag changes per build.
- `${REPLICAS}`, `${ALB_SUBNETS}` — from `env/<environment>.env`.

To try this locally without Jenkins:

```bash
set -a; source Deployment/env/dev.env; set +a
export IMAGE="123456789012.dkr.ecr.eu-west-1.amazonaws.com/hello-world-app:v1.0.0"
mkdir -p /tmp/rendered
for f in Deployment/0*.yaml; do
  envsubst '${IMAGE} ${REPLICAS} ${ALB_SUBNETS}' < "$f" > "/tmp/rendered/$(basename "$f")"
done
kubectl apply -f /tmp/rendered   # or --dry-run=client to just check it parses
```

Adding a third environment: add `env/<name>.env`, add `<name>` to the
`choices` list in `deploy/Jenkinsfile`.
