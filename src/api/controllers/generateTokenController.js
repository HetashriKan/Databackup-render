const jwt = require('jsonwebtoken');

function generateAccessToken(user){
    const clientId = 'QWERTYUIOPAS' // from db
    const {iss,sub,aud} = user // issuer
    const iat = Date.now() // issued at
    const expiration = Date.now()+300; // expiration time
    const alg = 'HS256'

    const body = {
        'iss' : iss,
        'sub' : sub,
        'aud' : aud,
        'iat' : iat,
        'exp' : expiration
    }
    const urlBody = encodeURI(JSON.stringify(body));

    const token = jwt.sign(body,clientId,{algorithm:'HS256'});

    console.log('token : '+token);
    return token;
}
module.exports = generateAccessToken;