# hello-world-app

Node.js "hello world" app for the EKS POC — exposes `/`, `/health`, and
`/users`. Deployed to the EKS cluster provisioned by the
[`eks-poc`](../eks-poc) Terraform repo, behind a public ALB via the AWS Load
Balancer Controller already installed there.

This repo is deliberately separate from the Terraform repos — it owns the
app source, Dockerfile, Kubernetes manifests, and both Jenkins pipelines; it
has no Terraform in it. Deployment is via **plain Kubernetes YAML +
`kubectl apply`**, not Helm — see **Deployment** below.

**CI auto-deploys to dev; every other environment is manual.** A CI build on
`main` pushes the image and then automatically triggers the CD pipeline
against `dev` with no approval gate. Deploying to `prod` (or any future
environment) always means manually running the CD pipeline and clicking
through its approval gate — CI never does that itself. See **Jenkins job
setup** below for the two Jenkins jobs this needs.

## Endpoints

| Path | Response |
| --- | --- |
| `GET /` | `{"message": "Hello, World!", "host": "<pod-hostname>"}` |
| `GET /health` | `{"status": "ok", "uptime": <seconds>}` — used as the container healthcheck and the k8s liveness/readiness probe |
| `GET /users` | `{"users": [...]}` — static seed data, no database |

## Layout

```
hello-world-app/
├── src/                  # Express app
├── test/                 # node:test unit tests
├── Dockerfile
├── Jenkinsfile           # CI: npm ci/test → docker build → push to ECR
├── Deployment/           # Plain k8s YAML manifests (the active deployment path)
├── deploy/Jenkinsfile    # CD: envsubst → kubectl diff → manual approval → kubectl apply
└── helm/hello-world/     # Helm chart — kept, currently UNUSED (see below)
```

## Local development

```bash
npm ci
npm test
npm start   # listens on :3000
```

Or via Docker (no local Node needed):

```bash
docker build -t hello-world-app:local .
docker run --rm -p 3000:3000 hello-world-app:local
curl localhost:3000/health
curl localhost:3000/users
```

## CI pipeline (`Jenkinsfile`)

Checkout → `npm ci` → `npm test` → check the version isn't already
released → `docker build` → push to ECR → **on `main` only**, triggers the
CD job against `dev` (`build job: env.CD_JOB_NAME, wait: false` with
`ENVIRONMENT=dev` and the tag just pushed). On success it also archives
`image-tag.txt` and sets the build description to the pushed image, so you
can find the tag to deploy manually to `prod`.

**Versioning**: the image tag is `v<version>` straight from `package.json`
(e.g. `v1.2.0`) — not a git-sha. Bump it yourself before a release-worthy
push:

```bash
npm version patch   # or minor / major — bumps package.json, commits, tags locally
git push && git push --tags
```

Since the ECR repo is `IMMUTABLE`, a **"Check version not already
released"** stage queries ECR for that tag before building anything, and
fails fast with a clear message if you forgot to bump the version — rather
than letting `docker push` fail later with ECR's own, less helpful
rejection.

The trigger fires-and-forgets (`wait: false`) — this CI build finishes
without waiting for the dev deploy, and won't go red if that deploy fails.
The dev CD run's own build history is the source of truth for whether it
actually succeeded. Switch to `wait: true, propagate: true` if you'd rather
CI reflect dev-deploy failures directly.

**Before this can run:**
- Set the agent label (`nodejs-docker` placeholder) to one with Node.js 20,
  npm, git, docker CLI, and awscli v2.
- Set `ECR_REPOSITORY_URL` to the `ecr_repository_url` output from
  `eks-poc/bootstrap` (`terraform output ecr_repository_url`).
- Set `CD_JOB_NAME` to the actual name of the Jenkins job running
  `deploy/Jenkinsfile` (see **Jenkins job setup**).
- Confirm the agent's ambient AWS credentials can push to that ECR repo
  (see the comment block at the top of the Jenkinsfile).
- This assumes a **multibranch pipeline** job (so `BRANCH_NAME`/`when {
  branch 'main' }` work) — on a plain single-branch Pipeline job, either
  drop that `when` guard or replace it with an equivalent check.

## Deployment (`Deployment/`)

Plain Kubernetes manifests — Namespace, ServiceAccount, Deployment, Service,
Ingress — no Helm. Three values differ per environment/build (image tag,
replica count, ALB subnet IDs); since plain YAML has no templating, those
are `${VAR}` placeholders substituted with `envsubst` by the CD pipeline,
using `Deployment/env/<environment>.env` for the environment-specific ones.
Full details, including why the filenames are numbered (`00-`, `01-`, ...)
and how to render manifests locally without Jenkins: see
[`Deployment/README.md`](Deployment/README.md).

