import * as k8s from '@kubernetes/client-node';
/** Retrieve Dashboard configmap Name */
const { DASHBOARD_CONFIGMAP = "centraldashboard-config" } = process.env;
const APP_API_GROUP = 'app.k8s.io';
const APP_API_VERSION = 'v1beta1';
const APP_API_NAME = 'applications';
/** Wrap Kubernetes API calls in a simpler interface for use in routes. */
export class KubernetesService {
    constructor(kubeConfig) {
        this.kubeConfig = kubeConfig;
        this.namespace = 'kubeflow';
        this.dashboardConfigMap = DASHBOARD_CONFIGMAP;
        console.info('Initializing Kubernetes configuration');
        this.kubeConfig.loadFromDefault();
        const context = this.kubeConfig.getContextObject(this.kubeConfig.getCurrentContext());
        if (context && context.namespace) {
            this.namespace = context.namespace;
        }
        this.coreAPI = this.kubeConfig.makeApiClient(k8s.Core_v1Api);
        this.customObjectsAPI =
            this.kubeConfig.makeApiClient(k8s.Custom_objectsApi);
    }
    /** Retrieves the list of namespaces from the Cluster. */
    async getNamespaces() {
        try {
            const { body } = await this.coreAPI.listNamespace();
            return body.items;
        }
        catch (err) {
            console.error('Unable to fetch Namespaces:', err.body || err);
            return [];
        }
    }
    /** Retrieves the configmap data for the central dashboard. */
    async getConfigMap() {
        try {
            const { body } = await this.coreAPI.readNamespacedConfigMap(this.dashboardConfigMap, this.namespace);
            return body;
        }
        catch (err) {
            console.error('Unable to fetch ConfigMap:', err.body || err);
            return null;
        }
    }
    /** Retrieves the list of events for the given Namespace from the Cluster. */
    async getEventsForNamespace(namespace) {
        try {
            const { body } = await this.coreAPI.listNamespacedEvent(namespace);
            return body.items;
        }
        catch (err) {
            console.error(`Unable to fetch Events for ${namespace}:`, err.body || err);
            return [];
        }
    }
    /**
     * Obtains cloud platform information from cluster Nodes,
     * as well as the Kubeflow version from the Application custom resource.
     */
    async getPlatformInfo() {
        try {
            const [provider, version] = await Promise.all([this.getProvider(), this.getKubeflowVersion()]);
            return {
                kubeflowVersion: version,
                provider,
                providerName: provider.split(':')[0]
            };
        }
        catch (err) {
            console.error('Unexpected error', err);
            throw err;
        }
    }
    /**
     * Retrieves Kubernetes Node information.
     */
    async getNodes() {
        try {
            const { body } = await this.coreAPI.listNode();
            return body.items;
        }
        catch (err) {
            console.error('Unable to fetch Nodes', err.body || err);
            return [];
        }
    }
    /**
     * Returns the provider identifier or 'other://' from the K8s cluster.
     */
    async getProvider() {
        let provider = 'other://';
        try {
            const nodes = await this.getNodes();
            const foundProvider = nodes.map((n) => n.spec.providerID).find(Boolean);
            if (foundProvider) {
                provider = foundProvider;
            }
        }
        catch (err) {
            console.error('Unable to fetch Node information:', err.body || err);
        }
        return provider;
    }
    /**
     * Returns the Kubeflow version from the Application custom resource or
     * 'unknown'.
     */
    async getKubeflowVersion() {
        let version = 'unknown';
        try {
            // tslint:disable-next-line: no-any
            const _ = (o) => o || {};
            const response = await this.customObjectsAPI.listNamespacedCustomObject(APP_API_GROUP, APP_API_VERSION, this.namespace, APP_API_NAME);
            const body = response.body;
            const kubeflowApp = (body.items || [])
                .find((app) => /^kubeflow$/i.test(_(_(_(app).spec).descriptor).type));
            if (kubeflowApp) {
                version = kubeflowApp.spec.descriptor.version;
            }
        }
        catch (err) {
            console.error('Unable to fetch Application information:', err.body || err);
        }
        return version;
    }
}
