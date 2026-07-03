import * as jose from "https://esm.sh/jose@5.9.6";

const XERO_ISSUER = "https://identity.xero.com";
const JWKS = jose.createRemoteJWKSet(
  new URL("https://identity.xero.com/.well-known/openid-configuration/jwks"),
);

export type XeroIdTokenPayload = jose.JWTPayload & {
  email?: string;
  given_name?: string;
  family_name?: string;
  xero_userid?: string;
};

export async function verifyXeroIdToken(
  idToken: string,
  clientId: string,
): Promise<XeroIdTokenPayload> {
  const { payload } = await jose.jwtVerify(idToken, JWKS, {
    issuer: XERO_ISSUER,
    audience: clientId,
  });
  return payload as XeroIdTokenPayload;
}
