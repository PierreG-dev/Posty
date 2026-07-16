# Spike LinkedIn — rapport

> **Statut :** ✅ EXÉCUTÉ — 2026-07-14 14:14 UTC — API version `202506` — 25 posts créés, 25 supprimés par `--cleanup`, 0 fuite.

---

## Contexte

**But** — lever trois incertitudes AVANT le lot 3 (client LinkedIn, publication) et le lot 6 (carrousel visuel) :

1. Notre client REST parle bien à `/rest/posts` (l'endpoint moderne — `/v2/ugcPosts` utilisé par le n8n actuel est déprécié).
2. Quels caractères du champ `commentary` exigent réellement un backslash (§10.5 CDC-01, incertitude « à caractériser au Lot 0 »).
3. Est-ce que le scope `w_member_social` seul suffit pour la Documents API (carrousel PDF, §10.4) et la Social Actions API (premier commentaire automatique, §10.6).

**Méthode** — le script `scripts/spike-linkedin.ts` :
- Prend un access token 3-legged OAuth en `LINKEDIN_ACCESS_TOKEN`.
- Résout l'URN auteur via `GET /v2/userinfo` (ou lit `LINKEDIN_AUTHOR_URN` en env).
- Enchaîne 5 tests, chacun avec log complet de la requête et de la réponse.
- Émet `docs/spike-linkedin.json` : synthèse structurée.
- `--cleanup` : `DELETE /rest/posts/{urn}` sur chaque post créé pendant le run.

---

## Comment reproduire

1. **Obtenir un access token** — deux options :
   - **Recommandé** : va sur `https://www.linkedin.com/developers/tools/oauth/token-generator`, choisis ton app, coche les scopes `openid`, `profile`, `w_member_social`, valide. LinkedIn te renvoie un token valide 60 jours.
   - À la main : lance le flow OAuth de ton app, échange le code sur `https://www.linkedin.com/oauth/v2/accessToken`.

2. **Poser les variables.** Option **A** recommandée (portable, ne fuite pas dans l'historique shell) : créer `.env.local` à la racine (déjà gitignoré) :
   ```
   LINKEDIN_ACCESS_TOKEN=<ton_token>
   LINKEDIN_API_VERSION=202506
   # LINKEDIN_AUTHOR_URN=urn:li:person:XXX   # facultatif, sinon /v2/userinfo
   ```
   Le script npm charge ce fichier automatiquement s'il existe (`tsx --env-file-if-exists=.env.local`).

   Option **B** — session shell éphémère :
   - **PowerShell** : `$env:LINKEDIN_ACCESS_TOKEN = "<token>"`
   - **cmd.exe** : `set LINKEDIN_ACCESS_TOKEN=<token>`
   - **bash / zsh** : `export LINKEDIN_ACCESS_TOKEN=<token>`

3. `npm run spike:linkedin -- --dry` (sanity check).
4. `npm run spike:linkedin -- --live --cleanup` (le vrai run — publie puis supprime).
5. Options utiles : `--only=text,chars` · `--chars="( @ |"` · `--delay-ms=750`.

---

## Résultats

### Test 1 — publication texte via `/rest/posts`

- **Verdict** : ✅ **OK**
- **Code HTTP** : `201`
- **URN retourné** : `urn:li:share:7482799659132977152`
- **Notes** : endpoint `/rest/posts` opérationnel avec les headers `Authorization`, `LinkedIn-Version: 202506`, `X-Restli-Protocol-Version: 2.0.0`. Le payload structuré `{ author, commentary, visibility, distribution, lifecycleState, isReshareDisabledByAuthor }` est accepté tel quel. **`/v2/ugcPosts` (utilisé par le n8n actuel) peut être abandonné dès le lot 3.**

### Test 2 — échappement du `commentary`

⚠️ **Résultat AMBIGU. À lire avec le paragraphe d'interprétation qui suit le tableau.**

| Caractère | Unescaped | Escaped | Message d'erreur (si 422) |
|:---:|:---:|:---:|:---|
| `(`  | `201 OK` | `201 OK` | — |
| `)`  | `422 FAIL` | `201 OK` | `Content is a duplicate of urn:li:share:7482799669719359489` |
| `[`  | `201 OK` | `201 OK` | — |
| `]`  | `422 FAIL` | `201 OK` | `Content is a duplicate of urn:li:share:7482799685519302656` |
| `{`  | `201 OK` | `201 OK` | — |
| `}`  | `422 FAIL` | `201 OK` | `Content is a duplicate of urn:li:share:7482799700853714944` |
| `<`  | `201 OK` | `201 OK` | — |
| `>`  | `201 OK` | `201 OK` | — |
| `@`  | `201 OK` | `201 OK` | — |
| `\|` | `422 FAIL` | `201 OK` | `Content is a duplicate of urn:li:share:7482799733707759617` |
| `~`  | `201 OK` | `201 OK` | — |
| `_`  | `201 OK` | `201 OK` | — |
| `*`  | `201 OK` | `201 OK` | — |

#### Ce que ce tableau dit vraiment

Les 4 caractères qui ont échoué non-échappés (`)`, `]`, `}`, `|`) l'ont fait avec **le même message** : `Content is a duplicate of urn:li:share:XXX`. Ce n'est **pas** une erreur « caractère invalide », c'est une déduplication de contenu par LinkedIn — et les URN cités dans le message ne font partie d'aucun post que le spike a créé.

Deux observations en découlent :

1. **LinkedIn parse ces caractères d'une manière qui peut effacer leur différence** avec des posts très courts et similaires. Le fait que `)`, `]`, `}`, `|` non-échappés produisent un « duplicate » (alors que leurs versions ouvrantes `(`, `[`, `{` passent, et que `@`, `<`, `>`, `~`, `_`, `*` passent aussi) suggère très fortement que **certains caractères sont traités comme du markup** — a minima les fermants et le pipe (séparateur). Le CDC (§10.5) parle du format « Little Text » de LinkedIn qui a effectivement une syntaxe interne.
2. **Le spike n'a PAS obtenu de 422 « invalid character »**, donc il ne prouve pas directement que ces caractères déclencheraient un rejet en production sur un post réel de ~1000 caractères — le duplicate est un artefact de la faible longueur du contenu de test.

#### Décision retenue pour le lot 3

**Échapper les 13 caractères listés au CDC.** `escapeCommentary()` préfixe systématiquement `( ) [ ] { } < > @ | ~ _ *` d'un `\`. Justifications :

- Le CDC les liste comme exigeant l'échappement — le spike a *renforcé* la présomption (parsing invisible confirmé par le duplicate), il ne l'a pas *contredite*.
- Le coût de l'échappement est nul (une regex).
- Le risque de ne pas échapper est un rejet inattendu en prod, jamais reproductible en dev seul.
- La version « escaped » a **toujours** passé (13/13 → 201), donc échapper n'a **jamais** cassé un post.

**Test à écrire au lot 3** : `escapeCommentary()` produit une chaîne où **chacun** des 13 caractères est précédé d'un `\`, sauf s'il l'est déjà. Un `it()` par caractère, tableau réutilisé depuis ce spike.

#### Limite reconnue

Une meilleure caractérisation exigerait de refaire un test avec un **payload unique par appel** (préfixé par un timestamp ou un UUID) pour éliminer le facteur duplicate. Ce n'est pas nécessaire pour trancher, mais ça reste ouvert si l'échappement casse un rendu utile plus tard (ex : un `_` volontaire dans du code cité).

### Test 3 — publication avec image (Images API)

- **`POST /rest/images?action=initializeUpload`** : ✅ OK (contenu de la réponse : `uploadUrl` + `image` URN).
- **`PUT` sur `uploadUrl`** : ✅ OK.
- **`POST /rest/posts` avec `content.media.id`** : ✅ **OK**, `201`, URN post : `urn:li:share:7482799773398401025`.
- **Notes** : pipeline complet en 3 étapes fonctionnel. Le PNG 4×4 rouge inline (~70 octets) suffit pour valider la chaîne. Pas de rate limit rencontré. Le champ `altText` (obligatoire côté CDC pour `kind: 'image'`) est accepté.

### Test 4 — publication avec PDF (Documents API)

- **`POST /rest/documents?action=initializeUpload`** : ✅ OK, retourne `uploadUrl` + `document` URN.
- **`PUT` du PDF** : ✅ OK.
- **`POST /rest/posts` avec `content.media.id`** : ✅ **OK**, `201`, URN post : `urn:li:ugcPost:7482799778909675520`.
- **Notes** :
  - **Bonne surprise** : le CDC prévoyait que ce test échouerait faute de scope suffisant. Le scope `w_member_social` seul **suffit** pour la Documents API sur un profil personnel — au moins pour la version d'API `202506`.
  - **À noter** : l'URN retourné pour le post document commence par `urn:li:ugcPost:` alors que tous les autres commencent par `urn:li:share:`. Différence à connaître pour parser proprement les URN au lot 3 (le `DELETE /rest/posts/{urn}` a fonctionné pour les deux formes, donc pas de problème pour la suppression).
  - Le PDF minimal 1-page (~350 octets) inline a suffi. En prod, le pipeline pdf-lib du lot 6 produira évidemment des PDF plus lourds.

### Test 5 — premier commentaire (`/rest/socialActions/…/comments`)

- **URN de post cible utilisé** : `urn:li:share:7482799659132977152` (le post du test 1).
- **`POST /rest/socialActions/{urn}/comments`** : ❌ **FAIL**, `403`.
- **Corps d'erreur** :
  ```json
  {
    "status": 403,
    "serviceErrorCode": 100,
    "code": "ACCESS_DENIED",
    "message": "Not enough permissions to access: partnerApiSocialActions.CREATE.20250601"
  }
  ```
- **Notes** : la mention `partnerApiSocialActions` confirme que cette API est réservée aux **Community Management Partners** (partenaires LinkedIn validés). Le scope `w_member_social` seul ne suffit pas, et ce scope ne peut pas être obtenu en libre-service sur un profil individuel. Le CDC le pressentait ; c'est tranché.

---

## Décisions

### Carrousel PDF (§9.4, §10.4)

- ✅ **FAISABLE** → l'étape 6 implémente `visual.mode = 'carousel'` : N slides → N PNG → PDF via pdf-lib → Documents API. Le contrat de template `kind: 'slide'` reste dans le registry. Le validateur (§8.8) applique les règles 3–10 slides et « une idée par slide ».
- ⬜ ~~PAS FAISABLE~~

**Attention lot 6** : les posts document reviennent en URN `urn:li:ugcPost:...` (et non `urn:li:share:...`). Le client `LinkedInClient` et le stockage `posts.linkedin.urn` doivent accepter les deux formes.

### Premier commentaire automatique (§10.6)

- ⬜ ~~FAISABLE~~
- ✅ **PAS FAISABLE** avec le scope `w_member_social` (`403 ACCESS_DENIED partnerApiSocialActions`) → l'étape 3 applique le repli du CDC :
  - Le champ `firstComment.text` reste **stocké** en base (schéma `posts` inchangé).
  - L'UI **affiche** le premier commentaire prêt à publier, avec un bouton **« Copier »**.
  - Après une publication réussie, une notification **Pushover** de priorité `0` rappelle : *« ✅ Publié. Colle le premier commentaire → {30 premiers caractères}… »*, avec un lien direct vers le post LinkedIn.
  - `firstComment.status` prend deux valeurs seulement : `none` (pas de commentaire prévu) ou `pending` (à coller à la main). L'état `posted` / `failed` disparaît du modèle jusqu'à ce qu'un jour LinkedIn ouvre l'API.
  - Le validateur (§8.8) continue de rejeter tout lien dans `commentary` : la règle « les liens vont dans le premier commentaire » reste inchangée, seule la manière de le poster change.

### Échappement du `commentary`

- ✅ **Échapper les 13 caractères** `( ) [ ] { } < > @ | ~ _ *` dans `escapeCommentary()` au lot 3.
- Un test unitaire par caractère (13 tests), plus deux tests transverses : (a) idempotence (`escape(escape(x)) === escape(x)`), (b) préservation des caractères non listés.

---

## Notes de session

- **Date et heure d'exécution** : 2026-07-14 14:14 UTC.
- **Version de l'API testée** (`LinkedIn-Version`) : `202506`.
- **URN auteur** : `urn:li:person:XXXXXXXXXX` (redacted — voir §18 « aucun URN en dur »).
- **Nombre de posts créés** : 25 (le test 5 n'a pas créé de commentaire, mais avait déjà un post cible via le test 1).
- **`--cleanup` passé** : oui — **25 posts supprimés, 0 échec**. Ton profil est propre.
- **Anomalies inattendues** :
  1. Le test 4 (PDF) a réussi alors que le CDC le donnait pour incertain. C'est un bonus pour le lot 6.
  2. Les 4 échecs 422 du test 2 étaient des « duplicate content », pas des « invalid character ». Interprétation détaillée dans la section Test 2.
  3. Les posts document reviennent en URN `urn:li:ugcPost:` (vs `urn:li:share:` pour les autres). À gérer au lot 3.
