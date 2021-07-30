/**
 * Returns a function that uses the provided header and prefix to extract
 * a User object with the requesting user's identity.
 */
export function attachUser(userIdHeader, userIdPrefix) {
    return (req, _, next) => {
        let email = 'anonymous@kubeflow.org';
        let auth;
        if (userIdHeader && req.header(userIdHeader)) {
            email = req.header(userIdHeader).slice(userIdPrefix.length);
            auth = { [userIdHeader]: req.header(userIdHeader) };
        }
        req.user = {
            email,
            username: email.split('@')[0],
            domain: email.split('@')[1],
            hasAuth: auth !== undefined,
            auth,
        };
        next();
    };
}
