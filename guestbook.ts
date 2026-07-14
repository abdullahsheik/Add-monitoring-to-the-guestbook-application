// Guestbook application, adapted from the Pulumi Kubernetes Guestbook example:
// https://github.com/pulumi/examples/blob/master/kubernetes-ts-guestbook
//
// Each component gets a `redis_exporter` (or equivalent) sidecar so Prometheus
// has something concrete to scrape per the assignment's monitoring requirement.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

const REDIS_EXPORTER_PORT = 9121;

export interface GuestbookArgs {
    namespace: pulumi.Input<string>;
    isMinikube: boolean;
}

export class Guestbook extends pulumi.ComponentResource {
    public readonly frontendServiceName: pulumi.Output<string>;
    public readonly frontendIp: pulumi.Output<string>;

    constructor(name: string, args: GuestbookArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook-monitoring:app:Guestbook", name, {}, opts);
        const { namespace, isMinikube } = args;
        const parent = { parent: this };

        // REDIS LEADER

        const redisLeaderLabels = { app: "redis-leader" };
        const redisLeaderDeployment = new k8s.apps.v1.Deployment(
            "redis-leader",
            {
                metadata: { namespace },
                spec: {
                    selector: { matchLabels: redisLeaderLabels },
                    template: {
                        metadata: { labels: redisLeaderLabels },
                        spec: {
                            containers: [
                                {
                                    name: "redis-leader",
                                    image: "redis",
                                    resources: { requests: { cpu: "100m", memory: "100Mi" } },
                                    ports: [{ containerPort: 6379 }],
                                },
                                {
                                    name: "redis-exporter",
                                    image: "oliver006/redis_exporter:v1.62.0",
                                    resources: { requests: { cpu: "50m", memory: "32Mi" } },
                                    ports: [{ name: "metrics", containerPort: REDIS_EXPORTER_PORT }],
                                },
                            ],
                        },
                    },
                },
            },
            parent,
        );
        const redisLeaderService = new k8s.core.v1.Service(
            "redis-leader",
            {
                metadata: { name: "redis-leader", namespace, labels: redisLeaderLabels },
                spec: {
                    ports: [
                        { name: "redis", port: 6379, targetPort: 6379 },
                        { name: "metrics", port: REDIS_EXPORTER_PORT, targetPort: REDIS_EXPORTER_PORT },
                    ],
                    selector: redisLeaderDeployment.spec.template.metadata.labels,
                },
            },
            parent,
        );

        // REDIS REPLICA

        const redisReplicaLabels = { app: "redis-replica" };
        const redisReplicaDeployment = new k8s.apps.v1.Deployment(
            "redis-replica",
            {
                metadata: { namespace },
                spec: {
                    selector: { matchLabels: redisReplicaLabels },
                    template: {
                        metadata: { labels: redisReplicaLabels },
                        spec: {
                            containers: [
                                {
                                    name: "replica",
                                    image: "pulumi/guestbook-redis-replica",
                                    resources: { requests: { cpu: "100m", memory: "100Mi" } },
                                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                                    ports: [{ containerPort: 6379 }],
                                },
                                {
                                    name: "redis-exporter",
                                    image: "oliver006/redis_exporter:v1.62.0",
                                    resources: { requests: { cpu: "50m", memory: "32Mi" } },
                                    ports: [{ name: "metrics", containerPort: REDIS_EXPORTER_PORT }],
                                },
                            ],
                        },
                    },
                },
            },
            parent,
        );
        const redisReplicaService = new k8s.core.v1.Service(
            "redis-replica",
            {
                metadata: { name: "redis-replica", namespace, labels: redisReplicaLabels },
                spec: {
                    ports: [
                        { name: "redis", port: 6379, targetPort: 6379 },
                        { name: "metrics", port: REDIS_EXPORTER_PORT, targetPort: REDIS_EXPORTER_PORT },
                    ],
                    selector: redisReplicaDeployment.spec.template.metadata.labels,
                },
            },
            parent,
        );

        // FRONTEND
        //
        // The upstream `pulumi/guestbook-php-redis` image has no metrics endpoint of its own.
        // Request-rate and resource-usage visibility for it comes from kube-state-metrics and
        // cAdvisor, both scraped automatically by kube-prometheus-stack (see monitoring.ts).

        const frontendLabels = { app: "frontend" };
        const frontendDeployment = new k8s.apps.v1.Deployment(
            "frontend",
            {
                metadata: { namespace },
                spec: {
                    selector: { matchLabels: frontendLabels },
                    replicas: 3,
                    template: {
                        metadata: { labels: frontendLabels },
                        spec: {
                            containers: [
                                {
                                    name: "frontend",
                                    image: "pulumi/guestbook-php-redis",
                                    resources: { requests: { cpu: "100m", memory: "100Mi" } },
                                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                                    ports: [{ containerPort: 80 }],
                                },
                            ],
                        },
                    },
                },
            },
            { ...parent, dependsOn: [redisLeaderService, redisReplicaService] },
        );
        const frontendService = new k8s.core.v1.Service(
            "frontend",
            {
                metadata: { labels: frontendLabels, name: "frontend", namespace },
                spec: {
                    type: isMinikube ? "ClusterIP" : "LoadBalancer",
                    ports: [{ port: 80 }],
                    selector: frontendDeployment.spec.template.metadata.labels,
                },
            },
            parent,
        );

        this.frontendServiceName = frontendService.metadata.name;
        this.frontendIp = isMinikube
            ? frontendService.spec.clusterIP
            : frontendService.status.loadBalancer.ingress[0].ip;

        this.registerOutputs({
            frontendServiceName: this.frontendServiceName,
            frontendIp: this.frontendIp,
        });
    }
}
