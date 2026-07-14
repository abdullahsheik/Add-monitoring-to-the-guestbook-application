// Prometheus + Grafana monitoring stack, deployed via the community
// kube-prometheus-stack Helm chart (Prometheus Operator, Alertmanager, Grafana,
// node-exporter, kube-state-metrics, and default dashboards).

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface MonitoringArgs {
    namespace: pulumi.Input<string>;
    grafanaAdminPassword: pulumi.Input<string>;
    exposeGrafanaAs: "LoadBalancer" | "NodePort";
}

export class Monitoring extends pulumi.ComponentResource {
    public readonly chart: k8s.helm.v3.Release;
    public readonly grafanaServiceName: pulumi.Output<string>;

    constructor(name: string, args: MonitoringArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook-monitoring:app:Monitoring", name, {}, opts);
        const { namespace, grafanaAdminPassword, exposeGrafanaAs } = args;
        const parent = { parent: this };

        this.chart = new k8s.helm.v3.Release(
            "kube-prometheus-stack",
            {
                name: "kube-prometheus-stack",
                chart: "kube-prometheus-stack",
                version: "65.5.1",
                namespace,
                repositoryOpts: {
                    repo: "https://prometheus-community.github.io/helm-charts",
                },
                values: {
                    grafana: {
                        adminPassword: grafanaAdminPassword,
                        service: {
                            type: exposeGrafanaAs,
                        },
                    },
                    // Keep the exercise's resource footprint small for a local kind cluster.
                    prometheus: {
                        prometheusSpec: {
                            resources: {
                                requests: { cpu: "200m", memory: "400Mi" },
                            },
                            // Required so Prometheus picks up ServiceMonitors outside its own
                            // release namespace (the guestbook app lives in a separate namespace).
                            serviceMonitorSelectorNilUsesHelmValues: false,
                            podMonitorSelectorNilUsesHelmValues: false,
                        },
                    },
                    alertmanager: {
                        alertmanagerSpec: {
                            resources: {
                                requests: { cpu: "50m", memory: "64Mi" },
                            },
                        },
                    },
                },
            },
            parent,
        );

        // Derive from the release's actual applied name (chart.status.name) rather than
        // assuming the requested name was honored verbatim.
        this.grafanaServiceName = pulumi.interpolate`${this.chart.status.name}-grafana`;

        this.registerOutputs({});
    }
}

// ServiceMonitor CRDs telling Prometheus how to scrape the guestbook's redis_exporter
// sidecars (frontend request/resource metrics come from kube-state-metrics + cAdvisor,
// which kube-prometheus-stack scrapes automatically without extra configuration).
export function createGuestbookServiceMonitors(
    monitoringNamespace: pulumi.Input<string>,
    guestbookNamespace: pulumi.Input<string>,
    opts?: pulumi.CustomResourceOptions,
): k8s.apiextensions.CustomResource[] {
    const targets = ["redis-leader", "redis-replica"];
    return targets.map(
        (svc) =>
            new k8s.apiextensions.CustomResource(
                `${svc}-servicemonitor`,
                {
                    apiVersion: "monitoring.coreos.com/v1",
                    kind: "ServiceMonitor",
                    metadata: {
                        name: svc,
                        namespace: monitoringNamespace,
                        labels: { release: "kube-prometheus-stack" },
                    },
                    spec: {
                        namespaceSelector: { matchNames: [guestbookNamespace] },
                        selector: { matchLabels: { app: svc } },
                        endpoints: [{ port: "metrics", interval: "15s" }],
                    },
                },
                opts,
            ),
    );
}
