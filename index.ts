import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { Guestbook } from "./guestbook";
import { Monitoring, createGuestbookServiceMonitors } from "./monitoring";

const config = new pulumi.Config();
const isMinikube = config.getBoolean("isMinikube") ?? false;

const guestbookNamespace = new k8s.core.v1.Namespace("guestbook", {
    metadata: { name: "guestbook" },
});
const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});

const guestbook = new Guestbook("guestbook", {
    namespace: guestbookNamespace.metadata.name,
    isMinikube,
});

const grafanaAdminPassword = new random.RandomPassword("grafana-admin-password", {
    length: 20,
    special: false,
});

const monitoring = new Monitoring("kube-prometheus-stack", {
    namespace: monitoringNamespace.metadata.name,
    grafanaAdminPassword: grafanaAdminPassword.result,
    // kind/minikube don't provision real cloud load balancers; NodePort is reachable
    // without extra tooling. Switch to "LoadBalancer" when targeting a cloud cluster.
    exposeGrafanaAs: isMinikube ? "NodePort" : "LoadBalancer",
}, { dependsOn: [monitoringNamespace] });

createGuestbookServiceMonitors(
    monitoringNamespace.metadata.name,
    guestbookNamespace.metadata.name,
    { dependsOn: [monitoring.chart, guestbook] },
);

export const frontendUrl = guestbook.frontendIp;
export const grafanaServiceName = monitoring.grafanaServiceName;
export const grafanaNamespace = monitoringNamespace.metadata.name;
export const grafanaAdminUser = "admin";
export const grafanaAdminPasswordOutput = pulumi.secret(grafanaAdminPassword.result);
export const grafanaAccessInstructions =
    "Run: kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80, then open http://localhost:3000";
