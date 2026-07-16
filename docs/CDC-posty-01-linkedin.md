# Cahier des charges — « Posty »
## Application de gestion et publication automatisée LinkedIn

> Spécification destinée à **Claude Code**.
> **Version 2.0** — Périmètre : module LinkedIn. Le module Mailing est anticipé dans l'architecture mais hors périmètre.

---

## 1. Contexte

### 1.1 Situation actuelle
Un workflow **n8n** assure la publication LinkedIn : Google Sheets comme base, 3 cron/semaine (mardi 9h, jeudi 12h, vendredi 17h30), sélection FIFO du premier post « À publier », publication via `POST /v2/ugcPosts` avec l'URN codé en dur, notification Pushover si la file est vide, formulaire d'ingestion en masse.

### 1.2 Ce qui ne va pas
Non testable, non versionnable. Aucune notion de thème éditorial. Créneaux figés dans du cron. Aucune génération. Aucun média. Aucun historique exploitable. Secrets en clair dans le workflow.

### 1.3 Objectif
Une application web **mono-utilisateur**, auto-hébergée, qui remplace intégralement n8n et permet de : gérer des **thèmes éditoriaux**, définir des **créneaux** depuis l'UI, alimenter une **file de posts** (manuelle, import JSON, ou IA), basculer entre **mode File** et **mode Auto**, publier avec **visuels générés par l'app**, et recevoir des **notifications Pushover**.

---

## 2. Périmètre

**Dans la v1 :** module LinkedIn complet (thèmes, créneaux, file, génération IA, publication, visuels, premier commentaire, historique) · auth mono-utilisateur · OAuth LinkedIn avec refresh automatique · notifications Pushover · migration depuis Google Sheets.

**Hors v1, mais l'architecture doit l'accueillir :** module **Mailing** (aucune ligne de code v1, voir §15) · analytics LinkedIn (l'API membre exige le scope restreint `r_member_social`) · publication sur Page entreprise · multi-utilisateur · vidéos, sondages, articles LinkedIn (non supportés par l'API).

---

## 3. Stack

| Couche | Choix |
|---|---|
| Framework | **Next.js 15+** (App Router, TypeScript strict) |
| Base de données | **MongoDB** (serveur existant, URI en `.env`) + **Mongoose** |
| UI | **Tailwind** + **shadcn/ui** + **lucide-react** |
| Formulaires | react-hook-form + **zod** (schémas partagés client/serveur) |
| Dates | **Luxon** (obligatoire, voir §7.4) |
| Scheduler | **node-cron**, dans un **process worker séparé** |
| IA | **`@anthropic-ai/sdk`** — modèle **`claude-sonnet-5`** |
| Visuels | **Satori** + **@resvg/resvg-js** (JSX → SVG → PNG) |
| PDF | **pdf-lib** |
| Notifications | API **Pushover** (`fetch`, pas de SDK) |
| Déploiement | **Coolify** (Docker, VPS) |
| Tests | **Vitest** — obligatoire sur la logique métier et le validateur |

