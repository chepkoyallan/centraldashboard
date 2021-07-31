import { Router } from 'express';
import { apiError, } from './api.js';
// From: https://www.w3resource.com/javascript/form/email-validation.php
const EMAIL_RGX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
export const roleMap = new Map([
    ['admin', 'owner'],
    ['owner', 'admin'],
    ['edit', 'contributor'],
    ['contributor', 'edit'],
]);
/**
 * Converts Workgroup Binding from Profile Controller to SimpleBinding
 */
export function mapWorkgroupBindingToSimpleBinding(bindings) {
    return bindings.map((n) => ({
        user: n.user.name,
        namespace: n.referredNamespace,
        role: roleMap.get(n.roleRef.name),
    }));
}
/**
 * Converts Kubernetes Namespace types to SimpleBinding to ensure
 * compatibility between identity-aware and non-identity aware clusters
 */
export function mapNamespacesToSimpleBinding(user, namespaces) {
    return namespaces.map((n) => ({
        user,
        namespace: n.metadata.name,
        role: 'contributor',
    }));
}
/**
 * Converts SimpleBinding to Workgroup Binding from Profile Controller
 */
export function mapSimpleBindingToWorkgroupBinding(binding) {
    const { user, namespace, role } = binding;
    return {
        user: {
            kind: 'User',
            name: user,
        },
        referredNamespace: namespace,
        roleRef: {
            kind: 'ClusterRole',
            name: roleMap.get(role),
        }
    };
}
/**
 * Handles an exception in an async block and converts it to a JSON
 * response sent back to client
 */