## CD pipeline (`deploy/Jenkinsfile`)

Parameterized by `ENVIRONMENT` (`dev`/`prod` dropdown) and `IMAGE_TAG`.
Stages: verify AWS access → configure kubeconfig for that environment's
cluster → render `Deployment/*.yaml` via `envsubst` → `kubectl diff` (shown
in the console log) → **manual approval** → `kubectl apply` → `kubectl
rollout status` → poll for and print the ALB's public hostname.

**The approval stage is skipped when `ENVIRONMENT=dev`** (`when {
expression { params.ENVIRONMENT != 'dev' } }`) — that's what makes the
auto-trigger from CI actually hands-off. It applies regardless of who/what
started the build, so a human manually re-running this job against `dev`
also skips the gate; anything other than `dev` (i.e. `prod`) always pauses
for approval.

**Before this can run:**
- Set the agent label (`helm-kubectl` placeholder) to one with kubectl,
  awscli v2, `envsubst` (from the `gettext` package), and — since the EKS
  API endpoint is private-only — network access to the cluster's VPC (same
  constraint as `eks-poc`'s own Terraform CD pipeline).
- Set `ECR_REPOSITORY_URL` in the Jenkinsfile (same value as the CI
  pipeline's).
- Fill in real values in `Deployment/env/dev.env` and `Deployment/env/prod.env`:
  `ALB_SUBNETS` needs your VPC's **public** subnet IDs, so the ALB
  Controller knows where to place the ALB without needing VPC-wide subnet
  tagging.
- The pipeline assumes cluster names `hello-world-dev` / `hello-world-prod`
  — matching `eks-poc/environments/tfvars/*.tfvars`. Update
  `CLUSTER_NAME` in the Jenkinsfile if you rename them.
- Whatever IAM identity the agent assumes needs `eks:DescribeCluster` on the
  target cluster, and that identity needs to be mapped to sufficient
  Kubernetes RBAC (via `aws-auth` or EKS access entries) to deploy into the
  `hello-world` namespace.

## Jenkins job setup

Two Jenkins jobs, both pointed at this repo, since CI needs to trigger CD by
job name:

1. **CI job** — Pipeline (or multibranch pipeline) job, script path
   `Jenkinsfile`.
2. **CD job** — Pipeline job, script path `deploy/Jenkinsfile`. Give it
   whatever name you want, then set `CD_JOB_NAME` in the CI `Jenkinsfile` to
   match exactly (Jenkins job names are case-sensitive; if the CD job lives
   in a folder, use the full path, e.g. `hello-world-app/deploy`).

With both in place: a CI build on `main` pushes an image and fires the CD
job at `dev` automatically (no approval). To deploy `prod` (or re-deploy
`dev` by hand), run the CD job directly with "Build with Parameters" and
pick the environment/tag yourself — it'll pause for approval unless you
picked `dev`.

## Helm chart (`helm/hello-world`) — kept, currently unused

This repo also has a working Helm-based path: `helm/hello-world` is a thin
chart depending on [`helm-nodejs-app`](../helm-nodejs-app) (a separate,
generic base chart for any Node.js service), and `deploy/Jenkinsfile.helm`
is the Helm-based CD pipeline that used to be `deploy/Jenkinsfile`. Neither
is wired to an active Jenkins job — deployment today goes through
`Deployment/` + `deploy/Jenkinsfile` instead. Both are left in place in case
Helm is preferred again later; see `helm-nodejs-app/README.md` for how the
dependency and versioning work if you do switch back.

## Notes / things to revisit

- No database — `/users` is static seed data (`src/users.js`). Wire up
  a real datastore here if this grows past a POC.
- No TLS/custom domain on the ALB yet — it's plain HTTP on the ALB's own
  DNS name. Adding a domain means an ACM cert + a
  `alb.ingress.kubernetes.io/certificate-arn` annotation + a `HTTPS` listener
  in `Deployment/04-ingress.yaml`.
- No rollback pipeline yet — for now, `kubectl rollout undo
  deployment/hello-world -n hello-world` by hand from a host with cluster
  access.
- The app itself has no IRSA role (no annotations on
  `Deployment/01-serviceaccount.yaml`) since it makes no AWS API calls. If
  that changes, wire up a role via the shared `terraform-aws-irsa` module
  and annotate the ServiceAccount there.