**Contraintes :** pas de `any`. Toute la logique métier vit dans `src/modules/linkedin/**` — jamais dans les composants ni dans les route handlers, qui se contentent de valider et déléguer. **Aucun secret en dur** (le workflow n8n actuel contient l'URN LinkedIn et la clé Pushover en clair : ne pas reproduire).

---

## 4. Design system

L'app est un **outil**, consulté 30 secondes entre deux sessions de formation. Elle doit être dense, lisible d'un coup d'œil, et ne jamais faire réfléchir.

### 4.1 Tokens

```css
/* Fond & surfaces — sombre par défaut */
--bg:        #0B0F14;   /* encre */
--surface:   #121820;   /* cartes */
--surface-2: #1A222D;   /* hover, inputs */
--border:    #1E2833;   /* filets 1px */

/* Texte */
--fg:        #E6EDF3;
--fg-muted:  #8B98A5;

/* Accent — l'ambre : la couleur de la file en attente, c'est-à-dire du sujet même */
--accent:    #FFB020;
--accent-fg: #0B0F14;

/* Statuts — ils SONT l'information, pas de la décoration */
--draft:     #6E7681;
--queued:    #FFB020;
--scheduled: #58A6FF;
--published: #3FB950;
--failed:    #F85149;
```

Sombre par défaut. Tout passe par des **CSS variables** : un thème clair reste possible plus tard sans refonte.

### 4.2 Typographie
- **Geist Sans** — UI et titres. Tracking resserré (`-0.02em`) au-dessus de 24px.
- **JetBrains Mono** — code, compteurs, horodatages, identifiants. **La distinction sans/mono porte du sens** : le mono signale une donnée, pas une phrase.

### 4.3 Iconographie
**lucide-react** exclusivement. Stroke 1.5px, 16px en ligne, 20px dans les actions. Jamais d'icône décorative : une icône = une action ou un statut.

### 4.4 Élément signature — la colonne de file
Sur le dashboard, la file est une **colonne verticale** de cartes empilées, teintées par thème, qui **se vide visiblement** au fil des publications, surmontée d'un **compte à rebours en mono** vers le prochain créneau. C'est l'objet central du produit : on doit voir la réserve fondre. Toute la sobriété du reste de l'interface existe pour que cet élément-là ressorte.

### 4.5 Cohérence avec les visuels publiés
**Les visuels générés (§9) utilisent exactement les mêmes tokens et les mêmes polices.** Ce que tu publies et ce que tu administres partagent une identité. Les tokens sont définis **une seule fois**, dans `src/modules/linkedin/design/tokens.ts`, consommés par Tailwind **et** par Satori.

### 4.6 Ton de l'interface
Voix active, phrases courtes. Un bouton dit ce qu'il fait (`Publier`, pas `Valider`) et garde le même nom jusqu'au toast (`Publié`). Les erreurs disent ce qui s'est passé et quoi faire, sans s'excuser. Un écran vide est une invitation : « Aucun post en file. En ajouter un → ».

---

## 5. Architecture de déploiement

Deux services Coolify sur **la même image Docker** et **la même base MongoDB** :

```
┌────────────────────────┐      ┌────────────────────────┐
│ web   → next start     │      │ worker → node worker.js│
│ UI + routes API        │      │ node-cron, tick 60 s   │
└───────────┬────────────┘      └───────────┬────────────┘
            └────────► MongoDB ◄────────────┘
                          ▲
             Volume persistant /data/assets
```

**Pourquoi séparer :** un cron embarqué dans le serveur web se dédouble au moindre redémarrage ou scale.

**Garde-fous anti-double-publication (obligatoires) :**
- Collection `locks` avec index TTL — verrou `publish:{slotId}:{YYYY-MM-DD}` avant toute publication.
- Index **unique** sur `publications.idempotencyKey` (`{slotId}-{YYYY-MM-DD-HH:mm}`, ou `{postId}` pour un one-shot). Une seconde tentative lève une erreur de clé dupliquée → abandon silencieux.

**Assets :** `/data/assets` en volume persistant, servi par une route Next protégée (`/api/assets/[id]`), jamais en statique public.

---

## 6. Modèle de données (MongoDB)

### 6.1 `themes`
```ts
{
  _id, name, slug, color, emoji, description,

  ai: {
    enabled: boolean,
    systemPrompt: string,        // posture, angle, interdits propres au thème
    structure: string,           // ex: "Hook / contexte / 3 points / CTA"
    targetLength: number | null, // null = DÉRIVÉ du média (§8.3)
    hookPatterns: HookPattern[], // sous-ensemble des 4 patterns (§8.4)
    examples: string[],          // 1 à 3 posts de référence — LE levier qualité
    forbiddenPhrases: string[]
  },

  visual: {
    mode: 'none' | 'image' | 'carousel',
    templateId: string | null,   // ref au registry (§9) — null = l'IA choisit
    carouselSlides: number       // 3 à 10
  },

  defaultHashtags: string[],
  active: boolean,
  createdAt, updatedAt
}
```
> `ai.examples` détermine 80 % de la qualité de sortie. L'UI doit rendre ce champ difficile à ignorer : un thème sans exemple affiche un avertissement explicite.

### 6.2 `slots`
```ts
{
  _id, label,
  dayOfWeek: 1..7,              // ISO, 1 = lundi
  time: "09:00",                // TOUJOURS en Europe/Paris
  themeId: ObjectId,            // obligatoire
  modeOverride: 'queue' | 'auto' | null,   // null = suit le réglage global
  active: boolean
}
```
Seed : `mar 09:00`, `jeu 12:00`, `ven 17:30`.

### 6.3 `posts`
```ts
{
  _id,
  content: string,              // ≤ 3000 caractères
  hashtags: string[],
  themeId: ObjectId | null,

  status: 'draft' | 'queued' | 'scheduled' | 'publishing'
        | 'published' | 'failed' | 'archived',
  source: 'manual' | 'ai' | 'json-import' | 'sheets-migration',

  media: {
    kind: 'none' | 'image' | 'document',
    assetId: ObjectId | null,
    altText: string,            // obligatoire si kind ≠ none
    title: string               // requis par LinkedIn pour un document
  },

  firstComment: {               // §10.6 — les liens vivent ICI, jamais dans le post
    text: string | null,
    status: 'none' | 'pending' | 'posted' | 'failed',
    urn: string | null,
    error: string | null
  },

  queuePosition: number,        // FIFO, réordonnable
  scheduledAt: Date | null,     // UTC, si status = 'scheduled'
  publishedAt: Date | null,
  linkedin: { urn: string | null, url: string | null },

  attempts: number,
  lastError: string | null,
  aiMeta: { model, promptVersion, generatedAt, editedByHuman } | null,

  createdAt, updatedAt
}
```
**Index :** `{ status, themeId, queuePosition }` · `{ status, scheduledAt }`.

### 6.4 `assets`
```ts
{
  _id, kind: 'image' | 'pdf', filename, mimeType, sizeBytes, width, height,
  generatedFrom: { templateId, params } | null,   // permet la régénération
  linkedinUrn: string | null,                     // cache : ne jamais ré-uploader
  createdAt
}
```

### 6.5 `publications` — journal d'exécution
```ts
{
  _id, idempotencyKey /* UNIQUE */, postId, slotId, triggeredAt,
  mode: 'queue' | 'auto' | 'manual' | 'scheduled',
  outcome: 'published' | 'empty_queue' | 'generation_failed'
         | 'validation_failed' | 'api_failed' | 'comment_failed' | 'skipped',
  durationMs, linkedinStatus, linkedinResponse /* tronqué à 4 Ko */, error
}
```
C'est l'outil de debug sans SSH.

### 6.6 `settings` (singleton)
```ts
{
  _id: 'singleton',
  autoGeneration: boolean,      // LE switch (§7.3)
  dryRun: boolean,              // simule sans publier — indispensable en recette
  timezone: 'Europe/Paris',
  minQueueAlert: number,        // défaut 3
  pushover: { enabled, userKey, appToken },
  linkedin: {
    authorUrn,                  // via /v2/userinfo — JAMAIS saisi à la main
    accessToken, refreshToken,  // chiffrés au repos (AES-256-GCM)
    expiresAt, refreshExpiresAt
  },
  ai: { model: 'claude-sonnet-5', temperature: 1.0 }
}
```

---

## 7. Logique métier

### 7.1 Le tick du worker (toutes les 60 s)
```
1. Prendre le verrou global "tick" (TTL 55 s) — sinon sortir.
2. now = DateTime.now().setZone('Europe/Paris')
3a. Créneaux : slots actifs où dayOfWeek == now.weekday ET time == now.toFormat('HH:mm')
       → resolvePublication(slot)
3b. One-shots : posts où status='scheduled' ET scheduledAt <= now
       → publishPost(post, mode='scheduled')
4. Relâcher le verrou.
```
**Rattrapage :** un créneau manqué depuis moins de 15 min est rattrapé (worker redémarré). Au-delà → loggé en `skipped`. Pas de publication à 3 h du matin après un redéploiement.

### 7.2 `resolvePublication(slot)` — la règle centrale
```
mode = slot.modeOverride ?? (settings.autoGeneration ? 'auto' : 'queue')

── mode 'queue' ──────────────────────────────────────────
post = premier post où status='queued' ET themeId = slot.themeId,
       trié par queuePosition ASC              (FIFO par thème)
SI aucun :
    log 'empty_queue'
    Pushover  🚨 "File vide — thème {theme} — créneau {slot} raté"
    FIN, rien n'est publié.               ← aucun repli sur un autre thème
SINON publishPost(post)

── mode 'auto' ───────────────────────────────────────────
⚠️ La file n'est PAS consommée. Elle reste intacte, en réserve.
post = generatePost(slot.themeId)          // appel Claude à la volée
SI échec (génération ou validation) :
    log 'generation_failed' | 'validation_failed'
    Pushover  🚨 "Génération échouée — {theme} — créneau raté"
    FIN, rien n'est publié.
SINON persister (source='ai') puis publishPost(post)
```

### 7.3 Le switch Auto / File
Toggle **global**, très visible dans le header, état écrit en toutes lettres. Override **par créneau** (`slot.modeOverride`) pour, par exemple, laisser le vendredi en auto et le reste en file. Le mode effectif de chaque créneau est lisible d'un coup d'œil sur le calendrier (badge `IA` / `File`).

### 7.4 Fuseau horaire — critique
Le VPS n'est pas garanti en `Europe/Paris`.
- Toutes les dates **stockées en UTC**.
- Tous les calculs de créneaux **en `Europe/Paris`** via Luxon, quel que soit le fuseau du conteneur.
- `TZ=Europe/Paris` forcé dans l'env des deux services (ceinture + bretelles).
- L'UI affiche toujours l'heure de Paris, mention explicite « (heure de Paris) ».
- **Aucun élément de l'app n'expose le fuseau du navigateur ou du serveur.** Interdiction de `new Date().toLocaleString()` côté client sans zone forcée.

---

## 8. Génération IA

### 8.1 Modèle et budget
**`claude-sonnet-5`**, `max_tokens: 2000`, `temperature: 1.0`. Modèle en `.env`, bumpable sans redéploiement.

Tarif d'introduction : **2 $ / 10 $ par million de tokens** (entrée / sortie) jusqu'au 31/08/2026, puis 3 $ / 15 $. Il est donc actuellement *moins cher* que Sonnet 4.6.

| | Coût |
|---|---|
| Une génération (~3 000 tk in, ~800 tk out) | **~1,4 ¢** |
| 12 posts/mois en auto | **~0,17 $/mois** |
| + génération manuelle en 3 variantes, 2×/semaine | **~0,60 $/mois** |

Décisions à respecter :
- **Ne pas descendre sur Haiku.** L'économie serait de quelques centimes par an, payée en qualité de voix — le seul critère qui compte ici.
- **Pas de prompt caching.** Le cache expire en 5 min ou 1 h ; les appels sont espacés de plusieurs jours. Zéro hit. Ne pas complexifier le code pour rien.
- **Pas de Batch API.** 50 % de remise sur 0,17 $, contre 24 h de latence, incompatible avec la génération au moment du créneau.

### 8.2 Deux points d'entrée, une seule fonction
1. **Manuelle (UI)** — « Générer » depuis un thème → **3 variantes** → l'utilisateur choisit, édite, met en file.
2. **Automatique (worker)** — appelée par `resolvePublication` en mode auto → publie sans relecture.

Les deux appellent `generatePost(themeId, opts)`. Une seule source de vérité.

### 8.3 Longueur cible — dérivée du média
| Type de post | Texte |
|---|---|
| Texte seul | **900 – 1 500** caractères |
| Texte + image | **600 – 1 000** (l'image porte) |
| Carrousel | **300 – 600** (le carrousel porte ; le texte n'est qu'une accroche) |

`theme.ai.targetLength = null` → dérivé de `theme.visual.mode`. Une valeur explicite écrase la dérivation.

### 8.4 Le hook — patterns figés
La ligne 1 fait **≤ 100 caractères** et doit tenir seule : c'est tout ce qui est visible avant le « …voir plus ». Le prompt impose l'un des quatre patterns suivants (sélectionnables par thème via `ai.hookPatterns`) :

| Pattern | Forme |
|---|---|
| `aveu` | « J'ai mis trois ans à comprendre que… » |
| `chiffre` | Un chiffre contre-intuitif : « 8 candidats sur 10 échouent sur… » |
| `erreur-commune` | « Ton code marche. C'est exactement le problème. » |
| `question-fermee` | « Tu sais ce qui fait rater une soutenance DWWM ? » |

Interdits explicites : annonce de sommaire (« Voici 5 astuces 👇 »), « Spoiler : », « Et devinez quoi ? ».

### 8.5 La voix — contexte fixe injecté dans chaque `system`
> Formateur freelance en développement web, intervient sur les titres **CDA** et **DWWM**, en distanciel. Public : développeurs juniors, personnes en reconversion, autres formateurs, recruteurs tech. Ton : praticien qui enseigne, pas gourou qui sermonne. Le « je » est souhaitable. **Une anecdote de session vaut mieux que dix généralités.**

**Règle dure, non négociable :**
> Ne jamais mentionner ni suggérer de localisation géographique, de ville, de pays, de fuseau horaire, de décalage horaire, de voyage ou d'expatriation. Aucun marqueur temporel local (« ce matin il faisait… », « ici il est déjà… »).

Sans cette règle, un modèle qui improvise une anecdote inventera un contexte géographique.

### 8.6 Anti-répétition (obligatoire)
Injecter les **10 derniers posts publiés du même thème** (tronqués à 200 caractères) avec la consigne : *« Ne reprends aucun de ces angles. Propose un sujet différent. »* Sans ça, en mode auto, tu reposteras sur les closures tous les mardis pendant six mois.

### 8.7 Le contrat de sortie
Sortie **JSON strict** — pas de préambule, pas de backticks :
```json
{
  "content": "…",
  "hashtags": ["#…"],
  "firstComment": "…" | null,     // les liens vont ICI (§10.6)
  "visual":   { … } | null,       // schéma issu du registry (§9)
  "carousel": { "slides": [ … ] } | null,
  "altText": "≤ 120 caractères"
}
```

> **Le contrat n'est jamais écrit à la main.** Il est **généré depuis le registry de templates** (§9.1). Ajouter un template met automatiquement à jour le prompt, le validateur et le bouton « Copier le prompt ».

### 8.8 Le validateur — la vraie garantie
`validateGeneratedPost(json, theme)` — appelé par **les trois** points d'entrée : génération API, import JSON manuel, éditeur UI.

```
✗ content.length > 3000                          → rejet (limite dure LinkedIn)
✗ première ligne > 100 caractères                → rejet
✗ markdown détecté  /\*\*|^#{1,6}\s|^\s*-\s/m    → rejet (LinkedIn l'affiche littéralement)
✗ contient http:// ou https://                   → rejet (les liens vont en firstComment)
✗ hashtags hors [3..5] ou mal formés             → rejet
✗ une forbiddenPhrase du thème est présente      → rejet
✗ un champ de visual/carousel dépasse sa limite  → rejet (§9.2)
⚠ content hors de la fourchette de longueur      → avertissement, non bloquant
```
**Génération API :** 1 retry avec l'erreur exacte citée au modèle, puis échec propre + Pushover.
**Import manuel :** erreurs affichées champ par champ dans l'UI.

### 8.9 Le bouton « Copier le prompt »
Sur chaque fiche thème :

**« Copier le prompt complet »** → presse-papier, prompt **autonome**, prêt à coller dans n'importe quel chat LLM, contenant :
1. le contexte fixe (§8.5) et la règle dure ;
2. les consignes du thème (`systemPrompt`, `structure`, `hookPatterns`, `forbiddenPhrases`) ;
3. les **exemples few-shot** du thème ;
4. les **10 derniers posts publiés** de ce thème + consigne « change d'angle » ;
5. le **contrat JSON généré depuis le registry**, avec toutes les limites de caractères, adapté au `visual.mode` du thème ;
6. « Réponds uniquement par le JSON, sans préambule, sans backticks. »

**« Copier le schéma seul »** → juste le contrat, pour itérer dans une conversation déjà lancée.

En face, l'onglet **Importer** accepte ce JSON (objet **ou** tableau), le valide en direct, **affiche l'aperçu du visuel rendu**, et laisse corriger avant insertion. La boucle est fermée : tu génères où tu veux, l'app reste le seul gardien de la qualité.

---

## 9. Visuels — un registry, pas une liste

### 9.1 Contrat de template
```ts
interface VisualTemplate<P> {
  id: string;                                  // 'code-card'
  label: string;                               // 'Snippet de code'
  kind: 'post' | 'slide' | 'both';             // image, slide de carrousel, ou les deux
  schema: ZodSchema<P>;                        // params + LIMITES DE CARACTÈRES
  promptHint: string;                          // injecté dans le prompt de génération
  render(params: P, tokens: DesignTokens): JSX.Element;   // rendu Satori
}
```
Un template = **un fichier** dans `src/modules/linkedin/visuals/templates/`, auto-enregistré dans le registry. Le prompt, le validateur et le contrat JSON **dérivent du registry** — jamais maintenus à la main.

### 9.2 Pourquoi les limites de caractères vivent dans le `schema`
Satori **ne dégrade pas gracieusement** : un titre trop long déborde de sa boîte ou chevauche le contenu. Ces limites ne sont pas du confort, ce sont les contraintes physiques du rendu 1200×1200. Elles doivent donc vivre au même endroit que le rendu, et être imposées **au modèle** (via `promptHint`) **et au validateur** (via `schema`). C'est le point qu'un LLM rate systématiquement si on ne le contraint pas.

Ordres de grandeur : titre ≤ 55 car. · sous-titre ≤ 90 · puce ≤ 65 (3 à 5 puces) · code ≤ 14 lignes × 60 colonnes · citation ≤ 160 · altText ≤ 120.

### 9.3 Direction pour la première fournée
Format **1200 × 1200** (carré : le plus performant en feed). Tokens et polices **identiques au dashboard** (§4). Produire 5 à 6 templates dans cette direction, ancrés dans le métier de formateur dev :

- **`code-card`** — snippet coloré, JetBrains Mono, fond encre, accent ambre.
- **`before-after`** — code moche → code propre, en deux colonnes. Le plus efficace en formation.
- **`tip-card`** — titre + 3 à 5 puces.
- **`checklist`** — liste à cocher (« les 5 erreurs qui font rater un CDA »).
- **`quote`** — punchline centrée.
- **`cover` / `cta`** — couverture et clôture de carrousel.

Claude Code est libre d'en ajouter ou d'en écarter, tant que le contrat est respecté. On élaguera à l'usage.

### 9.4 Carrousel
`visual.mode = 'carousel'` → l'IA renvoie N slides → N PNG → assemblage en **un PDF** (pdf-lib) → upload via l'API Documents.
Règles : **3 à 10 slides** · slide 1 = couverture avec promesse chiffrée · slides intermédiaires = **une idée par slide**, jamais deux · dernière slide = CTA.

### 9.5 Prévisualisation
`/api/linkedin/visuals/preview` → rendu à la volée, non persisté. L'UI permet de **prévisualiser, régénérer et éditer les paramètres** d'un visuel avant mise en file.

---

## 10. Intégration LinkedIn

### 10.1 App LinkedIn
Produits : **Sign In with LinkedIn using OpenID Connect** + **Share on LinkedIn**.
Scopes : `openid profile w_member_social`.

### 10.2 OAuth
`/api/linkedin/auth` → autorisation · `/api/linkedin/callback` → échange du code.
URN récupéré via `GET /v2/userinfo` → `authorUrn = "urn:li:person:" + sub`. **Jamais saisi à la main.**
Tokens **chiffrés au repos** (AES-256-GCM, clé `ENCRYPTION_KEY`).

### 10.3 Refresh du token — point de douleur n°1
Access token : **60 jours**. Refresh token : **365 jours**.
Job quotidien du worker :
- `expiresAt - now < 7 j` → refresh automatique.
- `refreshExpiresAt - now < 14 j` → **Pushover** : « ⚠️ Reconnexion LinkedIn requise avant le {date} », avec le lien direct vers la page de connexion.
- Un `401` en cours de publication → tentative de refresh + retry immédiat.

### 10.4 Publication
Client abstrait `LinkedInClient`, implémentation `PostsApiClient` sur **`/rest/posts`** (l'endpoint `/v2/ugcPosts` utilisé par n8n est **déprécié**).

**Headers :**
```
Authorization: Bearer {token}
LinkedIn-Version: {YYYYMM}        // en .env, bumpable sans redéploiement
X-Restli-Protocol-Version: 2.0.0
Content-Type: application/json
```

**Texte :**
```json
{
  "author": "urn:li:person:{id}",
  "commentary": "{texte}\n\n{hashtags}",
  "visibility": "PUBLIC",
  "distribution": { "feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": [] },
  "lifecycleState": "PUBLISHED",
  "isReshareDisabledByAuthor": false
}
```

**Image :**
1. `POST /rest/images?action=initializeUpload` → `{ "initializeUploadRequest": { "owner": "{authorUrn}" } }`
2. Réponse → `value.uploadUrl` + `value.image` (l'URN)
3. `PUT {uploadUrl}` avec le binaire PNG
4. Post avec `"content": { "media": { "id": "{imageUrn}", "altText": "…" } }`

**Carrousel PDF :** identique via `POST /rest/documents?action=initializeUpload`, puis `"content": { "media": { "id": "{documentUrn}", "title": "…" } }`.

**URN du post :** header de réponse `x-restli-id` (201).

### 10.5 Pièges à traiter explicitement
- ⚠️ **Échappement du `commentary`** : format « Little Text » de LinkedIn ; plusieurs caractères spéciaux (`( ) [ ] { } < > @ | ~ _ *`) doivent être précédés d'un backslash, sinon **422**. → util `escapeCommentary()` + tests. **À caractériser au Lot 0.**
- **Rate limit** : ~100 appels/jour/membre. Largement suffisant, mais logguer les 429 sans boucler.
- **3 000 caractères max**, hashtags inclus.
- **Aucune API de scheduling chez LinkedIn** : la publication est immédiate. C'est notre worker qui tient le calendrier.
- **`@mentions` et sondages impossibles** via l'API → ne pas les proposer dans l'UI.

### 10.6 Premier commentaire automatique
Un lien dans le corps d'un post **écrase sa portée**. Les liens vont donc systématiquement dans le premier commentaire — et le validateur (§8.8) rejette tout post qui en contient un.

Après un `201` sur le post :
```
POST /rest/socialActions/{postUrn}/comments
{ "actor": "{authorUrn}", "object": "{postUrn}", "message": { "text": "{firstComment}" } }
```

**En cas d'échec :** le post reste **publié** (`status: 'published'`), `firstComment.status` passe à `failed`, l'incident est loggé en `comment_failed`, notifié via Pushover, et l'UI propose **« Réessayer le commentaire »**. **Un échec de commentaire ne dépublie jamais un post.**

> ⚠️ Cette API est documentée sous la Community Management API. Rien ne garantit que `w_member_social` seul suffise. **À valider au Lot 0.** Si elle est inaccessible : dégradation propre — le champ `firstComment` reste stocké, affiché dans l'UI avec un bouton « Copier », et posté à la main.

### 10.7 Mode `dryRun`
`settings.dryRun = true` → tout le pipeline s'exécute (résolution, génération, validation, rendu du visuel, construction du payload), mais **aucun appel HTTP vers LinkedIn**. Une entrée `publications` est écrite avec `outcome: 'skipped'` et le payload complet. Indispensable pour recetter sans polluer ton profil.

---

## 11. Notifications (Pushover)

`POST https://api.pushover.net/1/messages.json` — un simple `fetch`.

| Événement | Priorité | Message |
|---|---|---|
| File vide sur un créneau | 1 | 🚨 File vide — {thème} — créneau {slot} raté |
| Génération IA échouée | 1 | 🚨 Génération échouée — {thème} — {erreur} |
| Publication échouée (après retries) | 1 | 🚨 Publication échouée — {erreur} |
| Premier commentaire échoué | 0 | ⚠️ Post publié, commentaire échoué — réessayer |
| File sous le seuil | 0 | ⚠️ Plus que {n} posts en file |
| Reconnexion LinkedIn requise | 1 | ⚠️ Reconnexion LinkedIn avant le {date} |
| Publication réussie | −1 (silencieuse) | ✅ Publié : {30 premiers caractères}… |

Chaque notification embarque un lien direct vers la page concernée.

---

## 12. Interface

Sidebar sombre, deux sections de premier niveau : **LinkedIn** et **Mailing** (grisé, « Bientôt »). C'est ce qui matérialise la séparation des domaines dès le premier coup d'œil.

### `/linkedin` — Dashboard
- Le **switch Auto / File**, dominant, état écrit en toutes lettres.
- Bandeau **dryRun** si actif (impossible à louper).
- **La colonne de file** (§4.4) + compte à rebours vers le prochain créneau, en mono.
- Prochaines publications : 5 créneaux à venir → date, heure, thème, **quel post partira** — ou « ⚠️ file vide ».
- Compteur de file **par thème**, alerte visuelle sous le seuil.
- État de la connexion LinkedIn (✅ / expire dans N jours).
- 3 dernières publications, avec lien vers le post.

### `/linkedin/posts` — La file
Onglets par statut (File / Brouillons / Programmés / Publiés / Échecs). **Drag & drop** pour réordonner (persiste `queuePosition`). Filtre par thème. Actions : éditer, dupliquer, changer de thème, **publier maintenant**, archiver, réessayer le commentaire.
**Aperçu fidèle LinkedIn** : troncature « …voir plus » au bon endroit, hashtags en bleu, visuel, premier commentaire. **Compteur de caractères en direct**, avec le repère de troncature.

### `/linkedin/posts/new` — Éditeur
Trois modes, un seul écran :
1. **Écrire** — textarea + aperçu live.
2. **Générer** — thème → 3 variantes côte à côte → « Utiliser celle-ci » → bascule en mode Écrire, pré-rempli.
3. **Importer** — texte (blocs séparés par `---`, compatible avec le format n8n actuel) **ou** JSON (§8.7). Validation en direct, aperçu du lot et du visuel, affectation d'un thème au lot entier.

Panneau latéral : thème · hashtags · **premier commentaire** · visuel (aperçu + « Régénérer » + édition des paramètres) · destination (`File` / `Brouillon` / `Programmer le…`).

### `/linkedin/themes`
CRUD. **Le formulaire le plus important de l'app** : prompt système, structure, patterns de hook, longueur (ou « dérivée du média »), exemples few-shot, formulations interdites, hashtags, visuel avec **aperçu en direct**.
Bouton **« Tester la génération »** → génère sans rien persister. Boucle de feedback essentielle pour régler un thème.
Boutons **« Copier le prompt complet »** et **« Copier le schéma »** (§8.9).

### `/linkedin/calendar`
Vue semaine récurrente, créneaux colorés par thème. Édition : jour, heure, thème, override de mode, actif. Vue « 4 prochaines semaines » projetant les publications réelles et **signalant les trous**.

### `/linkedin/history`
Table des `publications` : date, créneau, mode, résultat, durée, erreur, lien LinkedIn, payload envoyé (repliable). Filtrable. C'est l'outil de debug.

### `/settings`
Connexion LinkedIn (état du token, « Reconnecter ») · Pushover (+ **« Envoyer un test »**) · seuil d'alerte · `dryRun` · modèle Claude.

---

## 13. Routes API

Toutes sous `/api/linkedin/*`, protégées par la session, validées par zod.

```
GET    /posts ?status=&themeId=
POST   /posts
PATCH  /posts/:id
DELETE /posts/:id
POST   /posts/reorder            { orderedIds: string[] }
POST   /posts/:id/publish        publication immédiate
POST   /posts/:id/retry-comment  réessayer le premier commentaire
POST   /posts/import             { mode: 'text'|'json', raw, themeId, hashtags }

POST   /generate                 { themeId, variants?: 1|3, persist?: boolean }

GET|POST|PATCH|DELETE  /themes[/:id]
POST   /themes/:id/test-generation
GET    /themes/:id/prompt        → le prompt complet, prêt à copier

GET|POST|PATCH|DELETE  /slots[/:id]
GET    /slots/upcoming           projection des N prochaines publications

GET    /visuals/templates        le registry, pour l'UI
POST   /visuals/preview          { templateId, params } → PNG non persisté
GET    /api/assets/:id           asset protégé par session

GET    /auth  |  GET /callback  |  GET /status
GET    /history
GET|PATCH  /api/settings
POST   /api/settings/test-pushover
```

---

## 14. Sécurité

Mono-utilisateur : mot de passe unique (hash **argon2** en `.env`), session en cookie **httpOnly, secure, sameSite=lax**, signée. **Pas de NextAuth** — surdimensionné.
Middleware Next protégeant tout sauf `/login` et le callback OAuth. Rate limit sur `/login` (5 essais / 15 min).
Tokens LinkedIn chiffrés au repos. Aucun secret dans le repo (`.env.example` fourni). Le worker n'expose aucun port.

---

## 15. Modularité — préparer le Mailing

```
src/
  modules/
    linkedin/
      domain/          types, schémas zod, règles pures (testables sans DB)
      services/        scheduler, generator, publisher, visuals
      repositories/    accès Mongo
      linkedin-api/    client HTTP isolé, mockable
      visuals/
        templates/     un fichier = un template
        registry.ts
      design/tokens.ts ← partagé avec Tailwind ET Satori
    mailing/           vide en v1, même structure plus tard
    shared/            db, auth, pushover, crypto, logger, luxon
  app/
    (dashboard)/linkedin/…
    (dashboard)/mailing/…      ← plus tard
    api/linkedin/…
  worker/
    index.ts
    jobs/  publish-tick.ts · refresh-token.ts · queue-alert.ts
```

**Règle absolue :** `modules/linkedin` et `modules/mailing` ne s'importent **jamais** l'un l'autre. Tout ce qui est commun passe par `shared/`. Base MongoDB partagée, collections disjointes.

---

## 16. Migration depuis l'existant

`scripts/migrate-from-sheets.ts` :
1. Lire le CSV exporté du Sheet (`id`, `contenu`, `hashtags`, `statut`, `date_publie`).
2. `"À publier"` → `status: 'queued'`, `queuePosition` = ordre du fichier.
3. `"Publié ✅"` → `status: 'published'`, `publishedAt` parsé depuis `date_publie` (format `fr-FR`).
4. `source: 'sheets-migration'`, `themeId: null` → prévoir une action **« affecter un thème en masse »** dans l'UI.
5. Idempotent : ne réimporte pas un `id` déjà présent.

Puis **arrêter le workflow n8n**, sinon double publication.

---

## 17. Ordre de développement

> Livrer **par lots**. Chaque lot fonctionnel et testé avant le suivant. Ne pas tout coder d'un bloc.

**Lot 0 — Spike LinkedIn (< 1 h, avant toute ligne d'app).**
`scripts/spike-linkedin.ts`, avec un token obtenu à la main :
- publier un post texte via `/rest/posts` ;
- **caractériser l'échappement du `commentary`** (§10.5) ;
- publier un post avec image (Images API) ;
- **tenter un post avec PDF** (Documents API) ;
- **tenter un premier commentaire** (`/rest/socialActions/…/comments`).

Ce spike valide ou invalide le carrousel et le premier commentaire. Les deux ont un repli propre : le reste du produit n'en dépend pas.

**Lot 1 — Socle.** Next.js, Mongo, auth, design system (§4), layout, settings, CRUD Thèmes.
**Lot 2 — Posts.** CRUD, file, drag & drop, import texte/JSON, aperçu LinkedIn, script de migration.
**Lot 3 — Publication.** Client LinkedIn, OAuth, `dryRun`, publication manuelle, premier commentaire, historique.
**Lot 4 — Scheduler.** Worker, créneaux, calendrier, verrous, idempotence, Pushover, refresh du token.
**Lot 5 — IA.** `generatePost`, validateur, anti-répétition, 3 variantes, switch Auto/File, « Copier le prompt ».
**Lot 6 — Visuels.** Registry, templates, prévisualisation, upload image, puis carrousel si le Lot 0 l'a validé.

---

## 18. Critères d'acceptation

- [ ] Je crée un thème avec ses consignes et 2 exemples ; « Tester la génération » produit un post qui sonne comme moi.
- [ ] Je crée un créneau « mercredi 08:30 → Pédagogie » depuis l'UI, sans toucher au code.
- [ ] Je colle 10 posts séparés par `---`, je les affecte à un thème, ils entrent dans la file dans le bon ordre.
- [ ] Je réordonne la file en drag & drop ; l'ordre est persisté.
- [ ] Mode **File** : au créneau, le premier `queued` du bon thème part, passe en `published`, avec le lien LinkedIn.
- [ ] Mode **File**, file vide : **aucune publication**, Pushover reçu sur mon téléphone.
- [ ] Mode **Auto** : un post est généré à la volée et publié ; **la file n'est pas touchée**.
- [ ] Mode **Auto**, génération échouée : aucune publication, Pushover.
- [ ] Un post contenant un lien est **rejeté** par le validateur ; le lien passe en premier commentaire.
- [ ] Le premier commentaire échoue → le post reste publié, l'UI propose « Réessayer ».
- [ ] Un thème en `visual.mode = 'image'` publie avec le visuel généré, aux bonnes dimensions, **sans débordement de texte**.
- [ ] Je copie le prompt d'un thème, je le colle dans un chat, je récupère un JSON, je le colle dans l'app : **il passe le validateur du premier coup**.
- [ ] `dryRun = true` : tout s'exécute, rien n'est publié, l'historique le prouve.
- [ ] Deux workers lancés simultanément ne publient **pas** deux fois (test à écrire).
- [ ] Le serveur en `TZ=UTC` publie quand même à 9 h **heure de Paris**.
- [ ] Un post de 3 050 caractères est refusé côté UI **et** côté API.
- [ ] Le token LinkedIn se rafraîchit seul ; l'alerte arrive avant l'expiration du refresh token.
- [ ] Aucun secret ni URN en dur dans le code source.
- [ ] Ajouter un template de visuel = **un seul fichier** ; le prompt et le validateur se mettent à jour sans intervention.

---

## 19. Variables d'environnement

```env
# App
APP_URL=https://posty.mondomaine.fr
AUTH_PASSWORD_HASH=            # argon2
SESSION_SECRET=                # 32+ caractères
ENCRYPTION_KEY=                # 32 octets base64 — chiffrement des tokens LinkedIn
TZ=Europe/Paris

# Mongo
MONGODB_URI=
MONGODB_DB=posty

# LinkedIn
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://posty.mondomaine.fr/api/linkedin/callback
LINKEDIN_API_VERSION=202506    # header LinkedIn-Version

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5

# Pushover
PUSHOVER_USER_KEY=
PUSHOVER_APP_TOKEN=

# Assets
ASSETS_DIR=/data/assets
```

---

## 20. Hypothèses tranchées

1. **Mode Auto** : la file n'est pas consommée ; elle reste en réserve.
2. **Pas de repli de thème** : en mode File, si le thème du créneau n'a pas de post, on ne publie rien. Un réglage `allowThemeFallback` pourra être ajouté plus tard.
3. **Carrousel PDF** et **premier commentaire** : dépendent du Lot 0. Repli propre prévu pour les deux. Non bloquants.
4. **Analytics** : hors périmètre (API membre restreinte).
5. **Week-ends et jours fériés** : aucun filtrage. Les créneaux définis sont respectés tels quels.
6. **`targetLength`** : dérivé du média par défaut, surchargeable par thème.
