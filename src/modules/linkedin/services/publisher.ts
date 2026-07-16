import { randomUUID } from "node:crypto";
import { logger } from "@/modules/shared/logger";
import { env } from "@/modules/shared/env";
import { sendPushover } from "@/modules/shared/pushover/client";
import { getSettings } from "@/modules/shared/settings/repo";
import {
  escapeCommentary,
  LinkedInApiError,
  PostsApiClient,
  type LinkedInClient,
  type PublishInput,
} from "@/modules/linkedin/linkedin-api";
import {
  applyPublishOutcome,
  claimForPublishing,
  getPost,
} from "@/modules/linkedin/repositories/post-repo";
import {
  cacheLinkedInUrn,
  getAsset,
  readAssetBinary,
  type Asset,
} from "@/modules/linkedin/repositories/asset-repo";
import { createPublication } from "@/modules/linkedin/repositories/publication-repo";
import type { PublicationMode } from "@/modules/linkedin/repositories/publication-model";
import type { Post } from "@/modules/linkedin/domain/post";
import { forceRefresh, refreshIfNeeded } from "./token-refresh";
import { getLinkedInCredentials } from "@/modules/shared/settings/repo";

export interface PublishOptions {
  mode: PublicationMode;
  slotId?: string | null;
  /** Fournir une clé stable en cas de retry sur un même slot (§7.2). Sinon
   * une clé aléatoire est générée : les publications manuelles n'ont pas
   * de contrainte d'idempotence entre elles. */
  idempotencyKey?: string;
  /** Injectable pour les tests. Par défaut : PostsApiClient réel. */
  client?: LinkedInClient;
  /** Injectable pour les tests. Par défaut : maintenant. */
  now?: Date;
}

export type PublishResult =
  | { outcome: "published"; postId: string; urn: string; url: string }
  | { outcome: "skipped_dry_run"; postId: string; payload: PublishInput }
  | { outcome: "duplicate"; postId: string; idempotencyKey: string }
  | { outcome: "not_publishable"; postId: string; reason: string }
  | { outcome: "not_connected"; postId: string }
  | { outcome: "failed"; postId: string; error: string; kind: string };

interface PublishContext {
  post: Post;
  authorUrn: string;
  accessToken: string;
  commentary: string;
}

/** Construit `commentary` = corps + double retour + hashtags, échappé. */
function buildCommentary(post: Post): string {
  const hashtags = post.hashtags.length > 0 ? "\n\n" + post.hashtags.join(" ") : "";
  return escapeCommentary(post.content + hashtags);
}

async function buildPublishInput(ctx: PublishContext, client: LinkedInClient): Promise<PublishInput> {
  if (ctx.post.media.kind === "none") {
    return { kind: "text", author: ctx.authorUrn, commentary: ctx.commentary };
  }

  if (!ctx.post.media.assetId) {
    throw new Error(`Post ${ctx.post._id}: media.kind=${ctx.post.media.kind} mais assetId manquant`);
  }
  const asset = await getAsset(ctx.post.media.assetId);
  if (!asset) throw new Error(`Asset ${ctx.post.media.assetId} introuvable`);

  const uploadedUrn = asset.linkedinUrn ?? (await uploadAsset(asset, ctx, client));

  if (ctx.post.media.kind === "image") {
    return {
      kind: "image",
      author: ctx.authorUrn,
      commentary: ctx.commentary,
      imageUrn: uploadedUrn,
      altText: ctx.post.media.altText,
    };
  }
  return {
    kind: "document",
    author: ctx.authorUrn,
    commentary: ctx.commentary,
    documentUrn: uploadedUrn,
    title: ctx.post.media.title,
  };
}

