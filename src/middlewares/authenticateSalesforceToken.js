const jwt = require('jsonwebtoken');

function authenticateSalesforceToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if(!token){
        return res.status(401).json({ 'error' : 'Access Denied. No Auth Token Provided'});
    }

    // use connected app client id as jwt secret
    // Data -> 
    // issuer -> org base url -> iss -> https://www.qwerty.com
    // subject -> user id -> sub -> ASDFGHJK
    // audience -> node endpoint url -> aud -> localhost:3000
    // expiration -> exp -> null -> compulsory
    // issued at -> time.now -> iat -> datetime.now -> compulsory
    // these are standard best practices for jwt input

    // as for custom we can add additional data if needed

    jwt.verify(token,process.env.CLIENT_ID, (err,user)=>{ 
        if(err){
            console.error('error : '+err.message);
            return res.status(403).json({ error: 'Invalid or expired token.' });
        }
        console.log('middle ware authorized user : '+Object.entries(user));
        req.user = user;

        next();
    })
}

module.exports = authenticateSalesforceToken;