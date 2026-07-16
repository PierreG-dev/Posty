# CLAUDE.md — Posty

Ce fichier est chargé automatiquement au début de chaque session Claude Code.
Il est la mémoire du projet. Il DOIT rester court : le CDC (`docs/CDC-posty-*.md`) est la référence détaillée.

## Ce qu'est Posty

Application web mono-utilisateur qui remplace deux workflows n8n :

1. **Module LinkedIn** — planifie, génère (via Anthropic), et publie mes posts LinkedIn, avec visuels générés côté serveur (Satori). Voir `docs/CDC-posty-01-linkedin.md`.
2. **Module Mailing** — prospection email (séquence auto, campagnes ponctuelles), archivage IMAP, détection des bounces et des réponses. Voir `docs/CDC-posty-02-mailing.md`.

## Règle d'or — les modules sont ÉTANCHES

**`src/modules/linkedin/` et `src/modules/mailing/` ne s'importent JAMAIS l'un l'autre.**
Tout ce qui est commun (db, auth, crypto, pushover, logger, luxon, settings, locks) vit dans `src/modules/shared/`.

Garant : la règle ESLint `no-restricted-imports` définie dans `.eslintrc.json` fait échouer `npm run lint` en cas de violation croisée.

Base MongoDB **partagée**, collections **disjointes** (préfixe naturel par module : `posts`, `themes`, `slots` côté LinkedIn ; `mail_queue`, `mail_log`, `campaigns` côté Mailing).

## Contraintes de code

- **TypeScript strict**, `noUncheckedIndexedAccess`, aucun `any` (règle ESLint qui échoue).
- **Aucune logique métier dans les composants React**, ni dans les route handlers. Les routes valident avec zod et délèguent aux `services/`.
- **Aucun secret en dur** dans le repo. Tout passe par `.env` (`.env.example` à jour).
- Tokens LinkedIn **chiffrés au repos** via `src/modules/shared/crypto/aes.ts` (AES-256-GCM, clé `ENCRYPTION_KEY`).
- Hash mot de passe : **argon2id**, stocké **base64-wrappé** dans `AUTH_PASSWORD_HASH` pour éviter les `$` du format PHC qui cassent l'interpolation shell/docker-compose.

## Design system — source unique

Les tokens vivent dans `src/modules/linkedin/design/tokens.ts` (couleurs, polices).
Ils sont consommés :
- par Tailwind via les CSS variables déclarées dans `src/app/globals.css` ;
- par Satori pour le rendu des visuels (§9 CDC-01, arrive au lot 6).

Ne pas dupliquer la palette ailleurs. Ne pas hard-coder de hex hors de `tokens.ts`.

Palette : `bg #0B0F14`, `surface #121820`, `accent #FFB020` (ambre = file en attente = sujet du produit). Statuts : `draft #6E7681`, `queued #FFB020`, `scheduled #58A6FF`, `published #3FB950`, `failed #F85149`.

Typo : Geist Sans (UI) + JetBrains Mono (données, horodatages, identifiants). **La distinction sans/mono porte du sens.**

Icônes : lucide-react uniquement, stroke 1.5.

## Fuseau horaire — règle dure

- Toutes les dates **stockées en UTC** dans MongoDB.
- Tous les calculs de créneaux **en `Europe/Paris` via Luxon** (`src/modules/shared/luxon`), **quel que soit le fuseau du conteneur**.
- `TZ=Europe/Paris` forcé dans l'env des deux services (ceinture + bretelles).
- **`new Date().toLocaleString()` côté client sans zone forcée est interdit.** Utiliser les helpers de `shared/luxon`.

## Auth

Mono-utilisateur. Mot de passe unique argon2id (`AUTH_PASSWORD_HASH`, base64), session en cookie JWT HS256 signé (`SESSION_SECRET`), httpOnly/secure/sameSite=lax.
Rate limit sur `/api/auth/login` : 5 essais / 15 min (in-memory ; documenté : à migrer en Mongo si un jour on multi-replica le web).
Middleware Next protège tout sauf `/login`, `/api/auth/*`, `/api/linkedin/callback`.
**Pas de NextAuth.**

## Commandes

```
npm run dev           # web
npm run worker        # worker (tick node-cron toutes les 60 s)
npm run build         # build Next
npm run worker:build  # transpile le worker vers dist-worker/ (utilisé en prod)
npm run typecheck     # tsc --noEmit
npm run lint          # next lint (inclut la garde inter-modules)
npm test              # vitest run
npm run hash-password -- <pwd>   # génère la ligne AUTH_PASSWORD_HASH=... pour .env
```

**Avant tout commit** : `npm run typecheck && npm run lint && npm test`.

## Arborescence

```
src/
  app/
    login/                        page + form + route /api/auth/login,logout
    (dashboard)/                  layout protégé (Sidebar), enfants :
      linkedin/                     dashboard, posts, themes, calendar, history
      mailing/                      dashboard Mailing (grisé en v1)
      settings/                     réglages singleton
    api/
      auth/                         login, logout
      linkedin/                     callback OAuth, posts, generate, visuals…
      mailing/                      routes Mailing
  middleware.ts                   redirige vers /login si pas de session
  modules/
    linkedin/
      domain/                     types, schémas zod, règles pures
      services/                   scheduler, generator, publisher, visuals
      repositories/               accès Mongo
      linkedin-api/               client HTTP isolé, mockable
      visuals/templates/          un fichier = un template (registry)
      design/tokens.ts            SOURCE UNIQUE — Tailwind ET Satori
    mailing/                      structure miroir, vide en v1
    shared/
      db/                         connexion Mongoose (singleton HMR-safe)
      auth/                       password (argon2), session (jose), rate-limit
      pushover/                   fetch, pas de SDK
      crypto/                     AES-256-GCM natif
      logger/                     JSON structuré console
      luxon/                      helpers Europe/Paris
      locks/                      verrous Mongo à TTL
      settings/                   singleton _id='singleton'
      ui/                         composants transverses (Sidebar…)
      env.ts                      zod, appelée à la 1re lecture
worker/
  index.ts                        tick node-cron sous verrou
  jobs/                           publish-tick, refresh-token, mail-*, imap-*
scripts/
  hash-password.ts
  (lots suivants : spike-linkedin, migrate-from-sheets, compare-with-n8n)
tests/
docs/
  CDC-posty-01-linkedin.md
  CDC-posty-02-mailing.md
  lots/                           un rapport par lot livré (00.md, 01.md…)
```