async function uploadAsset(asset: Asset, ctx: PublishContext, client: LinkedInClient): Promise<string> {
  const init =
    asset.kind === "image"
      ? await client.initImageUpload(ctx.accessToken, ctx.authorUrn)
      : await client.initDocumentUpload(ctx.accessToken, ctx.authorUrn);
  const bin = await readAssetBinary(asset);
  await client.uploadBinary(init.uploadUrl, bin, asset.mimeType);
  await cacheLinkedInUrn(asset._id, init.urn);
  return init.urn;
}

async function notifyPushover(
  title: string,
  message: string,
  priority: -1 | 0 | 1,
  urlPath?: string,
): Promise<void> {
  const s = await getSettings();
  if (!s.pushover?.enabled || !s.pushover.userKey || !s.pushover.appToken) return;
  await sendPushover(
    { userKey: s.pushover.userKey, appToken: s.pushover.appToken },
    {
      title,
      message,
      priority,
      ...(urlPath ? { url: `${env().APP_URL}${urlPath}`, urlTitle: "Ouvrir" } : {}),
    },
  );
}

/**
 * Publie un post. C'est le SEUL point d'entrée pour publier — l'UI (bouton
 * « Publier maintenant ») et le worker (étape 4) passent tous les deux ici.
 *
 * Idempotence : garantie par l'index unique sur `publications.idempotencyKey`.
 * Un appel dupliqué renvoie `outcome: 'duplicate'`, ne touche pas au post.
 *
 * dryRun (`settings.dryRun === true`) : construit le payload complet, écrit
 * une entrée `publications` avec `outcome: 'skipped'` + le payload, mais
 * n'appelle AUCUN endpoint LinkedIn et laisse le post inchangé.
 */
