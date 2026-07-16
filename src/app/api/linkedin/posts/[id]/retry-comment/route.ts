import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Le CDC §10.6 prévoyait une action « Réessayer le commentaire ». Le spike
 * (docs/spike-linkedin.md) a démontré que l'API socialActions/comments est
 * fermée (403 partnerApiSocialActions). Dans notre repli, `firstComment` est
 * toujours en `pending` : il n'y a rien à retenter côté serveur.
 * → 410 Gone volontaire, avec un message explicite.
 * L'UI propose un bouton « Copier » à la place.
 */
export function POST(): Response {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "L'API commentaires n'est pas ouverte au scope w_member_social (spike lot 1). Le premier commentaire se colle à la main via le bouton Copier.",
    },
    { status: 410 },
  );
}
