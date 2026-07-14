# Guestbook Monitoring

Extends the [Pulumi Kubernetes Guestbook example](https://github.com/pulumi/examples/blob/master/kubernetes-ts-guestbook)
with Prometheus and Grafana monitoring.

## What this deploys

- **Guestbook app** (`guestbook` namespace) — PHP/Redis frontend, Redis leader, Redis
  replica, adapted from the upstream example. Each Redis pod runs a `redis_exporter`
  sidecar so Prometheus has metrics to scrape.
- **kube-prometheus-stack** (`monitoring` namespace) — Prometheus Operator, Prometheus,
  Alertmanager, Grafana, node-exporter, and kube-state-metrics, deployed via Helm.
- **ServiceMonitors** — tell Prometheus to scrape the Redis leader/replica
  `redis_exporter` sidecars. Frontend request/resource metrics come from
  kube-state-metrics and cAdvisor, which kube-prometheus-stack scrapes automatically.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18+
- A running Kubernetes cluster and matching `kubectl` context (a local
  [kind](https://kind.sigs.k8s.io/) or minikube cluster is sufficient)
- Helm (only needed if you want to inspect the chart manually; Pulumi drives the
  install itself)

## Deploy

```bash
npm install
pulumi stack init dev
pulumi config set isMinikube true   # set true for kind/minikube/local clusters
pulumi up
```

This provisions two namespaces (`guestbook`, `monitoring`), the guestbook app, and
the monitoring stack. First install of the Helm chart can take a few minutes while
images pull.

## Grafana access

Pulumi outputs the Grafana admin username, a randomly generated password (marked
secret — reveal with `pulumi stack output grafanaAdminPasswordOutput --show-secrets`),
and namespace/service name:

```bash
pulumi stack output
```

On a local cluster (`isMinikube: true`), Grafana is exposed as a `NodePort`
(no cloud load balancer available). Reach it with a port-forward:

```bash
kubectl port-forward -n monitoring "svc/$(pulumi stack output grafanaServiceName)" 3000:80
```

Then open http://localhost:3000 and log in with:

- **Username**: `admin`
- **Password**: `pulumi stack output grafanaAdminPasswordOutput --show-secrets`

On a cloud cluster (`isMinikube: false`), Grafana's Service is type `LoadBalancer`;
use the external IP from `kubectl get svc -n monitoring kube-prometheus-stack-grafana`
instead of port-forwarding.

## Verify metrics are being scraped

1. Port-forward Prometheus:
   ```bash
   kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
   ```
2. Open http://localhost:9090/targets and confirm the `redis-leader` and
   `redis-replica` ServiceMonitor targets show `UP`.
3. Query `redis_up` or `redis_connected_clients` in the Prometheus expression browser
   to see live values from the guestbook's Redis pods.
4. In Grafana, the default **Kubernetes / Compute Resources / Namespace (Pods)**
   dashboard (under Dashboards → Kubernetes) shows CPU/memory usage for the
   `guestbook` namespace's frontend pods, sourced from cAdvisor/kube-state-metrics.

## Accessing the guestbook app itself

```bash
kubectl port-forward -n guestbook svc/frontend 8080:80
```

Open http://localhost:8080.

## Teardown

```bash
pulumi destroy
```