export async function publishPost(postId: string, opts: PublishOptions): Promise<PublishResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const idempotencyKey = opts.idempotencyKey ?? `${opts.mode}:${postId}:${randomUUID()}`;
  const client = opts.client ?? new PostsApiClient();

  const settings = await getSettings();
  const post = await getPost(postId);
  if (!post) return { outcome: "not_publishable", postId, reason: "Post introuvable" };

  // Recharger les credentials + refresh préventif si nécessaire.
  const refreshOutcome = await refreshIfNeeded(client, now);
  if (refreshOutcome.status === "not_connected" || refreshOutcome.status === "reconnect_required") {
    return { outcome: "not_connected", postId };
  }
  let creds = refreshOutcome.credentials!;

  // Publication en dryRun : on construit le payload, on l'archive, on s'arrête.
  // Lot 6 : on rend les visuels aussi en dryRun (choix tranché — cf docs/lots/06.md).
  // Ainsi le journal `publications` contient une empreinte fidèle de ce qui
  // serait parti, y compris le PNG/PDF (via l'assetId déjà rendu sur le post).
  // On n'appelle jamais l'API LinkedIn, donc on ne fait pas d'upload : l'URN
  // reste un placeholder. Le visuel réel est consultable via /api/assets/[id].
  if (settings.dryRun) {
    const ctx: PublishContext = {
      post,
      authorUrn: creds.authorUrn,
      accessToken: creds.accessToken,
      commentary: buildCommentary(post),
    };
    const payload = post.media.kind === "none"
      ? ({ kind: "text", author: ctx.authorUrn, commentary: ctx.commentary } as PublishInput)
      : post.media.kind === "image"
        ? ({
            kind: "image",
            author: ctx.authorUrn,
            commentary: ctx.commentary,
            imageUrn: "urn:li:image:DRY_RUN",
            altText: post.media.altText,
          } as PublishInput)
        : ({
            kind: "document",
            author: ctx.authorUrn,
            commentary: ctx.commentary,
            documentUrn: "urn:li:document:DRY_RUN",
            title: post.media.title,
          } as PublishInput);

    const res = await createPublication({
      idempotencyKey,
      postId,
      slotId: opts.slotId ?? null,
      mode: opts.mode,
      outcome: "skipped",
      durationMs: Date.now() - startedAt,
      payloadSnapshot: { ...payload, dryRunAssetId: post.media.assetId ?? null },
    });
    if (res.duplicate) return { outcome: "duplicate", postId, idempotencyKey };
    logger.info("linkedin.publish.dry_run", { postId, mode: opts.mode, assetId: post.media.assetId });
    return { outcome: "skipped_dry_run", postId, payload };
  }

  // Vraie publication : on prend le post en réservation.
  const claimed = await claimForPublishing(postId);
  if (!claimed) {
    return {
      outcome: "not_publishable",
      postId,
      reason: `Statut incompatible (${post.status}) — déjà en cours ou terminé`,
    };
  }

  const ctx: PublishContext = {
    post: claimed,
    authorUrn: creds.authorUrn,
    accessToken: creds.accessToken,
    commentary: buildCommentary(claimed),
  };

  try {
    const input = await buildPublishInput(ctx, client);
    let result;
    try {
      result = await client.publish(ctx.accessToken, input);
    } catch (err) {
      // 401 → refresh + 1 retry.
      if (err instanceof LinkedInApiError && err.kind === "unauthorized") {
        logger.warn("linkedin.publish.401_refresh_retry", { postId });
        creds = await forceRefresh(client, creds, now);
        ctx.accessToken = creds.accessToken;
        result = await client.publish(ctx.accessToken, input);
      } else {
        throw err;
      }
    }

    await applyPublishOutcome(postId, {
      status: "published",
      publishedAt: now,
      linkedin: { urn: result.urn, url: result.url },
      lastError: null,
      incrementAttempts: true,
    });

    const pubRes = await createPublication({
      idempotencyKey,
      postId,
      slotId: opts.slotId ?? null,
      mode: opts.mode,
      outcome: "published",
      durationMs: Date.now() - startedAt,
      linkedinStatus: result.status,
      linkedinResponse: result.rawResponse,
    });
    if (pubRes.duplicate) {
      logger.warn("linkedin.publish.race_duplicate", { postId, idempotencyKey });
    }

    // Premier commentaire — repli spike (docs/spike-linkedin.md).
    // L'API socialActions est inaccessible : on notifie et on laisse
    // firstComment.status='pending'. Le post reste `published`.
    if (claimed.firstComment.text && claimed.firstComment.status === "pending") {
      const preview = claimed.firstComment.text.slice(0, 30);
      await notifyPushover(
        "Posty",
        `✅ Publié. Colle le premier commentaire → ${preview}…`,
        0,
        `/linkedin/posts/${postId}`,
      );
    } else {
      // §11 : succès = notif silencieuse (priorité -1).
      const preview = claimed.content.slice(0, 30);
      await notifyPushover("Posty", `✅ Publié : ${preview}…`, -1, `/linkedin/posts/${postId}`);
    }

    return { outcome: "published", postId, urn: result.urn, url: result.url };
  } catch (err) {
    const apiErr = err instanceof LinkedInApiError ? err : null;
    const message = err instanceof Error ? err.message : String(err);
    const kind = apiErr?.kind ?? "unknown";

    await applyPublishOutcome(postId, {
      status: "failed",
      lastError: message,
      incrementAttempts: true,
    });

    await createPublication({
      idempotencyKey,
      postId,
      slotId: opts.slotId ?? null,
      mode: opts.mode,
      outcome: "api_failed",
      durationMs: Date.now() - startedAt,
      linkedinStatus: apiErr?.status ?? null,
      linkedinResponse: apiErr?.responseSnippet ?? null,
      error: message,
    });

    await notifyPushover("Posty", `🚨 Publication échouée — ${message.slice(0, 120)}`, 1, `/linkedin/posts/${postId}`);
    logger.error("linkedin.publish.failed", { postId, kind, status: apiErr?.status ?? null, message });
    return { outcome: "failed", postId, error: message, kind };
  }
}

// Réexport pour permettre aux consommateurs d'obtenir les credentials sans
// dépendre directement de shared/settings.
export { getLinkedInCredentials };
