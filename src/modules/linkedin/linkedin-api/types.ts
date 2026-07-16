// Interface du client LinkedIn — le reste de l'app ne connaît QUE ça.
// L'implémentation `PostsApiClient` parle HTTP, `MockLinkedInClient` reste
// en mémoire (tests + point d'extension pour un futur mode simulation).

export interface UserInfo {
  sub: string;             // opaque LinkedIn id → urn:li:person:{sub}
  name?: string;
  email?: string;
}

export interface UploadInit {
  uploadUrl: string;
  urn: string;             // URN de l'image ou du document
}

export type PublishInput =
  | { kind: "text"; author: string; commentary: string }
  | { kind: "image"; author: string; commentary: string; imageUrn: string; altText: string }
  | { kind: "document"; author: string; commentary: string; documentUrn: string; title: string };

export interface PublishResult {
  urn: string;             // urn:li:share:... OU urn:li:ugcPost:... (docs)
  url: string;             // https://www.linkedin.com/feed/update/{urn}/
  rawResponse: string;     // tronqué à 4 Ko
  status: number;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;    // LinkedIn peut renouveler le refresh — on stocke ce qui revient
  expiresInSec: number;
  refreshExpiresInSec: number;
}

export interface LinkedInClient {
  getUserInfo(accessToken: string): Promise<UserInfo>;

  initImageUpload(accessToken: string, ownerUrn: string): Promise<UploadInit>;
  initDocumentUpload(accessToken: string, ownerUrn: string): Promise<UploadInit>;
  uploadBinary(uploadUrl: string, body: Buffer, contentType: string): Promise<void>;

  publish(accessToken: string, input: PublishInput): Promise<PublishResult>;
  deletePost(accessToken: string, postUrn: string): Promise<void>;

  refreshAccessToken(refreshToken: string): Promise<RefreshResult>;
}

/** Construit une URL publique LinkedIn à partir de l'URN retourné par l'API. */
export function urnToFeedUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;
}