// tslint:disable-next-line: no-any
const surfaceProfileControllerErrors = (info) => {
    const { res, msg, err } = info;
    const code = (err.response && err.response.statusCode) || 400;
    const devError = err.body || '';
    // Msg is the developer reason of what happened, devError is the technical details as to why
    console.error(msg + (devError ? ` ${devError}` : ''), err.stack ? err : '');
    apiError({ res, code, error: devError || msg });
};
export class WorkgroupApi {
    constructor(profilesService, k8sService, registrationFlowAllowed) {
        this.profilesService = profilesService;
        this.k8sService = k8sService;
        this.registrationFlowAllowed = registrationFlowAllowed;
    }
    /** Retrieves and memoizes the PlatformInfo. */
    async getPlatformInfo() {
        if (!this.platformInfo) {
            this.platformInfo = await this.k8sService.getPlatformInfo();
        }
        return this.platformInfo;
    }
    /**
     * Builds EnvironmentInfo for the case with identity awareness
     */
    async getProfileAwareEnv(user) {
        const [platform, { namespaces, isClusterAdmin }] = await Promise.all([
            this.getPlatformInfo(),
            this.getWorkgroupInfo(user),
        ]);
        return { user: user.email, platform, namespaces, isClusterAdmin };
    }
    /**
     * Builds EnvironmentInfo for the case without identity awareness
     */
    async getBasicEnvironment(user) {
        const [platform, namespaces] = await Promise.all([
            this.getPlatformInfo(),
            this.getAllWorkgroups(user.email),
        ]);
        return {
            user: user.email,
            platform,
            namespaces,
            isClusterAdmin: true,
        };
    }
    /**
     * Retrieves all namespaces in case of basic auth.
     */
    async getAllWorkgroups(fakeUser) {
        const bindings = await this.profilesService.readBindings();
        const namespaces = mapWorkgroupBindingToSimpleBinding(bindings.body.bindings || []);
        const names = new Set(namespaces.map((n) => n.namespace));
        return Array.from(names).map((n) => ({
            namespace: n,
            role: 'contributor',
            user: fakeUser,
        }));
    }
    /**
     * Retrieves WorkgroupInfo from Profile Controller for the given user.
     */
    async getWorkgroupInfo(user) {
        const [adminResponse, bindings] = await Promise.all([
            this.profilesService.v1RoleClusteradminGet(user.email),
            this.profilesService.readBindings(user.email),
        ]);
        const namespaces = mapWorkgroupBindingToSimpleBinding(bindings.body.bindings || []);
        return {
            isClusterAdmin: adminResponse.body,
            namespaces,
        };
    }
    async handleContributor(action, req, res) {
        const { namespace } = req.params;
        const { contributor } = req.body;
        const { profilesService } = this;
        if (!contributor || !namespace) {
            const missing = [];
            // tslint:disable: no-unused-expression
            contributor || missing.push('contributor');
            namespace || missing.push('namespace');
            // tslint:enable: no-unused-expression
            return apiError({
                res,
                error: `Missing ${missing.join(' and ')} field${missing.length - 1 ? 's' : ''}.`,
            });
        }
        if (!EMAIL_RGX.test(contributor)) {
            return apiError({
                res,
                error: `Contributor doesn't look like a valid email address`,
            });
        }
        let errIndex = 0;
        try {
            const binding = mapSimpleBindingToWorkgroupBinding({
                user: contributor,
                namespace,
                role: 'contributor',
            });
            const { headers } = req;
            delete headers['content-length'];
            const actionAPI = action === 'create' ? 'createBinding' : 'deleteBinding';
            await profilesService[actionAPI](binding, { headers });
            errIndex++;
            const users = await this.getContributors(namespace);
            res.json(users);
        }
        catch (err) {
            const errMessage = [
                `Unable to add new contributor for ${namespace}: ${err.stack || err}`,
                `Unable to fetch contributors for ${namespace}: ${err.stack || err}`,
            ][errIndex];
            surfaceProfileControllerErrors({
                res,
                msg: errMessage,
                err,
            });
        }
    }
    /**
     * Given an owned namespace, list all contributors under it
     * @param namespace Namespace to find contributors for
     */
    async getContributors(namespace) {
        const { body } = await this.profilesService
            .readBindings(undefined, namespace);
        const users = mapWorkgroupBindingToSimpleBinding(body.bindings)
            .filter((b) => b.role === 'contributor')
            .map((b) => b.user);
        return users;
    }
    routes() {
        return Router()
            .get('/exists', async (req, res) => {
            try {
                const response = {
                    hasAuth: req.user.hasAuth,
                    user: req.user.username,
                    hasWorkgroup: false,
                    registrationFlowAllowed: this.registrationFlowAllowed,
                };
                if (req.user.hasAuth) {
                    const workgroup = await this.getWorkgroupInfo(req.user);
                    response.hasWorkgroup = !!(workgroup.namespaces || [])
                        .find((w) => w.role === 'owner');
                }
                else {
                    // Basic auth workgroup condition
                    response.hasWorkgroup = !!(await this.getAllWorkgroups(req.user.username)).length;
                }
                res.json(response);
            }
            catch (err) {
                surfaceProfileControllerErrors({
                    res,
                    msg: 'Unable to contact Profile Controller',
                    err,
                });
            }
        })
            .post('/create', async (req, res) => {
            const profile = req.body;
            try {
                const namespace = profile.namespace || req.user.username;
                // Use the request body if provided, fallback to auth headers
                await this.profilesService.createProfile({
                    metadata: {
                        name: namespace,
                    },
                    spec: {
                        owner: {
                            kind: 'User',
                            name: profile.user || req.user.email,
                        }
                    },
                });
                res.json({ message: `Created namespace ${namespace}` });
            }
            catch (err) {
                surfaceProfileControllerErrors({
                    res,
                    msg: 'Unexpected error creating profile',
                    err,
                });
            }
        })
            .get('/env-info', async (req, res) => {
            try {
                if (req.user.hasAuth) {
                    return res.json(await this.getProfileAwareEnv(req.user));
                }
                res.json(await this.getBasicEnvironment(req.user));
            }
            catch (err) {
                const code = (err.response && err.response.statusCode) || 400;
                const error = err.body || 'Unexpected error getting environment info';
                console.log(`Unable to get environment info: ${error}${err.stack ? '\n' + err.stack : ''}`);
                apiError({ res, code, error });
            }
        })
            .use((req, res, next) => {
            if (!req.user.hasAuth) {
                return apiError({
                    res,
                    code: 405,
                    error: 'Unable to ascertain user identity from request, cannot access route.',
                });
            }
            next();
        })
            .delete('/nuke-self', async (req, res) => {
            try {
                const headers = req.user.auth;
                const namespace = req.user.username;
                const { body: serverBody } = await this.profilesService.deleteProfile(namespace, { headers });
                res.json({ message: `Removed namespace/profile ${namespace}`, serverBody });
            }
            catch (err) {
                surfaceProfileControllerErrors({
                    res,
                    msg: 'Unexpected error deleting profile',
                    err,
                });
            }
        })
            .get('/get-all-namespaces', async (req, res) => {
            try {
                const { body } = await this.profilesService.readBindings();
                // tslint:disable-next-line: no-any
                const namespaces = {};
                const bindings = mapWorkgroupBindingToSimpleBinding(body.bindings);
                bindings.forEach((b) => {
                    const name = b.namespace;
                    if (!namespaces[name]) {
                        namespaces[name] = { contributors: [] };
                    }
                    const namespace = namespaces[name];
                    if (b.role === 'owner') {
                        namespace.owner = b.user;
                        return;
                    }
                    namespaces[name].contributors.push(b.user);
                });
                const tabular = Object.keys(namespaces).map(namespace => [
                    namespace,
                    namespaces[namespace].owner,
                    namespaces[namespace].contributors.join(', '),
                ]);
                res.json(tabular);
            }
            catch (err) {
                surfaceProfileControllerErrors({
                    res,
                    msg: `Unable to fetch all workgroup data`,
                    err,
                });
            }
        })
            .get('/get-contributors/:namespace', async (req, res) => {
            const { namespace } = req.params;
            try {
                const users = await this.getContributors(namespace);
                res.json(users);
            }
            catch (err) {
                surfaceProfileControllerErrors({
                    res,
                    msg: `Unable to fetch contributors for ${namespace}`,
                    err,
                });
            }
        })
            .post('/add-contributor/:namespace', async (req, res) => {
            this.handleContributor('create', req, res);
        })
            .delete('/remove-contributor/:namespace', async (req, res) => {
            this.handleContributor('remove', req, res);
        });
    }
}
