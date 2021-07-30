import express from 'express';
import { attachUser } from './attach_user_middleware.js';
const isProduction = process.env.NODE_ENV === 'production';
const defaultKfam = isProduction;
const codeEnvironment = isProduction ? 'production' : 'development';
const { PORT_1 = 8082, PROFILES_KFAM_SERVICE_HOST = defaultKfam, PROFILES_KFAM_SERVICE_PORT = '8081', USERID_HEADER = 'X-Goog-Authenticated-User-Email', USERID_PREFIX = 'accounts.google.com:', REGISTRATION_FLOW = "true", } = process.env;
async function main() {
    const port = Number(PORT_1);
    const profilesServiceUrl = `http://${PROFILES_KFAM_SERVICE_HOST}:${PROFILES_KFAM_SERVICE_PORT}/kfam`;
    // const frontEnd: string = resolve(__dirname, 'public');
    const registrationFlowAllowed = (REGISTRATION_FLOW.toLowerCase() === "true");
    const app = express();
    app.use(express.json());
    app.use(attachUser(USERID_HEADER, USERID_PREFIX));
    // app.use(express.static(frontEnd));
    // app.use()
    /**
     * Debug Route
     */
    app.get('/debug', (req, res) => {
        res.json({
            user: req.user,
            profilesServiceUrl,
            codeEnvironment,
            registrationFlowAllowed,
            headersForIdentity: {
                USERID_HEADER,
                USERID_PREFIX,
            },
        });
    });
    /**
     * Healthz Route
     */
    app.get('/healthz', (req, res) => {
        res.json({
            codeEnvironment,
            message: `I tick, therfore I am!`,
        });
    });
    app.listen(port, () => console.info(`Server listening on port http://localhost:${port} (in ${codeEnvironment} mode)`));
}
main();
