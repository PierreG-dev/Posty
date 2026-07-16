import { LinkedInApiError } from "./errors";
import {
  type LinkedInClient,
  type PublishInput,
  type PublishResult,
  type RefreshResult,
  type UploadInit,
  type UserInfo,
  urnToFeedUrl,
} from "./types";

interface Scenario {
  publishStatus?: number;         // 201 par défaut
  urn?: string;                   // urn:li:share:... par défaut
  onFirstCallUnauthorized?: boolean;
}

/** Client en mémoire pour tests et un futur mode simulation. */
export class MockLinkedInClient implements LinkedInClient {
  readonly published: PublishInput[] = [];
  readonly deleted: string[] = [];
  readonly uploads: { url: string; size: number; contentType: string }[] = [];
  private nextUrnSeq = 1;
  private hasThrown401 = false;

  constructor(private readonly scenario: Scenario = {}) {}

  async getUserInfo(_accessToken: string): Promise<UserInfo> {
    return { sub: "MOCKUSER", name: "Mock User" };
  }

  async initImageUpload(_accessToken: string, _ownerUrn: string): Promise<UploadInit> {
    return { uploadUrl: "https://mock/upload/image", urn: `urn:li:image:mock-${this.nextUrnSeq++}` };
  }

  async initDocumentUpload(_accessToken: string, _ownerUrn: string): Promise<UploadInit> {
    return { uploadUrl: "https://mock/upload/document", urn: `urn:li:document:mock-${this.nextUrnSeq++}` };
  }

  async uploadBinary(url: string, body: Buffer, contentType: string): Promise<void> {
    this.uploads.push({ url, size: body.length, contentType });
  }

  async publish(_accessToken: string, input: PublishInput): Promise<PublishResult> {
    if (this.scenario.onFirstCallUnauthorized && !this.hasThrown401) {
      this.hasThrown401 = true;
      throw new LinkedInApiError({ kind: "unauthorized", status: 401, message: "token expiré" });
    }
    if (this.scenario.publishStatus && this.scenario.publishStatus >= 400) {
      throw new LinkedInApiError({
        kind: this.scenario.publishStatus === 422 ? "validation" : "server",
        status: this.scenario.publishStatus,
        message: `mock ${this.scenario.publishStatus}`,
      });
    }
    this.published.push(input);
    const urn = this.scenario.urn ?? `urn:li:share:mock-${this.nextUrnSeq++}`;
    return { urn, url: urnToFeedUrl(urn), rawResponse: "{}", status: 201 };
  }

  async deletePost(_accessToken: string, postUrn: string): Promise<void> {
    this.deleted.push(postUrn);
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
    return {
      accessToken: `refreshed-${Date.now()}`,
      refreshToken,
      expiresInSec: 60 * 24 * 60 * 60,
      refreshExpiresInSec: 365 * 24 * 60 * 60,
    };
  }
}
